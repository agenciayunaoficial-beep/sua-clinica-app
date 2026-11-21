'use strict';
const express = require('express');
const { q } = require('../db');
const { requireRole } = require('../auth');
const S = require('../serialize');
const { bad, notFound, wrap, isId, str } = require('../util');

const r = express.Router();
r.use(requireRole('admin', 'receptionist'));

function parse(b, partial) {
  const f = {};
  if (!partial || b.name !== undefined) { f.name = str(b.name, 120); if (!f.name) throw bad('Informe o nome do procedimento'); }
  if (!partial || b.dur !== undefined) {
    f.duration = parseInt(b.dur, 10);
    if (!(f.duration >= 5 && f.duration <= 480)) throw bad('A duração deve ficar entre 5 e 480 minutos');
  }
  if (!partial || b.price !== undefined) {
    f.price = Number(String(b.price ?? 0).replace(',', '.'));
    if (!isFinite(f.price) || f.price < 0 || f.price > 1000000) throw bad('Valor inválido');
  }
  if (b.active !== undefined) f.active = !!b.active;
  return f;
}

r.post('/', wrap(async (req, res) => {
  const f = parse(req.body, false);
  const row = (await q(`INSERT INTO procedures (clinic_id,name,duration,price) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.user.clinicId, f.name, f.duration, f.price])).rows[0];
  res.status(201).json(S.proc(row));
}));

r.patch('/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const f = parse(req.body, true);
  const keys = Object.keys(f);
  if (!keys.length) throw bad('Nada para alterar');
  const row = (await q(
    `UPDATE procedures SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(',')} WHERE id=$1 AND clinic_id=$2 RETURNING *`,
    [req.params.id, req.user.clinicId, ...keys.map(k => f[k])])).rows[0];
  if (!row) throw notFound('Procedimento não encontrado');
  res.json(S.proc(row));
}));

module.exports = r;
