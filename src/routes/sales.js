'use strict';
const express = require('express');
const { q, tx } = require('../db');
const { requireRole } = require('../auth');
const S = require('../serialize');
const { bad, conflict, notFound, wrap, isId, isDate, str, todayStr, addDays } = require('../util');

const r = express.Router();
r.use(requireRole('admin', 'receptionist'));

const METHODS = ['pix', 'credito', 'debito', 'dinheiro', 'transferencia', 'outro'];
const cents = v => Math.round(Number(v) * 100);

async function loadSale(clinicId, id) {
  if (!isId(id)) throw notFound('Venda não encontrada');
  const row = (await q(`${S.SALE_SELECT} WHERE s.id=$1 AND s.clinic_id=$2`, [id, clinicId])).rows[0];
  if (!row) throw notFound('Venda não encontrada');
  return row;
}

// Lista: por cliente (ficha) ou por mês (tela de vendas)
r.get('/', wrap(async (req, res) => {
  const cid = req.user.clinicId;
  if (isId(req.query.clientId)) {
    const rows = (await q(`${S.SALE_SELECT} WHERE s.clinic_id=$1 AND s.client_id=$2 ORDER BY s.sale_date DESC, s.id DESC`, [cid, req.query.clientId])).rows;
    return res.json({ sales: rows.map(S.sale) });
  }
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : todayStr().slice(0, 7);
  const [from, to] = monthRange(month);
  const rows = (await q(`${S.SALE_SELECT} WHERE s.clinic_id=$1 AND s.sale_date BETWEEN $2 AND $3 ORDER BY s.sale_date DESC, s.id DESC`, [cid, from, to])).rows;
  res.json({ sales: rows.map(S.sale) });
}));

function monthRange(month) {
  const from = month + '-01';
  const d = new Date(from + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1);
  return [from, addDays(d.toISOString().slice(0, 10), -1)];
}
const prevMonth = month => { const d = new Date(month + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

// Indicadores do mês: faturamento, nº de vendas, ticket médio, mais vendidos, formas de pagamento
async function monthStats(cid, month) {
  const [from, to] = monthRange(month);
  const tot = (await q(
    `SELECT COALESCE(sum(total),0)::float8 AS revenue, count(*)::int AS n FROM sales WHERE clinic_id=$1 AND status='ativa' AND sale_date BETWEEN $2 AND $3`,
    [cid, from, to])).rows[0];
  const top = (await q(
    `SELECT min(name) AS name, count(*)::int AS qty, sum(total)::float8 AS revenue FROM sales
      WHERE clinic_id=$1 AND status='ativa' AND sale_date BETWEEN $2 AND $3
      GROUP BY lower(trim(name)) ORDER BY count(*) DESC, sum(total) DESC, min(name) LIMIT 8`, [cid, from, to])).rows;
  const methods = (await q(
    `SELECT p.method, sum(p.amount)::float8 AS amount FROM sale_payments p JOIN sales s ON s.id=p.sale_id
      WHERE s.clinic_id=$1 AND s.status='ativa' AND s.sale_date BETWEEN $2 AND $3 GROUP BY p.method ORDER BY sum(p.amount) DESC`, [cid, from, to])).rows;
  return { month, revenue: tot.revenue, count: tot.n, ticket: tot.n ? tot.revenue / tot.n : 0, top, methods };
}

r.get('/stats', wrap(async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : todayStr().slice(0, 7);
  const [cur, prev] = await Promise.all([monthStats(req.user.clinicId, month), monthStats(req.user.clinicId, prevMonth(month))]);
  res.json({ ...cur, previous: { month: prev.month, revenue: prev.revenue, count: prev.count, ticket: prev.ticket } });
}));

r.post('/', wrap(async (req, res) => {
  const cid = req.user.clinicId, b = req.body;
  if (!isId(b.clientId)) throw bad('Selecione o cliente');
  const kind = b.kind === 'package' ? 'package' : 'procedure';
  const total = cents(b.total);
  if (!(total > 0) || total > 100000000) throw bad('Informe o valor total da venda');
  const sessions = kind === 'package' ? parseInt(b.sessions, 10) : 1;
  if (!(sessions >= 1 && sessions <= 200)) throw bad('Informe a quantidade de sessões do pacote (1 a 200)');
  if (b.validUntil && !isDate(b.validUntil)) throw bad('Validade inválida');
  const saleDate = b.date ? (isDate(b.date) ? b.date : null) : todayStr();
  if (!saleDate) throw bad('Data do pagamento inválida');
  const pays = Array.isArray(b.payments) ? b.payments : [];
  if (!pays.length || pays.length > 6) throw bad('Informe a forma de pagamento');
  let sum = 0;
  const payments = pays.map(p => {
    if (!METHODS.includes(p.method)) throw bad('Forma de pagamento inválida');
    const amount = cents(p.amount);
    if (!(amount > 0)) throw bad('Informe o valor de cada forma de pagamento');
    sum += amount;
    let inst = p.method === 'credito' ? parseInt(p.installments, 10) || 1 : 1;
    if (inst < 1 || inst > 24) throw bad('Número de parcelas inválido (1 a 24)');
    return { method: p.method, amount, installments: inst };
  });
  if (sum !== total) throw bad('A soma das formas de pagamento precisa ser igual ao valor total');

  const out = await tx(async c => {
    const cl = await c.query('SELECT 1 FROM clients WHERE id=$1 AND clinic_id=$2', [b.clientId, cid]);
    if (!cl.rowCount) throw bad('Cliente não encontrado');
    let apptId = null;
    if (b.appointmentId !== undefined && b.appointmentId !== null && b.appointmentId !== '') {
      if (!isId(b.appointmentId)) throw bad('Agendamento inválido');
      const ap = await c.query('SELECT id, client_id, procedure_id FROM appointments WHERE id=$1 AND clinic_id=$2', [b.appointmentId, cid]);
      if (!ap.rowCount) throw bad('Agendamento não encontrado');
      if (String(ap.rows[0].client_id) !== String(b.clientId)) throw bad('Esse agendamento é de outro cliente');
      const dup = await c.query(`SELECT 1 FROM sales WHERE appointment_id=$1 AND status='ativa'`, [b.appointmentId]);
      if (dup.rowCount) throw conflict('Esse agendamento já tem pagamento lançado', 'already_paid');
      apptId = ap.rows[0].id;
    }
    let procId = null;
    if (isId(b.procedureId)) {
      const pr = await c.query('SELECT id FROM procedures WHERE id=$1 AND clinic_id=$2', [b.procedureId, cid]);
      if (pr.rowCount) procId = pr.rows[0].id;
    }
    const name = str(b.name, 140);
    if (!name) throw bad('Informe o nome do pacote ou procedimento');
    const ins = await c.query(
      `INSERT INTO sales (clinic_id, client_id, appointment_id, kind, name, procedure_id, total, sessions, valid_until, sale_date, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [cid, b.clientId, apptId, kind, name, procId, total / 100, sessions, b.validUntil || null, saleDate, str(b.note, 300), req.user.id]);
    const id = ins.rows[0].id;
    for (const p of payments) {
      await c.query('INSERT INTO sale_payments (sale_id, method, amount, installments) VALUES ($1,$2,$3,$4)', [id, p.method, p.amount / 100, p.installments]);
    }
    // a sessão em que a venda foi lançada já conta como uma do pacote, se a recepção marcar assim
    if (kind === 'package' && apptId && b.useAppointment) {
      await c.query('UPDATE appointments SET sale_id=$1 WHERE id=$2 AND clinic_id=$3', [id, apptId, cid]);
    }
    return id;
  });
  res.status(201).json(S.sale(await loadSale(cid, out)));
}));

// Cancelar a venda (só administradora) ou ajustar a validade do pacote
r.patch('/:id', wrap(async (req, res) => {
  const cur = await loadSale(req.user.clinicId, req.params.id);
  if (req.body.status !== undefined) {
    if (req.user.role !== 'admin') throw bad('Só a administradora pode cancelar uma venda');
    if (req.body.status !== 'cancelada') throw bad('Situação inválida');
    await q(`UPDATE sales SET status='cancelada' WHERE id=$1`, [cur.id]);
  }
  if (req.body.validUntil !== undefined) {
    if (req.body.validUntil && !isDate(req.body.validUntil)) throw bad('Validade inválida');
    await q('UPDATE sales SET valid_until=$2 WHERE id=$1', [cur.id, req.body.validUntil || null]);
  }
  res.json(S.sale(await loadSale(req.user.clinicId, cur.id)));
}));

module.exports = r;
