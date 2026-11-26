'use strict';
const { hhmm } = require('./util');

const APPT_COLS = `a.id, a.date, a.start_min, a.duration, a.professional_id, a.client_id, a.procedure_id, a.status, a.wa_sent,
  a.done_at, a.sale_id, (a.sign_image IS NOT NULL) AS has_sign, (a.photo_image IS NOT NULL) AS has_photo,
  EXISTS (SELECT 1 FROM sales s WHERE s.appointment_id=a.id AND s.status='ativa') AS paid`;

const appt = r => ({
  id: String(r.id), date: r.date, time: hhmm(r.start_min), dur: r.duration,
  pro: String(r.professional_id), client: String(r.client_id), proc: String(r.procedure_id),
  status: r.status, wa: !!r.wa_sent, doneAt: r.done_at ? new Date(r.done_at).toISOString() : null,
  hasSign: !!r.has_sign, hasPhoto: !!r.has_photo,
  saleId: r.sale_id ? String(r.sale_id) : null,
  ...(r.paid === undefined ? {} : { paid: !!r.paid })
});
const block = r => ({ id: String(r.id), date: r.date, pro: String(r.professional_id), start: hhmm(r.start_min), end: hhmm(r.end_min), reason: r.reason });
const client = r => ({ id: String(r.id), name: r.name, phone: r.phone, notes: r.notes });
const proc = r => ({ id: String(r.id), name: r.name, dur: r.duration, price: Number(r.price), active: r.active });
const pro = r => ({ id: String(r.id), name: r.name, color: r.color, active: r.active, phone: r.phone || '' });
const member = r => ({ id: String(r.id), name: r.name, email: r.email, role: r.role, color: r.color, active: r.active, phone: r.phone || '' });
const message = r => ({ id: String(r.id), t: new Date(r.created_at).toISOString(), kind: r.kind, name: r.to_name, to: r.to_phone, text: r.body, status: r.status, detail: r.detail || '', appt: r.appointment_id ? String(r.appointment_id) : null });

const SALE_SELECT = `SELECT s.*, c.name AS client_name,
  COALESCE((SELECT json_agg(json_build_object('method',p.method,'amount',p.amount::float8,'installments',p.installments) ORDER BY p.id) FROM sale_payments p WHERE p.sale_id=s.id),'[]'::json) AS payments,
  (SELECT count(*)::int FROM appointments a WHERE a.sale_id=s.id AND a.status='concluido') AS used,
  (SELECT count(*)::int FROM appointments a WHERE a.sale_id=s.id AND a.status IN ('agendado','confirmado','atendimento')) AS scheduled
  FROM sales s JOIN clients c ON c.id=s.client_id`;
const sale = r => ({
  id: String(r.id), client: String(r.client_id), clientName: r.client_name, appt: r.appointment_id ? String(r.appointment_id) : null,
  kind: r.kind, name: r.name, total: Number(r.total), sessions: r.sessions, validUntil: r.valid_until || null, date: r.sale_date,
  status: r.status, note: r.note, payments: r.payments || [], used: r.used || 0, scheduled: r.scheduled || 0
});

module.exports = { SALE_SELECT, sale, APPT_COLS, appt, block, client, proc, pro, member, message };
