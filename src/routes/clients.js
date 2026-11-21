'use strict';
const express = require('express');
const { q, tx } = require('../db');
const { requireRole } = require('../auth');
const S = require('../serialize');
const { bad, notFound, wrap, isId, str, digits, phoneKey } = require('../util');

const r = express.Router();
const staff = requireRole('admin', 'receptionist');

const fields = b => ({ name: str(b.name, 140), phone: str(b.phone, 40), notes: str(b.notes, 2000) });

r.post('/', staff, wrap(async (req, res) => {
  const f = fields(req.body);
  if (!f.name) throw bad('Informe o nome do cliente');
  if (digits(f.phone).length < 8) throw bad('Informe um WhatsApp válido');
  const row = (await q(
    `INSERT INTO clients (clinic_id,name,phone,phone_key,notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.clinicId, f.name, f.phone, phoneKey(f.phone), f.notes])).rows[0];
  res.status(201).json(S.client(row));
}));

r.patch('/:id', staff, wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const f = fields(req.body);
  if (!f.name) throw bad('Informe o nome do cliente');
  if (digits(f.phone).length < 8) throw bad('Informe um WhatsApp válido');
  const row = (await q(
    `UPDATE clients SET name=$3, phone=$4, phone_key=$5, notes=$6 WHERE id=$1 AND clinic_id=$2 RETURNING *`,
    [req.params.id, req.user.clinicId, f.name, f.phone, phoneKey(f.phone), f.notes])).rows[0];
  if (!row) throw notFound('Cliente não encontrado');
  res.json(S.client(row));
}));

// Importação em lote (planilha). Ignora duplicados pelo telefone e linhas sem nome/telefone válidos.
r.post('/bulk', staff, wrap(async (req, res) => {
  const list = Array.isArray(req.body.clients) ? req.body.clients : null;
  if (!list) throw bad('Envie a lista de clientes');
  if (list.length > 5000) throw bad('Envie no máximo 5000 clientes por vez');
  const out = await tx(async c => {
    const have = new Set((await c.query('SELECT phone_key FROM clients WHERE clinic_id=$1', [req.user.clinicId])).rows.map(x => x.phone_key));
    let created = 0, duplicated = 0, invalid = 0;
    for (const it of list) {
      const f = fields(it || {});
      const k = phoneKey(f.phone);
      if (!f.name || digits(f.phone).length < 8) { invalid++; continue; }
      if (have.has(k)) { duplicated++; continue; }
      have.add(k);
      await c.query(`INSERT INTO clients (clinic_id,name,phone,phone_key,notes) VALUES ($1,$2,$3,$4,$5)`, [req.user.clinicId, f.name, f.phone, k, f.notes]);
      created++;
    }
    return { created, duplicated, invalid };
  });
  res.json(out);
}));

// Histórico de atendimentos do cliente (todos os períodos)
r.get('/:id/history', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const own = await q('SELECT 1 FROM clients WHERE id=$1 AND clinic_id=$2', [req.params.id, req.user.clinicId]);
  if (!own.rowCount) throw notFound('Cliente não encontrado');
  const rows = (await q(
    `SELECT ${S.APPT_COLS} FROM appointments a WHERE a.clinic_id=$1 AND a.client_id=$2 ORDER BY a.date DESC, a.start_min DESC LIMIT 200`,
    [req.user.clinicId, req.params.id])).rows;
  res.json({ appts: rows.map(S.appt) });
}));

module.exports = r;
