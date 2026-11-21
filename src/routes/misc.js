'use strict';
const express = require('express');
const { q } = require('../db');
const { PLANS, DEFAULT_WA_TEMPLATES, OPEN_MIN, CLOSE_MIN } = require('../config');
const { requireRole } = require('../auth');
const { usage } = require('../services/clinics');
const S = require('../serialize');
const { bad, wrap, isId, isDate, str, addDays, todayStr } = require('../util');

const r = express.Router();
const staff = requireRole('admin', 'receptionist');

// Tudo o que a tela precisa para abrir
r.get('/bootstrap', wrap(async (req, res) => {
  const cid = req.user.clinicId;
  const today = todayStr();
  let from = isDate(req.query.from) ? req.query.from : addDays(today, -60);
  let to = isDate(req.query.to) ? req.query.to : addDays(today, 365);
  if (to < from || to > addDays(from, 460)) { from = addDays(today, -60); to = addDays(today, 365); }
  const [clinic, pros, procs, clients, appts, blocks, msgs, us] = await Promise.all([
    q('SELECT name, plan, status, wa_templates FROM clinics WHERE id=$1', [cid]),
    q(`SELECT id,name,color,active FROM users WHERE clinic_id=$1 AND role='professional' ORDER BY active DESC, created_at`, [cid]),
    q('SELECT * FROM procedures WHERE clinic_id=$1 ORDER BY name', [cid]),
    q('SELECT * FROM clients WHERE clinic_id=$1 ORDER BY lower(name)', [cid]),
    q(`SELECT ${S.APPT_COLS} FROM appointments a WHERE a.clinic_id=$1 AND a.date BETWEEN $2 AND $3 ORDER BY a.date, a.start_min`, [cid, from, to]),
    q('SELECT * FROM blocks WHERE clinic_id=$1 AND date BETWEEN $2 AND $3', [cid, from, to]),
    q('SELECT * FROM message_log WHERE clinic_id=$1 ORDER BY created_at DESC LIMIT 30', [cid]),
    usage(cid)
  ]);
  const c = clinic.rows[0];
  res.json({
    me: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role },
    clinic: { name: c.name, plan: c.plan, planLabel: PLANS[c.plan].label, status: c.status, limits: PLANS[c.plan], usage: us },
    templates: { ...DEFAULT_WA_TEMPLATES, ...c.wa_templates },
    pros: pros.rows.map(S.pro), procs: procs.rows.map(S.proc), clients: clients.rows.map(S.client),
    appts: appts.rows.map(S.appt), blocks: blocks.rows.map(S.block), log: msgs.rows.map(S.message),
    window: { from, to }, hours: { open: OPEN_MIN, close: CLOSE_MIN }
  });
}));

// Modelos de mensagem
r.put('/settings/wa-templates', staff, wrap(async (req, res) => {
  const t = {};
  for (const k of ['conf', 'lemb', 'agenda']) {
    const v = str(req.body[k], 1000);
    if (!v) throw bad('Nenhum modelo pode ficar vazio');
    t[k] = v;
  }
  await q('UPDATE clinics SET wa_templates=$2 WHERE id=$1', [req.user.clinicId, JSON.stringify(t)]);
  res.json(t);
}));

// Histórico de mensagens. Nesta etapa o envio ainda é simulado (status "simulado");
// a integração real com o WhatsApp entra na próxima etapa.
r.post('/messages', staff, wrap(async (req, res) => {
  const body = str(req.body.text, 2000);
  if (!body) throw bad('Mensagem vazia');
  const row = (await q(
    `INSERT INTO message_log (clinic_id, kind, to_name, to_phone, body, status) VALUES ($1,$2,$3,$4,$5,'simulado') RETURNING *`,
    [req.user.clinicId, str(req.body.kind, 60), str(req.body.name, 140), str(req.body.to, 40), body])).rows[0];
  if (isId(req.body.appointmentId)) {
    await q('UPDATE appointments SET wa_sent=true WHERE id=$1 AND clinic_id=$2', [req.body.appointmentId, req.user.clinicId]);
  }
  res.status(201).json(S.message(row));
}));

module.exports = r;
