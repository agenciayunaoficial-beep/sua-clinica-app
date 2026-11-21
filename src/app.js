'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { HttpError } = require('./util');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);          // Railway fica atrás de um proxy
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],          // o app usa eventos inline
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"]
      }
    },
    permissionsPolicy: undefined
  }));
  app.use((req, res, next) => { res.setHeader('Permissions-Policy', 'camera=(self), microphone=()'); next(); });

  app.use(cookieParser());
  app.use(express.json({ limit: '4mb' }));

  // Só aceita JSON nas rotas de escrita (protege contra envio de formulário de outro site)
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('content-length') !== '0' && req.get('content-length') !== undefined && !req.is('application/json')) {
      return res.status(415).json({ error: 'Formato inválido' });
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/api', require('./routes'));

  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', index: 'index.html' }));

  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Arquivo grande demais' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
    console.error(err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  });
  return app;
}

module.exports = { createApp };
