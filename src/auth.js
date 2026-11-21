'use strict';
const jwt = require('jsonwebtoken');
const { q } = require('./db');
const { JWT_SECRET, secureCookies } = require('./config');
const { HttpError, forbidden } = require('./util');

const COOKIE = 'sc_session';
const MAX_AGE = 7 * 24 * 3600 * 1000;

function setSession(res, userId) {
  const token = jwt.sign({ uid: String(userId) }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge: MAX_AGE, path: '/' });
}
const clearSession = res => res.clearCookie(COOKIE, { path: '/' });

/** Exige login. Carrega usuária + clínica e bloqueia clínica cancelada. */
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies && req.cookies[COOKIE];
    if (!token) throw new HttpError(401, 'Faça login para continuar');
    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); } catch (_) { throw new HttpError(401, 'Sessão expirada. Entre novamente'); }
    const r = await q(
      `SELECT u.id, u.clinic_id, u.name, u.email, u.role, u.active, c.name AS clinic_name, c.plan, c.status
         FROM users u JOIN clinics c ON c.id = u.clinic_id WHERE u.id = $1`, [payload.uid]);
    const u = r.rows[0];
    if (!u || !u.active) throw new HttpError(401, 'Usuária inativa');
    if (u.status === 'canceled') throw new HttpError(402, 'A assinatura desta clínica está cancelada', 'canceled');
    req.user = { id: String(u.id), clinicId: String(u.clinic_id), name: u.name, email: u.email, role: u.role, clinicName: u.clinic_name, plan: u.plan, status: u.status };
    next();
  } catch (e) { next(e); }
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(forbidden());

module.exports = { setSession, clearSession, requireAuth, requireRole };
