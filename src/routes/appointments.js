'use strict';
const express = require('express');
const { q, tx } = require('../db');
const { OPEN_MIN, CLOSE_MIN, MAX_IMAGE_CHARS } = require('../config');
const { requireRole } = require('../auth');
const S = require('../serialize');
const { bad, forbidden, notFound, conflict, wrap, isId, isDate, toMin, str, digits, phoneKey, addDays } = require('../util');

const r = express.Router();
const staff = requireRole('admin', 'receptionist');
const isStaff = u => u.role === 'admin' || u.role === 'receptionist';

const TRANSITIONS = {
  agendado: ['confirmado', 'atendimento', 'cancelado'],
  confirmado: ['atendimento', 'cancelado'],
  atendimento: [],            // só conclui pela baixa (foto/assinatura)
  concluido: [], cancelado: []
};
const IMG = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

async function loadAppt(clinicId, id) {
  if (!isId(id)) throw notFound();
  const row = (await q(`SELECT a.*, (a.sign_image IS NOT NULL) AS has_sign, (a.photo_image IS NOT NULL) AS has_photo FROM appointments a WHERE a.id=$1 AND a.clinic_id=$2`, [id, clinicId])).rows[0];
  if (!row) throw notFound('Agendamento não encontrado');
  return row;
}

/** Confere dados do agendamento e conflitos. Retorna os valores prontos para gravar. */
async function checkSlot(db, clinicId, b, ignoreId) {
  if (!isId(b.clientId)) throw bad('Selecione o cliente');
  if (!isId(b.procedureId)) throw bad('Selecione o procedimento');
  if (!isId(b.professionalId)) throw bad('Selecione a profissional');
  if (!isDate(b.date)) throw bad('Data inválida');
  const start = toMin(b.time);
  if (start === null || start < OPEN_MIN || start >= CLOSE_MIN) throw bad('Horário fora do funcionamento da agenda');
  const dur = parseInt(b.dur, 10);
  if (!(dur >= 5 && dur <= 480)) throw bad('Duração inválida');
  const own = await db.query(
    `SELECT (SELECT count(*) FROM clients WHERE id=$1 AND clinic_id=$4) AS c,
            (SELECT count(*) FROM procedures WHERE id=$2 AND clinic_id=$4) AS p,
            (SELECT count(*) FROM users WHERE id=$3 AND clinic_id=$4 AND role='professional' AND active) AS u`,
    [b.clientId, b.procedureId, b.professionalId, clinicId]);
  const o = own.rows[0];
  if (+o.c === 0) throw bad('Cliente não encontrado');
  if (+o.p === 0) throw bad('Procedimento não encontrado');
  if (+o.u === 0) throw bad('Profissional não encontrada');
  const end = start + dur;
  const blk = await db.query(
    `SELECT start_min, end_min FROM blocks WHERE clinic_id=$1 AND professional_id=$2 AND date=$3 AND start_min<$5 AND end_min>$4 LIMIT 1`,
    [clinicId, b.professionalId, b.date, start, end]);
  if (blk.rowCount) throw conflict('A profissional está bloqueada nesse horário', 'blocked');
  if (!b.allowOverlap) {
    const ov = await db.query(
      `SELECT 1 FROM appointments WHERE clinic_id=$1 AND professional_id=$2 AND date=$3 AND status<>'cancelado'
         AND start_min<$5 AND start_min+duration>$4 AND id<>COALESCE($6,0) LIMIT 1`,
      [clinicId, b.professionalId, b.date, start, end, ignoreId || null]);
    if (ov.rowCount) throw conflict('Já existe um paciente nesse horário com essa profissional', 'overlap');
  }
  return { clientId: b.clientId, procedureId: b.procedureId, professionalId: b.professionalId, date: b.date, start, dur };
}

// Lista por período
r.get('/', wrap(async (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) throw bad('Informe from e to (AAAA-MM-DD)');
  if (to < from || to > addDays(from, 460)) throw bad('Período inválido');
  const [a, b] = await Promise.all([
    q(`SELECT ${S.APPT_COLS} FROM appointments a WHERE a.clinic_id=$1 AND a.date BETWEEN $2 AND $3 ORDER BY a.date, a.start_min`, [req.user.clinicId, from, to]),
    q(`SELECT * FROM blocks WHERE clinic_id=$1 AND date BETWEEN $2 AND $3`, [req.user.clinicId, from, to])
  ]);
  res.json({ appts: a.rows.map(S.appt), blocks: b.rows.map(S.block) });
}));

r.post('/', staff, wrap(async (req, res) => {
  const v = await checkSlot({ query: (t, p) => q(t, p) }, req.user.clinicId, req.body, null);
  const row = (await q(
    `INSERT INTO appointments (clinic_id, client_id, professional_id, procedure_id, date, start_min, duration, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *, false AS has_sign, false AS has_photo`,
    [req.user.clinicId, v.clientId, v.professionalId, v.procedureId, v.date, v.start, v.dur, req.user.id])).rows[0];
  res.status(201).json(S.appt(row));
}));

r.patch('/:id', staff, wrap(async (req, res) => {
  const cur = await loadAppt(req.user.clinicId, req.params.id);
  if (!['agendado', 'confirmado'].includes(cur.status)) throw bad('Só dá para editar agendamentos ainda não iniciados');
  const b = req.body;
  const v = await checkSlot({ query: (t, p) => q(t, p) }, req.user.clinicId, {
    clientId: b.clientId ?? cur.client_id, procedureId: b.procedureId ?? cur.procedure_id,
    professionalId: b.professionalId ?? cur.professional_id, date: b.date ?? cur.date,
    time: b.time ?? `${Math.floor(cur.start_min / 60)}:${String(cur.start_min % 60).padStart(2, '0')}`,
    dur: b.dur ?? cur.duration, allowOverlap: b.allowOverlap
  }, cur.id);
  const moved = v.date !== cur.date || v.start !== cur.start_min || String(v.professionalId) !== String(cur.professional_id);
  const row = (await q(
    `UPDATE appointments SET client_id=$3, professional_id=$4, procedure_id=$5, date=$6, start_min=$7, duration=$8,
            status = CASE WHEN $9 THEN 'agendado' ELSE status END, wa_sent = CASE WHEN $9 THEN false ELSE wa_sent END
      WHERE id=$1 AND clinic_id=$2 RETURNING *, (sign_image IS NOT NULL) AS has_sign, (photo_image IS NOT NULL) AS has_photo`,
    [cur.id, req.user.clinicId, v.clientId, v.professionalId, v.procedureId, v.date, v.start, v.dur, moved])).rows[0];
  res.json(S.appt(row));
}));

r.post('/:id/status', wrap(async (req, res) => {
  const cur = await loadAppt(req.user.clinicId, req.params.id);
  const to = req.body.status;
  if (!(TRANSITIONS[cur.status] || []).includes(to)) throw bad('Essa mudança de situação não é permitida');
  if (!isStaff(req.user)) {
    if (String(cur.professional_id) !== req.user.id || to !== 'atendimento') throw forbidden();
  }
  const row = (await q(
    `UPDATE appointments SET status=$3 WHERE id=$1 AND clinic_id=$2 RETURNING *, (sign_image IS NOT NULL) AS has_sign, (photo_image IS NOT NULL) AS has_photo`,
    [cur.id, req.user.clinicId, to])).rows[0];
  res.json(S.appt(row));
}));

// Baixa do atendimento: precisa de assinatura ou foto
r.post('/:id/finish', wrap(async (req, res) => {
  const cur = await loadAppt(req.user.clinicId, req.params.id);
  if (!isStaff(req.user) && String(cur.professional_id) !== req.user.id) throw forbidden();
  if (cur.status !== 'atendimento') throw bad('Inicie o atendimento antes de dar baixa');
  const sign = req.body.sign || null, photo = req.body.photo || null;
  if (!sign && !photo) throw bad('Colha a assinatura ou tire a foto do paciente');
  for (const img of [sign, photo]) {
    if (img && (typeof img !== 'string' || img.length > MAX_IMAGE_CHARS || !IMG.test(img))) throw bad('Imagem inválida ou grande demais');
  }
  const row = (await q(
    `UPDATE appointments SET status='concluido', done_at=now(), done_by=$3, sign_image=$4, photo_image=$5
      WHERE id=$1 AND clinic_id=$2 RETURNING *, (sign_image IS NOT NULL) AS has_sign, (photo_image IS NOT NULL) AS has_photo`,
    [cur.id, req.user.clinicId, req.user.id, sign, photo])).rows[0];
  res.json(S.appt(row));
}));

r.get('/:id/proof', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const row = (await q(
    `SELECT a.sign_image, a.photo_image, a.done_at, u.name AS done_by FROM appointments a LEFT JOIN users u ON u.id=a.done_by
      WHERE a.id=$1 AND a.clinic_id=$2`, [req.params.id, req.user.clinicId])).rows[0];
  if (!row) throw notFound('Agendamento não encontrado');
  res.json({ sign: row.sign_image, photo: row.photo_image, doneAt: row.done_at, doneBy: row.done_by });
}));

// Importação de agenda em lote
r.post('/bulk', staff, wrap(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : null;
  if (!items) throw bad('Envie a lista de agendamentos');
  if (items.length > 2000) throw bad('Envie no máximo 2000 agendamentos por vez');
  const out = await tx(async c => {
    const cid = req.user.clinicId;
    const pros = new Set((await c.query(`SELECT id FROM users WHERE clinic_id=$1 AND role='professional' AND active`, [cid])).rows.map(x => String(x.id)));
    const clientsByKey = new Map(), clientsByName = new Map();
    (await c.query('SELECT id,name,phone_key FROM clients WHERE clinic_id=$1', [cid])).rows.forEach(x => {
      if (x.phone_key.length >= 8) clientsByKey.set(x.phone_key, String(x.id));
      clientsByName.set(x.name.toLowerCase(), String(x.id));
    });
    const procs = new Map();
    (await c.query('SELECT id,name FROM procedures WHERE clinic_id=$1', [cid])).rows.forEach(x => procs.set(x.name.toLowerCase(), String(x.id)));
    const procIds = new Set([...procs.values()]);
    let created = 0, newClients = 0, newProcedures = 0, skipped = 0;
    for (const it of items) {
      const start = toMin(it && it.time);
      const dur = parseInt(it && it.dur, 10) || 30;
      if (!it || !isDate(it.date) || start === null || start < OPEN_MIN || start >= CLOSE_MIN || !(dur >= 5 && dur <= 480)
        || !pros.has(String(it.professionalId)) || !str(it.clientName, 140)) { skipped++; continue; }
      // procedimento
      let pid = null;
      if (isId(it.procedureId) && procIds.has(String(it.procedureId))) pid = String(it.procedureId);
      else {
        const pn = str(it.procedureName, 120);
        if (!pn) { skipped++; continue; }
        pid = procs.get(pn.toLowerCase());
        if (!pid) {
          pid = String((await c.query(`INSERT INTO procedures (clinic_id,name,duration,price) VALUES ($1,$2,$3,0) RETURNING id`, [cid, pn, dur])).rows[0].id);
          procs.set(pn.toLowerCase(), pid); procIds.add(pid); newProcedures++;
        }
      }
      // cliente
      const name = str(it.clientName, 140), key = phoneKey(it.phone);
      let cl = (digits(it.phone).length >= 8 && clientsByKey.get(key)) || clientsByName.get(name.toLowerCase());
      if (!cl) {
        cl = String((await c.query(`INSERT INTO clients (clinic_id,name,phone,phone_key) VALUES ($1,$2,$3,$4) RETURNING id`, [cid, name, str(it.phone, 40), digits(it.phone).length >= 8 ? key : ''])).rows[0].id);
        clientsByName.set(name.toLowerCase(), cl);
        if (digits(it.phone).length >= 8) clientsByKey.set(key, cl);
        newClients++;
      }
      await c.query(
        `INSERT INTO appointments (clinic_id, client_id, professional_id, procedure_id, date, start_min, duration, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [cid, cl, it.professionalId, pid, it.date, start, dur, req.user.id]);
      created++;
    }
    return { created, newClients, newProcedures, skipped };
  });
  res.json(out);
}));

module.exports = r;
