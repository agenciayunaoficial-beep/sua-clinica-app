'use strict';
const express = require('express');
const { q } = require('../db');
const { PLANS } = require('../config');
const { requireRole } = require('../auth');
const { usage, validatePassword, hash } = require('../services/clinics');
const S = require('../serialize');
const { bad, conflict, notFound, wrap, isId, str, email: normEmail, isEmail, isColor } = require('../util');

const r = express.Router();
r.use(requireRole('admin'));

const COLORS = ['#F26B1D', '#0F8F8C', '#7C3AED', '#D97706', '#2563EB', '#DB2777'];

async function checkLimit(clinicId, plan, role, ignoreId) {
  const lim = PLANS[plan];
  const max = role === 'professional' ? lim.professionals : lim.receptionists;
  const n = (await q(`SELECT count(*)::int AS n FROM users WHERE clinic_id=$1 AND active AND role=$2 AND id<>COALESCE($3,0)`, [clinicId, role, ignoreId || null])).rows[0].n;
  if (n >= max) {
    const nome = role === 'professional' ? 'profissionais' : 'recepcionistas';
    throw conflict(`O plano ${lim.label} permite até ${max} ${nome}.`, 'plan_limit');
  }
}

r.get('/', wrap(async (req, res) => {
  const rows = (await q('SELECT * FROM users WHERE clinic_id=$1 ORDER BY role, name', [req.user.clinicId])).rows;
  res.json({ team: rows.map(S.member), limits: PLANS[req.user.plan], usage: await usage(req.user.clinicId) });
}));

r.post('/', wrap(async (req, res) => {
  const role = req.body.role;
  if (!['professional', 'receptionist'].includes(role)) throw bad('Função inválida');
  const name = str(req.body.name, 120), email = normEmail(req.body.email);
  if (!name) throw bad('Informe o nome');
  if (!isEmail(email)) throw bad('E-mail inválido');
  validatePassword(req.body.password);
  await checkLimit(req.user.clinicId, req.user.plan, role);
  let color = isColor(req.body.color) ? req.body.color : null;
  if (!color) {
    const n = (await q(`SELECT count(*)::int AS n FROM users WHERE clinic_id=$1 AND role='professional'`, [req.user.clinicId])).rows[0].n;
    color = COLORS[n % COLORS.length];
  }
  try {
    const row = (await q(
      `INSERT INTO users (clinic_id,name,email,password_hash,role,color,phone) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.clinicId, name, email, await hash(req.body.password), role, color, str(req.body.phone, 40)])).rows[0];
    res.status(201).json(S.member(row));
  } catch (e) {
    if (e.code === '23505') throw conflict('Já existe um usuário com esse e-mail');
    throw e;
  }
}));

r.patch('/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const cur = (await q('SELECT * FROM users WHERE id=$1 AND clinic_id=$2', [req.params.id, req.user.clinicId])).rows[0];
  if (!cur) throw notFound();
  if (cur.role === 'admin' && cur.id !== req.user.id && String(cur.id) !== req.user.id) throw bad('Não é possível alterar a administradora');
  const b = req.body, f = {};
  if (b.name !== undefined) { f.name = str(b.name, 120); if (!f.name) throw bad('Informe o nome'); }
  if (b.phone !== undefined) f.phone = str(b.phone, 40);
  if (b.color !== undefined) { if (!isColor(b.color)) throw bad('Cor inválida'); f.color = b.color; }
  if (b.email !== undefined) { f.email = normEmail(b.email); if (!isEmail(f.email)) throw bad('E-mail inválido'); }
  if (b.active !== undefined) {
    if (cur.role === 'admin') throw bad('A administradora não pode ser desativada');
    f.active = !!b.active;
    if (f.active && !cur.active) await checkLimit(req.user.clinicId, req.user.plan, cur.role, cur.id);
  }
  if (b.password !== undefined && b.password !== '') { validatePassword(b.password); f.password_hash = await hash(b.password); }
  const keys = Object.keys(f);
  if (!keys.length) return res.json(S.member(cur));
  try {
    const row = (await q(
      `UPDATE users SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(',')} WHERE id=$1 AND clinic_id=$2 RETURNING *`,
      [cur.id, req.user.clinicId, ...keys.map(k => f[k])])).rows[0];
    res.json(S.member(row));
  } catch (e) {
    if (e.code === '23505') throw conflict('Já existe um usuário com esse e-mail');
    throw e;
  }
}));

module.exports = r;
