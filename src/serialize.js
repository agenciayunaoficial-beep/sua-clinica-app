'use strict';
const { hhmm } = require('./util');

const APPT_COLS = `a.id, a.date, a.start_min, a.duration, a.professional_id, a.client_id, a.procedure_id, a.status, a.wa_sent,
  a.done_at, (a.sign_image IS NOT NULL) AS has_sign, (a.photo_image IS NOT NULL) AS has_photo`;

const appt = r => ({
  id: String(r.id), date: r.date, time: hhmm(r.start_min), dur: r.duration,
  pro: String(r.professional_id), client: String(r.client_id), proc: String(r.procedure_id),
  status: r.status, wa: !!r.wa_sent, doneAt: r.done_at ? new Date(r.done_at).toISOString() : null,
  hasSign: !!r.has_sign, hasPhoto: !!r.has_photo
});
const block = r => ({ id: String(r.id), date: r.date, pro: String(r.professional_id), start: hhmm(r.start_min), end: hhmm(r.end_min), reason: r.reason });
const client = r => ({ id: String(r.id), name: r.name, phone: r.phone, notes: r.notes });
const proc = r => ({ id: String(r.id), name: r.name, dur: r.duration, price: Number(r.price), active: r.active });
const pro = r => ({ id: String(r.id), name: r.name, color: r.color, active: r.active });
const member = r => ({ id: String(r.id), name: r.name, email: r.email, role: r.role, color: r.color, active: r.active });
const message = r => ({ id: String(r.id), t: new Date(r.created_at).toISOString(), kind: r.kind, name: r.to_name, to: r.to_phone, text: r.body, status: r.status });

module.exports = { APPT_COLS, appt, block, client, proc, pro, member, message };
