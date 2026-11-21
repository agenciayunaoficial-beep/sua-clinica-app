'use strict';

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const bad = (m, code) => new HttpError(400, m, code);
const notFound = (m = 'Não encontrado') => new HttpError(404, m);
const forbidden = (m = 'Sem permissão para essa ação') => new HttpError(403, m);
const conflict = (m, code) => new HttpError(409, m, code);

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const isId = v => /^\d{1,15}$/.test(String(v ?? ''));
const isDate = s => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T12:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
};
const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const toMin = s => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h > 23 || mi > 59 ? null : h * 60 + mi;
};
const digits = s => String(s ?? '').replace(/\D/g, '');
const phoneKey = s => digits(s).slice(-9);
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const email = v => str(v, 160).toLowerCase();
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isColor = v => /^#[0-9a-fA-F]{6}$/.test(String(v ?? ''));
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const todayStr = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); // horário de Brasília

module.exports = { HttpError, bad, notFound, forbidden, conflict, wrap, isId, isDate, hhmm, toMin, digits, phoneKey, str, email, isEmail, isColor, addDays, todayStr };
