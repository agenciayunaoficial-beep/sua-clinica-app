'use strict';
const bcrypt = require('bcryptjs');
const { tx, q } = require('../db');
const { PLANS, DEFAULT_WA_TEMPLATES } = require('../config');
const { bad, conflict, str, email: normEmail, isEmail } = require('../util');

const validatePassword = p => {
  if (typeof p !== 'string' || p.length < 8) throw bad('A senha precisa ter pelo menos 8 caracteres');
  if (p.length > 100) throw bad('A senha é muito longa');
};
const hash = p => bcrypt.hash(p, 10);

/** Cria a clínica + a administradora. Usado pelo script, pela rota de setup e (depois) pelo webhook do Stripe. */
async function createClinic({ name, plan = 'monthly', adminName, email, password, stripeCustomerId = null, stripeSubscriptionId = null }) {
  name = str(name, 120); adminName = str(adminName, 120); email = normEmail(email);
  if (!name) throw bad('Informe o nome da clínica');
  if (!adminName) throw bad('Informe o nome da administradora');
  if (!isEmail(email)) throw bad('E-mail inválido');
  if (!PLANS[plan]) throw bad('Plano inválido');
  validatePassword(password);
  const passwordHash = await hash(password);
  try {
    return await tx(async c => {
      const cl = await c.query(
        `INSERT INTO clinics (name, plan, wa_templates, stripe_customer_id, stripe_subscription_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [name, plan, JSON.stringify(DEFAULT_WA_TEMPLATES), stripeCustomerId, stripeSubscriptionId]);
      const clinicId = cl.rows[0].id;
      const u = await c.query(
        `INSERT INTO users (clinic_id, name, email, password_hash, role, color) VALUES ($1,$2,$3,$4,'admin','#6B5B7A') RETURNING id`,
        [clinicId, adminName, email, passwordHash]);
      await c.query(`INSERT INTO procedures (clinic_id, name, duration, price) VALUES ($1,'Avaliação',20,0)`, [clinicId]);
      return { clinicId: String(clinicId), adminId: String(u.rows[0].id) };
    });
  } catch (e) {
    if (e.code === '23505') throw conflict('Já existe um usuário com esse e-mail');
    throw e;
  }
}

async function usage(clinicId) {
  const r = await q(
    `SELECT role, count(*)::int AS n FROM users WHERE clinic_id=$1 AND active AND role<>'admin' GROUP BY role`, [clinicId]);
  const u = { professional: 0, receptionist: 0 };
  r.rows.forEach(x => { u[x.role] = x.n; });
  return u;
}

module.exports = { createClinic, usage, validatePassword, hash };
