'use strict';
const express = require('express');
const { requireAuth } = require('../auth');
const { SETUP_KEY } = require('../config');
const { createClinic } = require('../services/clinics');
const { wrap, HttpError } = require('../util');

const api = express.Router();

// Rotas públicas
api.use('/auth', require('./auth'));
api.get('/auth/me', requireAuth, (req, res) => res.json({ me: req.user }));

// Criar clínica manualmente (protegido por SETUP_KEY). O Stripe vai chamar o mesmo serviço depois.
api.post('/admin/clinics', wrap(async (req, res) => {
  if (!SETUP_KEY || req.get('x-setup-key') !== SETUP_KEY) throw new HttpError(403, 'Não autorizado');
  const out = await createClinic({
    name: req.body.clinicName, plan: req.body.plan || 'monthly',
    adminName: req.body.adminName, email: req.body.email, password: req.body.password
  });
  res.status(201).json(out);
}));

// Rotas que exigem login
api.use(requireAuth);
api.use('/team', require('./team'));
api.use('/clients', require('./clients'));
api.use('/procedures', require('./procedures'));
api.use('/appointments', require('./appointments'));
api.use('/blocks', require('./blocks'));
api.use('/sales', require('./sales'));
api.use('/', require('./misc'));

api.use((req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

module.exports = api;
