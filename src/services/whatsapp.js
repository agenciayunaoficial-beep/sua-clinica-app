'use strict';
/**
 * WhatsApp por clínica (whatsapp-web.js).
 * - Cada clínica tem uma sessão própria (um Chromium em segundo plano).
 * - O QR Code vira imagem (data URL) para a tela mostrar.
 * - O envio passa por uma fila com pausa aleatória entre mensagens (reduz risco de bloqueio).
 * - Se a biblioteca não estiver instalada (ou WA_DRIVER=demo), o sistema cai no modo demonstração.
 * Para os testes automáticos existe WA_DRIVER=fake (não abre navegador nenhum).
 */
const path = require('path');
const { q } = require('../db');
const { digits } = require('../util');

const DRIVER = (process.env.WA_DRIVER || '').toLowerCase();
const DATA_DIR = process.env.WA_DATA_DIR || path.join(process.cwd(), '.wwebjs');
const MAX_SESSIONS = Number(process.env.WA_MAX_SESSIONS) || 5;
const AUTH_TIMEOUT = Number(process.env.WA_AUTH_TIMEOUT_MS) || 180000;   // servidores pequenos demoram para abrir o WhatsApp Web
const MIN_GAP = Number(process.env.WA_MIN_GAP_MS ?? 4000);
const MAX_GAP = Number(process.env.WA_MAX_GAP_MS ?? 9000);

let lib = null;
if (DRIVER !== 'demo' && DRIVER !== 'fake') {
  try { lib = require('whatsapp-web.js'); } catch (_) { lib = null; }
}
let QR = null;
try { QR = require('qrcode'); } catch (_) { QR = null; }

const mode = () => (DRIVER === 'fake' || lib) ? 'real' : 'demo';

// clinicId -> { status, qr, number, error, client, queue, working }
const sessions = new Map();
const key = id => String(id);

function sess(id) {
  if (!sessions.has(key(id))) sessions.set(key(id), { status: 'disconnected', qr: null, number: '', error: '', client: null, queue: [], working: false });
  return sessions.get(key(id));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const gap = () => MIN_GAP + Math.random() * Math.max(0, MAX_GAP - MIN_GAP);

function state(clinicId) {
  const s = sess(clinicId);
  return { mode: mode(), status: s.status, qr: s.status === 'qr' ? s.qr : null, number: s.number, error: s.error, queued: s.queue.length };
}

async function setAutostart(clinicId, v) {
  try { await q('UPDATE clinics SET wa_autostart=$2 WHERE id=$1', [clinicId, v]); } catch (_) {}
}

/** Número do cliente → formato do WhatsApp (só dígitos, com 55 na frente). */
function normalizePhone(raw) {
  let d = digits(raw);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (d.length < 12 || d.length > 15) return '';
  return d;
}

/* ---------------- conexão ---------------- */
async function connect(clinicId) {
  const s = sess(clinicId);
  if (mode() === 'demo') { const e = new Error('Conexão real indisponível neste servidor.'); e.status = 503; throw e; }
  if (['starting', 'qr', 'connected'].includes(s.status)) return state(clinicId);
  const active = [...sessions.values()].filter(x => ['starting', 'qr', 'connected'].includes(x.status)).length;
  if (active >= MAX_SESSIONS) { const e = new Error('Limite de conexões simultâneas do servidor atingido. Tente mais tarde.'); e.status = 503; throw e; }
  s.status = 'starting'; s.qr = null; s.error = '';

  if (DRIVER === 'fake') { s.fake = true; s.status = 'qr'; s.qr = 'data:image/png;base64,FAKE'; return state(clinicId); }

  const { Client, LocalAuth } = lib;
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'clinica-' + clinicId, dataPath: DATA_DIR }),
    authTimeoutMs: AUTH_TIMEOUT,
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      protocolTimeout: 240000,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--disable-extensions',
        '--disable-background-networking', '--disable-default-apps', '--disable-sync', '--disable-translate', '--mute-audio', '--no-first-run', '--disable-software-rasterizer']
    }
  });
  s.client = client;

  client.on('qr', async (code) => {
    try { s.qr = QR ? await QR.toDataURL(code, { margin: 1, width: 280 }) : null; } catch (_) { s.qr = null; }
    s.status = 'qr';
  });
  client.on('authenticated', () => { s.status = 'starting'; s.qr = null; });
  client.on('ready', async () => {
    s.status = 'connected'; s.qr = null; s.error = '';
    s.number = (client.info && client.info.wid && client.info.wid.user) || '';
    await setAutostart(clinicId, true);
    pump(clinicId);
  });
  client.on('auth_failure', (m) => { s.status = 'error'; s.error = 'Falha na autenticação: ' + m; });
  client.on('disconnected', async (reason) => {
    s.status = 'disconnected'; s.qr = null; s.number = '';
    s.error = reason === 'LOGOUT' ? '' : 'Conexão perdida (' + reason + '). Conecte novamente.';
    try { await client.destroy(); } catch (_) {}
    s.client = null;
    if (reason === 'LOGOUT') await setAutostart(clinicId, false);
  });
  client.on('message', (msg) => { onIncoming(clinicId, msg).catch(e => console.error('WhatsApp (resposta):', e.message)); });

  client.initialize().catch(async (e) => {
    const m = String((e && e.message) || e);
    console.error('WhatsApp (iniciar):', m);
    s.status = 'error';
    s.error = /timeout|exceeded|waiting failed/i.test(m)
      ? 'O WhatsApp Web demorou demais para abrir no servidor. Tente de novo; se continuar, o servidor está com pouca memória ou processador.'
      : 'Não foi possível iniciar o WhatsApp: ' + m;
    try { await client.destroy(); } catch (_) {}
    s.client = null;
  });
  return state(clinicId);
}

async function disconnect(clinicId) {
  const s = sess(clinicId);
  await setAutostart(clinicId, false);
  s.queue.splice(0).forEach(j => failJob(j, 'WhatsApp desconectado antes do envio'));
  if (s.fake) { s.fake = false; }
  if (s.client) {
    try { await s.client.logout(); } catch (_) {}
    try { await s.client.destroy(); } catch (_) {}
    s.client = null;
  }
  s.status = 'disconnected'; s.qr = null; s.number = ''; s.error = '';
  return state(clinicId);
}

/* ---------------- envio (fila) ---------------- */
async function markJob(job, status, detail) {
  try {
    await q('UPDATE message_log SET status=$2, detail=$3 WHERE id=$1', [job.logId, status, detail || '']);
    if (status === 'enviado' && job.appointmentId && job.kind !== 'Lembrete') {
      await q('UPDATE appointments SET wa_sent=true WHERE id=$1 AND clinic_id=$2', [job.appointmentId, job.clinicId]);
    }
  } catch (e) { console.error('WhatsApp (log):', e.message); }
}
const failJob = (job, why) => markJob(job, 'falhou', why);

/** Coloca uma mensagem na fila. Devolve imediatamente; o resultado fica em message_log.status. */
function enqueue(clinicId, job) {
  const s = sess(clinicId);
  s.queue.push({ ...job, clinicId });
  pump(clinicId);
}

async function sendNow(s, phone, text) {
  if (s.fake) {
    if (/0000000$/.test(digits(phone))) throw new Error('Esse número não tem WhatsApp');
    s.sent = s.sent || []; s.sent.push({ phone, text }); return;
  }
  const num = normalizePhone(phone);
  if (!num) throw new Error('Telefone inválido');
  const id = await s.client.getNumberId(num);
  if (!id) throw new Error('Esse número não tem WhatsApp');
  await s.client.sendMessage(id._serialized, text);
}

async function pump(clinicId) {
  const s = sess(clinicId);
  if (s.working) return;
  s.working = true;
  try {
    while (s.queue.length) {
      if (s.status !== 'connected') break;
      const job = s.queue[0];
      try {
        await sendNow(s, job.phone, job.text);
        s.queue.shift();
        await markJob(job, 'enviado');
      } catch (e) {
        s.queue.shift();
        await failJob(job, e.message || 'Erro ao enviar');
      }
      if (s.queue.length) await sleep(s.fake ? 0 : gap());
    }
  } finally { s.working = false; }
}

/* ---------------- respostas dos clientes (1 = confirmo, 2 = remarcar) ---------------- */
async function onIncoming(clinicId, msg) {
  if (!msg || msg.fromMe || msg.isStatus || String(msg.from || '').endsWith('@g.us')) return;
  const body = String(msg.body || '').trim();
  const from = digits(String(msg.from || '').split('@')[0]);
  await handleReply(clinicId, from, body, text => msg.reply(text));
}

async function handleReply(clinicId, fromDigits, body, reply) {
  const choice = body === '1' ? 'confirm' : body === '2' ? 'resched' : null;
  if (!choice || fromDigits.length < 8) return;
  const k8 = fromDigits.slice(-8);
  const cl = (await q(`SELECT id, name, phone FROM clients WHERE clinic_id=$1 AND right(phone_key,8)=$2 ORDER BY id LIMIT 1`, [clinicId, k8])).rows[0];
  if (!cl) return;
  const today = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  // só responde se houver uma confirmação nossa aguardando (evita responder "1" solto)
  const ap = (await q(
    `SELECT a.id, a.date, a.start_min FROM appointments a
      WHERE a.clinic_id=$1 AND a.client_id=$2 AND a.status IN ('agendado','confirmado') AND a.date>=$3 AND a.wa_sent
      ORDER BY a.date, a.start_min LIMIT 1`, [clinicId, cl.id, today])).rows[0];
  if (!ap) return;
  if (choice === 'confirm') {
    await q(`UPDATE appointments SET status='confirmado' WHERE id=$1 AND clinic_id=$2 AND status='agendado'`, [ap.id, clinicId]);
    await q(`INSERT INTO message_log (clinic_id, kind, to_name, to_phone, body, status, appointment_id) VALUES ($1,'Resposta do cliente',$2,$3,$4,'recebido',$5)`,
      [clinicId, cl.name, cl.phone, 'Respondeu 1 — confirmou o agendamento', ap.id]);
    await reply('Confirmado! ✅ Te esperamos.');
  } else {
    await q(`INSERT INTO message_log (clinic_id, kind, to_name, to_phone, body, status, appointment_id) VALUES ($1,'Resposta do cliente',$2,$3,$4,'recebido',$5)`,
      [clinicId, cl.name, cl.phone, 'Respondeu 2 — quer remarcar', ap.id]);
    await reply('Certo! A clínica vai entrar em contato para remarcar. 💬');
  }
}

/* ---------------- inicialização ---------------- */
async function restoreAll() {
  if (mode() !== 'real' || DRIVER === 'fake') return;
  try {
    await q(`UPDATE message_log SET status='falhou', detail='O servidor reiniciou antes do envio' WHERE status='na fila'`);
    const rows = (await q('SELECT id FROM clinics WHERE wa_autostart AND status<>$1 ORDER BY id', ['canceled'])).rows;
    for (const r of rows) {
      try { await connect(r.id); } catch (e) { console.error('WhatsApp (retomar):', e.message); }
      await sleep(5000);
    }
  } catch (e) { console.error('WhatsApp (retomar):', e.message); }
}

async function shutdown() {
  for (const s of sessions.values()) { if (s.client) { try { await s.client.destroy(); } catch (_) {} } }
}

/** Só para os testes: simula a leitura do QR Code. */
function fakeScan(clinicId) {
  const s = sess(clinicId);
  if (DRIVER !== 'fake' || s.status !== 'qr') return false;
  s.status = 'connected'; s.qr = null; s.number = '5582900000000';
  pump(clinicId);
  return true;
}

module.exports = { fakeScan, mode, state, connect, disconnect, enqueue, normalizePhone, restoreAll, shutdown, handleReply,
  // só para os testes
  _sess: sess };
