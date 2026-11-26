'use strict';
const express = require('express');
const { q } = require('../db');
const { PLANS, DEFAULT_WA_TEMPLATES, OPEN_MIN, CLOSE_MIN } = require('../config');
const { requireRole } = require('../auth');
const { usage } = require('../services/clinics');
const S = require('../serialize');
const { bad, conflict, wrap, isId, isDate, str, addDays, todayStr } = require('../util');
const wa = require('../services/whatsapp');

const r = express.Router();
const staff = requireRole('admin', 'receptionist');
const isStaffUser = u => u.role === 'admin' || u.role === 'receptionist';

// Tudo o que a tela precisa para abrir
r.get('/bootstrap', wrap(async (req, res) => {
  const cid = req.user.clinicId;
  const today = todayStr();
  let from = isDate(req.query.from) ? req.query.from : addDays(today, -60);
  let to = isDate(req.query.to) ? req.query.to : addDays(today, 365);
  if (to < from || to > addDays(from, 460)) { from = addDays(today, -60); to = addDays(today, 365); }
  const [clinic, pros, procs, clients, appts, blocks, msgs, us, pkgs] = await Promise.all([
    q('SELECT name, plan, status, wa_templates FROM clinics WHERE id=$1', [cid]),
    q(`SELECT id,name,color,active,phone FROM users WHERE clinic_id=$1 AND role='professional' ORDER BY active DESC, created_at`, [cid]),
    q('SELECT * FROM procedures WHERE clinic_id=$1 ORDER BY name', [cid]),
    q('SELECT * FROM clients WHERE clinic_id=$1 ORDER BY lower(name)', [cid]),
    q(`SELECT ${S.APPT_COLS} FROM appointments a WHERE a.clinic_id=$1 AND a.date BETWEEN $2 AND $3 ORDER BY a.date, a.start_min`, [cid, from, to]),
    q('SELECT * FROM blocks WHERE clinic_id=$1 AND date BETWEEN $2 AND $3', [cid, from, to]),
    q('SELECT * FROM message_log WHERE clinic_id=$1 ORDER BY created_at DESC LIMIT 30', [cid]),
    usage(cid),
    isStaffUser(req.user)
      ? q(`${S.SALE_SELECT} WHERE s.clinic_id=$1 AND s.kind='package' AND s.status='ativa' ORDER BY s.sale_date DESC`, [cid])
      : { rows: [] }
  ]);
  const c = clinic.rows[0];
  res.json({
    me: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role },
    clinic: { name: c.name, plan: c.plan, planLabel: PLANS[c.plan].label, status: c.status, limits: PLANS[c.plan], usage: us },
    templates: { ...DEFAULT_WA_TEMPLATES, ...c.wa_templates },
    pros: pros.rows.map(S.pro), procs: procs.rows.map(S.proc), clients: clients.rows.map(S.client),
    appts: appts.rows.map(S.appt), blocks: blocks.rows.map(S.block), log: msgs.rows.map(S.message),
    pkgs: pkgs.rows.map(S.sale).filter(p => p.used + p.scheduled < p.sessions || p.scheduled > 0),
    wa: wa.state(cid),
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

// Estado da conexão do WhatsApp + últimas mensagens (a tela consulta isso a cada poucos segundos)
r.get('/whatsapp/status', staff, wrap(async (req, res) => {
  const msgs = (await q('SELECT * FROM message_log WHERE clinic_id=$1 ORDER BY created_at DESC, id DESC LIMIT 30', [req.user.clinicId])).rows;
  res.json({ ...wa.state(req.user.clinicId), log: msgs.map(S.message) });
}));
r.post('/whatsapp/connect', staff, wrap(async (req, res) => {
  try { res.json(await wa.connect(req.user.clinicId)); }
  catch (e) { throw new (require('../util').HttpError)(e.status || 500, e.message); }
}));
r.post('/whatsapp/disconnect', staff, wrap(async (req, res) => { res.json(await wa.disconnect(req.user.clinicId)); }));

// Envio de mensagens. Com o WhatsApp real conectado, a mensagem entra numa fila e sai com pausa entre uma e outra;
// o resultado (enviado / falhou) fica no histórico. Sem a biblioteca no servidor, só registra (modo demonstração).
r.post('/messages', staff, wrap(async (req, res) => {
  const cid = req.user.clinicId;
  const body = str(req.body.text, 2000);
  if (!body) throw bad('Mensagem vazia');
  const kind = str(req.body.kind, 60), name = str(req.body.name, 140), to = str(req.body.to, 40);
  const apptId = isId(req.body.appointmentId) ? req.body.appointmentId : null;

  if (wa.mode() === 'demo') {
    const row = (await q(
      `INSERT INTO message_log (clinic_id, kind, to_name, to_phone, body, status, appointment_id) VALUES ($1,$2,$3,$4,$5,'simulado',$6) RETURNING *`,
      [cid, kind, name, to, body, apptId])).rows[0];
    if (apptId && kind !== 'Lembrete') await q('UPDATE appointments SET wa_sent=true WHERE id=$1 AND clinic_id=$2', [apptId, cid]);
    return res.status(201).json(S.message(row));
  }

  if (wa.state(cid).status !== 'connected') throw conflict('O WhatsApp não está conectado. Abra a aba WhatsApp e leia o QR Code.', 'wa_disconnected');
  if (!wa.normalizePhone(to)) throw bad('O telefone de ' + (name || 'destino') + ' é inválido. Corrija o cadastro (DDD + número).');
  if (apptId) {
    const sts = kind === 'Lembrete' ? ['na fila', 'enviado'] : ['na fila'];   // lembrete não se repete para o mesmo atendimento
    const dup = (await q(`SELECT * FROM message_log WHERE clinic_id=$1 AND appointment_id=$2 AND kind=$3 AND status = ANY($4) LIMIT 1`, [cid, apptId, kind, sts])).rows[0];
    if (dup) return res.status(200).json(S.message(dup));
  }
  const row = (await q(
    `INSERT INTO message_log (clinic_id, kind, to_name, to_phone, body, status, appointment_id) VALUES ($1,$2,$3,$4,$5,'na fila',$6) RETURNING *`,
    [cid, kind, name, to, body, apptId])).rows[0];
  wa.enqueue(cid, { logId: row.id, phone: to, text: body, kind, appointmentId: apptId });
  res.status(202).json(S.message(row));
}));

module.exports = r;
