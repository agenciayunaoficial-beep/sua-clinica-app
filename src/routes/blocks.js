'use strict';
const express = require('express');
const { q } = require('../db');
const S = require('../serialize');
const { bad, forbidden, notFound, wrap, isId, isDate, toMin, str } = require('../util');

const r = express.Router();
const isStaff = u => u.role === 'admin' || u.role === 'receptionist';

r.post('/', wrap(async (req, res) => {
  const b = req.body;
  if (!isId(b.professionalId)) throw bad('Escolha a profissional');
  if (!isDate(b.date)) throw bad('Data inválida');
  const s = toMin(b.start), e = toMin(b.end);
  if (s === null || e === null || e <= s) throw bad('O horário final deve ser depois do inicial');
  if (!isStaff(req.user) && String(b.professionalId) !== req.user.id) throw forbidden('Você só pode bloquear a sua própria agenda');
  const pro = await q(`SELECT 1 FROM users WHERE id=$1 AND clinic_id=$2 AND role='professional' AND active`, [b.professionalId, req.user.clinicId]);
  if (!pro.rowCount) throw bad('Profissional não encontrada');
  const row = (await q(
    `INSERT INTO blocks (clinic_id, professional_id, date, start_min, end_min, reason) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.user.clinicId, b.professionalId, b.date, s, e, str(b.reason, 200)])).rows[0];
  res.status(201).json(S.block(row));
}));

r.delete('/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const row = (await q('SELECT * FROM blocks WHERE id=$1 AND clinic_id=$2', [req.params.id, req.user.clinicId])).rows[0];
  if (!row) throw notFound('Bloqueio não encontrado');
  if (!isStaff(req.user) && String(row.professional_id) !== req.user.id) throw forbidden();
  await q('DELETE FROM blocks WHERE id=$1', [row.id]);
  res.json({ ok: true });
}));

module.exports = r;
