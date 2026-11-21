'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { q } = require('../db');
const { setSession, clearSession, requireAuth } = require('../auth');
const { validatePassword, hash } = require('../services/clinics');
const { HttpError, bad, wrap, email: normEmail } = require('../util');

const r = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' })
});

// hash falso para gastar o mesmo tempo quando o e-mail não existe
const DUMMY = bcrypt.hashSync('nao-existe', 10);

r.post('/login', loginLimiter, wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  const password = String(req.body.password ?? '');
  const u = (await q(
    `SELECT u.id, u.password_hash, u.active, c.status FROM users u JOIN clinics c ON c.id=u.clinic_id WHERE lower(u.email)=$1`, [email])).rows[0];
  const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY);
  if (!u || !ok || !u.active) throw new HttpError(401, 'E-mail ou senha incorretos');
  if (u.status === 'canceled') throw new HttpError(402, 'A assinatura desta clínica está cancelada', 'canceled');
  setSession(res, u.id);
  res.json({ ok: true });
}));

r.post('/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

r.post('/password', requireAuth, wrap(async (req, res) => {
  const cur = String(req.body.current ?? ''), next = req.body.next;
  validatePassword(next);
  const u = (await q('SELECT password_hash FROM users WHERE id=$1', [req.user.id])).rows[0];
  if (!(await bcrypt.compare(cur, u.password_hash))) throw bad('A senha atual está incorreta');
  await q('UPDATE users SET password_hash=$1 WHERE id=$2', [await hash(next), req.user.id]);
  res.json({ ok: true });
}));

module.exports = r;
