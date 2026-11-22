/* Sua Clínica — telas do sistema (conversam com o servidor em /api) */
const $ = s => document.querySelector(s);
const z = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
const TODAY = iso(new Date());
const addD = (s, n) => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); };
const tm = t => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
const mt = m => z(Math.floor(m / 60)) + ':' + z(m % 60);
const longD = s => new Date(s + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortD = s => new Date(s + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const fmtDT = s => new Date(s).toLocaleString('pt-BR');
const START = 8 * 60, END = 19 * 60, STEP = 10, RH = 26, ROWS = (END - START) / STEP;
const STAT = { agendado: 'Agendado', confirmado: 'Confirmado', atendimento: 'Em atendimento', concluido: 'Concluído', cancelado: 'Cancelado' };
const ROLE = { admin: 'Administradora', receptionist: 'Recepção', professional: 'Profissional' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = n => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const digits = s => String(s || '').replace(/\D/g, '');

const LOGO = '<svg viewBox="0 0 64 46" aria-hidden="true"><path d="M4 42A28 28 0 0 1 60 42Z" fill="#E8590C"/><path d="M8 42A24 24 0 0 1 56 42Z" fill="#FFF1E0"/><path d="M10.5 42A21.5 21.5 0 0 1 53.5 42Z" fill="#FF8A2B"/><g stroke="#FFF1E0" stroke-width="1.8" stroke-linecap="round"><path d="M32 42L53.2 36.3"/><path d="M32 42L50.6 31.3"/><path d="M32 42L46.9 26.9"/><path d="M32 42L32 20.5"/><path d="M32 42L17.1 26.9"/><path d="M32 42L13.4 31.3"/><path d="M32 42L10.8 36.3"/></g><circle cx="32" cy="42" r="2.4" fill="#FFF1E0"/><path d="M33 14C37 5 46 4.5 48.5 6C47.5 14 40.5 17 33 14Z" fill="#2F9E44"/><path d="M32.5 14.5L32 9" stroke="#1F7A33" stroke-width="1.6" stroke-linecap="round"/></svg>';
document.querySelectorAll('.lg').forEach(e => { e.innerHTML = LOGO; e.style.display = 'contents'; });

let S = null;
const ui = { page: 'agenda', date: TODAY, view: 'dia', hojePro: null, q: '' };
const pro = id => S.pros.find(p => p.id === id) || { id, name: '(removida)', color: '#999', active: false };
const cli = id => S.clients.find(c => c.id === id) || { id, name: '(cliente removido)', phone: '', notes: '' };
const prc = id => S.procs.find(p => p.id === id) || { id, name: '(procedimento removido)', dur: 30, price: 0 };
const apt = id => S.appts.find(a => a.id === id);
const activePros = () => S.pros.filter(p => p.active);
const activeProcs = () => S.procs.filter(p => p.active);
const isStaff = () => S && (S.me.role === 'admin' || S.me.role === 'receptionist');
const isAdmin = () => S && S.me.role === 'admin';

function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 3200); }

/* ---------- comunicação com o servidor ---------- */
class ApiError extends Error { constructor(m, status, code, data) { super(m); this.status = status; this.code = code; this.data = data; } }
async function api(method, url, body) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, opt); } catch (e) { throw new ApiError('Sem conexão com o servidor. Verifique a internet.', 0); }
  let data = null; try { data = await res.json(); } catch (e) {}
  if (res.status === 401 && !url.startsWith('/api/auth/login')) { showLogin(); throw new ApiError('Sessão expirada. Entre novamente.', 401); }
  if (res.status === 402) { showFatal((data && data.error) || 'Assinatura cancelada.'); throw new ApiError(data.error, 402, 'canceled'); }
  if (!res.ok) throw new ApiError((data && data.error) || 'Erro inesperado. Tente novamente.', res.status, data && data.code, data);
  return data;
}
/** Executa uma ação e mostra o erro (se houver) em vez de quebrar a tela. */
async function run(fn) {
  try { return await fn(); }
  catch (e) { if (e.status !== 401 && e.status !== 402) toast(e.message || 'Erro inesperado'); return null; }
}

/* ---------- login / sessão ---------- */
function showLogin() { S = null; $('#app').classList.add('hide'); $('#fatal').classList.remove('on'); closeM(); $('#login').classList.add('on'); setTimeout(() => $('#l_e').focus(), 50); }
function showFatal(msg) { $('#fatal_msg').textContent = msg; $('#fatal').classList.add('on'); }
async function doLogin(e) {
  e.preventDefault();
  const b = $('#l_b'); b.disabled = true; $('#l_err').textContent = '';
  try {
    await api('POST', '/api/auth/login', { email: $('#l_e').value, password: $('#l_p').value });
    $('#l_p').value = '';
    await boot();
  } catch (err) { $('#l_err').textContent = err.message; }
  b.disabled = false;
  return false;
}
async function doLogout() { try { await api('POST', '/api/auth/logout', {}); } catch (e) {} location.reload(); }

function loadSim() { try { return localStorage.getItem('sc_wa_sim') !== '0'; } catch (e) { return true; } }
function saveSim(v) { try { localStorage.setItem('sc_wa_sim', v ? '1' : '0'); } catch (e) {} }

async function boot() {
  try {
    const d = await api('GET', '/api/bootstrap');
    S = d; S.wa = { connected: loadSim(), tpl: d.templates };
    ui.hojePro = S.me.role === 'professional' ? S.me.id : (activePros()[0] || {}).id || null;
    $('#login').classList.remove('on'); $('#app').classList.remove('hide');
    $('#clin').textContent = S.clinic.name; $('#role').textContent = S.me.name + ' · ' + ROLE[S.me.role];
    document.querySelectorAll('.nav').forEach(b => {
      const p = b.dataset.p;
      b.classList.toggle('hide', (p === 'whatsapp' && !isStaff()) || (p === 'equipe' && !isStaff()));
    });
    if (!isStaff() && (ui.page === 'whatsapp' || ui.page === 'equipe')) ui.page = 'agenda';
    render();
  } catch (e) { if (e.status !== 401 && e.status !== 402) { showLogin(); $('#l_err').textContent = e.message; } }
}
document.querySelectorAll('.nav').forEach(b => b.onclick = () => go(b.dataset.p));
function go(p) { ui.page = p; render(); }
async function reload() {
  const d = await api('GET', `/api/bootstrap?from=${S.window.from}&to=${S.window.to}`);
  Object.assign(S, { clinic: d.clinic, pros: d.pros, procs: d.procs, clients: d.clients, appts: d.appts, blocks: d.blocks, log: d.log, window: d.window });
  S.wa.tpl = d.templates;
}
async function ensureRange(d) {
  const lo = addD(S.window.from, 25), hi = addD(S.window.to, -25);
  if (d >= lo && d <= hi) return;
  const from = addD(d, -60), to = addD(d, 300);
  const r = await api('GET', `/api/appointments?from=${from}&to=${to}`);
  S.appts = r.appts; S.blocks = r.blocks; S.window = { from, to };
}
// atualiza sozinho a cada 30 s (recepção e profissionais veem as mudanças uns dos outros)
setInterval(async () => {
  if (!S || document.hidden || $('#ov').classList.contains('on') || !['agenda', 'hoje'].includes(ui.page)) return;
  try { await reload(); render(); } catch (e) {}
}, 30000);

const TITLES = { agenda: 'Agenda', hoje: 'Atendimento do dia', clientes: 'Clientes', whatsapp: 'WhatsApp', equipe: 'Equipe e Cadastros' };
function render() {
  if (!S) return;
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('on', b.dataset.p === ui.page));
  $('#ttl').textContent = TITLES[ui.page];
  const price = S.clinic.plan === 'annual' ? 'R$ 899,90/ano' : 'R$ 99,90/mês';
  $('#planbox').innerHTML = `<b>Plano ${esc(S.clinic.planLabel)}</b><br>${price}<br>${S.clinic.plan === 'annual' ? 'Até 5 usuários' : '2 profissionais + recepcionista'}`;
  ({ agenda: pgAgenda, hoje: pgHoje, clientes: pgClientes, whatsapp: pgWa, equipe: pgEquipe })[ui.page]();
}
const warnHtml = () => S.clinic.status === 'past_due' ? '<div class="warn">⚠️ Há um pagamento pendente na assinatura. Regularize para não perder o acesso.</div>' : '';

/* ---------- modal ---------- */
let camStream = null;
function stopCam() { if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; } }
function modal(html, wide) { $('#mb').className = 'md-box' + (wide ? ' w' : ''); $('#mb').innerHTML = html; $('#ov').classList.add('on'); }
function closeM() { stopCam(); $('#ov').classList.remove('on'); }
$('#ov').addEventListener('mousedown', e => { if (e.target.id === 'ov') closeM(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeM(); });

function openMe() {
  if (!S) return;
  modal(`<h2>${esc(S.me.name)}</h2><p class="kv">${esc(S.me.email)} · ${ROLE[S.me.role]}</p><p class="kv">${esc(S.clinic.name)}</p>
  <h3 style="margin-top:18px">Alterar senha</h3>
  <label>Senha atual</label><input type="password" id="pw_c" autocomplete="current-password">
  <label>Nova senha (mínimo 8 caracteres)</label><input type="password" id="pw_n" autocomplete="new-password">
  <div class="acts"><button class="btn pri" onclick="savePw()">Salvar senha</button><button class="btn red" onclick="doLogout()">Sair do sistema</button><button class="btn" onclick="closeM()">Fechar</button></div>`);
}
async function savePw() {
  const r = await run(() => api('POST', '/api/auth/password', { current: $('#pw_c').value, next: $('#pw_n').value }));
  if (r) { closeM(); toast('Senha alterada'); }
}

/* ---------- agenda ---------- */
function pgAgenda() {
  const d = ui.date, st = isStaff();
  const nav = `<div class="bar">
    <button class="btn" onclick="shift(-1)">‹</button><button class="btn" onclick="goDate(TODAY)">Hoje</button><button class="btn" onclick="shift(1)">›</button>
    <div class="dt">${ui.view === 'dia' ? longD(d) : new Date(d + 'T12:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</div>
    <div class="seg"><button class="${ui.view === 'dia' ? 'on' : ''}" onclick="ui.view='dia';render()">Dia</button><button class="${ui.view === 'mes' ? 'on' : ''}" onclick="ui.view='mes';render()">Mês</button></div>
    <div class="sp"></div>
    ${st ? '<button class="btn" onclick="formImportAppt()">⬇ Importar agenda</button>' : ''}
    <button class="btn" onclick="formBlock()">🚫 Bloquear ${st ? 'profissional' : 'minha agenda'}</button>
    ${st ? '<button class="btn pri" onclick="formAppt()">+ Novo agendamento</button>' : ''}</div>`;
  const legend = `<div class="legend">${Object.entries(STAT).map(([k, v]) => `<span><i class="s-${k}" style="border:1px solid"></i>${v}</span>`).join('')}<span><i style="background:#ddd"></i>Bloqueio</span></div>`;
  $('#view').innerHTML = warnHtml() + nav + (ui.view === 'dia' ? legend + dayGrid() : monthGrid());
  if (ui.view === 'dia') { const w = $('.gw'); if (w) { const n = new Date(); const nm = n.getHours() * 60 + n.getMinutes(); w.scrollTop = (d === TODAY && nm >= START && nm < END) ? Math.max(0, (nm - START) / STEP * RH - 120) : 0; } }
}
async function goDate(d) { await run(async () => { await ensureRange(d); ui.date = d; render(); }); }
async function shift(n) {
  const nd = ui.view === 'dia' ? addD(ui.date, n) : (() => { const x = new Date(ui.date + 'T12:00'); x.setMonth(x.getMonth() + n, 1); return iso(x); })();
  await goDate(nd);
}
function lanes(list) {
  list.sort((a, b) => a.s - b.s || a.e - b.e); const out = []; let cl = [], end = 0;
  const flush = () => { const n = Math.max(...cl.map(x => x.lane)) + 1; cl.forEach(x => x.n = n); out.push(...cl); cl = []; };
  list.forEach(x => {
    if (cl.length && x.s >= end) { flush(); end = 0; }
    const used = cl.filter(c => c.e > x.s).map(c => c.lane); let l = 0; while (used.includes(l)) l++;
    x.lane = l; cl.push(x); end = Math.max(end, x.e);
  });
  if (cl.length) flush(); return out;
}
function dayGrid() {
  const ps = activePros(), n = ps.length;
  if (!n) return '<div class="card empty">Nenhuma profissional cadastrada ainda. Cadastre em <b>Equipe e Cadastros</b>.</div>';
  const head = `<div class="gh" style="grid-template-columns:64px repeat(${n},1fr)"><div></div>${ps.map(p => {
    const c = S.appts.filter(a => a.date === ui.date && a.pro === p.id && a.status !== 'cancelado').length;
    return `<div class="ph" style="border-top-color:${p.color}">${esc(p.name)}<small>${c} paciente${c == 1 ? '' : 's'}</small></div>`;
  }).join('')}</div>`;
  let tl = ''; for (let i = 0; i < ROWS; i++) { const m = START + i * STEP; tl += `<div class="${m % 60 == 0 ? 'h' : ''}">${mt(m)}</div>`; }
  const cols = ps.map(p => {
    const items = lanes(S.appts.filter(a => a.date === ui.date && a.pro === p.id && a.status !== 'cancelado').map(a => ({ a, s: tm(a.time), e: tm(a.time) + a.dur })));
    const aps = items.map(({ a, s, e, lane, n }) => {
      const top = (s - START) / STEP * RH, h = (e - s) / STEP * RH - 2;
      return `<div class="ap s-${a.status}" style="top:${top}px;height:${h}px;left:calc(${lane}*100%/${n} + 3px);width:calc(100%/${n} - 6px)" onclick="event.stopPropagation();showAppt('${a.id}')" title="${esc(cli(a.client).name)}"><b>${a.time} ${esc(cli(a.client).name)}</b><span>${esc(prc(a.proc).name)}${a.wa ? ' · 💬' : ''}</span></div>`;
    }).join('');
    const bl = S.blocks.filter(b => b.date === ui.date && b.pro === p.id).map(b => {
      const s = Math.max(tm(b.start), START), e = Math.min(tm(b.end), END);
      if (e <= s) return '';
      return `<div class="blk" style="top:${(s - START) / STEP * RH}px;height:${(e - s) / STEP * RH - 2}px" onclick="event.stopPropagation();showBlock('${b.id}')">🚫 Bloqueada ${b.start}–${b.end}<br><small>${esc(b.reason || '')}</small></div>`;
    }).join('');
    let now = ''; if (ui.date === TODAY) { const nw = new Date(); const m = nw.getHours() * 60 + nw.getMinutes(); if (m >= START && m <= END) now = `<div class="now" style="top:${(m - START) / STEP * RH}px"></div>`; }
    return `<div class="col" style="height:${ROWS * RH}px" onclick="colClick(event,'${p.id}')">${bl}${aps}${now}</div>`;
  }).join('');
  return `<div class="gw">${head}<div class="gb" style="grid-template-columns:64px repeat(${n},1fr)"><div class="tl">${tl}</div>${cols}</div></div>`;
}
function colClick(e, pid) {
  if (!isStaff()) return;
  const r = e.currentTarget.getBoundingClientRect();
  const m = START + Math.floor((e.clientY - r.top) / RH) * STEP;
  formAppt(null, { pro: pid, time: mt(m) });
}
function monthGrid() {
  const f = new Date(ui.date + 'T12:00'); f.setDate(1); const mo = f.getMonth();
  const s = new Date(f); s.setDate(1 - f.getDay());
  let h = '<div class="mg">' + ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map(x => `<div class="mh">${x}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(s); d.setDate(s.getDate() + i); const k = iso(d);
    if (i >= 35 && d.getMonth() !== mo) break;
    const dots = activePros().map(p => {
      const c = S.appts.filter(a => a.date === k && a.pro === p.id && a.status !== 'cancelado').length; const b = S.blocks.some(x => x.date === k && x.pro === p.id);
      return (c || b) ? `<div class="dot"><i style="background:${p.color}"></i>${c} ${c == 1 ? 'paciente' : 'pacientes'}${b ? ' · 🚫' : ''}</div>` : '';
    }).join('');
    h += `<div class="md ${d.getMonth() !== mo ? 'out' : ''} ${k === TODAY ? 'td' : ''}" onclick="ui.date='${k}';ui.view='dia';render()"><b>${d.getDate()}</b>${dots}</div>`;
  }
  return h + '</div>';
}

/* ---------- agendamento ---------- */
function timeOpts(sel) { let o = ''; for (let m = START; m < END; m += STEP) o += `<option ${mt(m) === sel ? 'selected' : ''}>${mt(m)}</option>`; return o; }
function formAppt(id, pre) {
  if (!activePros().length) return toast('Cadastre uma profissional em Equipe e Cadastros primeiro');
  const a = id ? apt(id) : Object.assign({ date: ui.date, time: '08:00', dur: (activeProcs()[0] || {}).dur || 30, pro: activePros()[0].id, client: '', proc: (activeProcs()[0] || {}).id }, pre || {});
  if (!id && pre && pre.client === undefined) a.client = '';
  if (!id && pre && !pre.dur && pre.pro) a.dur = prc(a.proc).dur;
  modal(`<h2>${id ? 'Editar' : 'Novo'} agendamento</h2>
  <label>Cliente</label><select id="f_c" onchange="$('#f_nc').style.display=this.value==='new'?'block':'none'"><option value="">Selecione…</option>${S.clients.map(c => `<option value="${c.id}" ${c.id === a.client ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="new">+ Cadastrar novo cliente</option></select>
  <div id="f_nc" style="display:none"><div class="row"><div><label>Nome</label><input type="text" id="f_n"></div><div><label>WhatsApp</label><input type="tel" id="f_t" placeholder="(82) 90000-0000"></div></div></div>
  <label>Procedimento</label><select id="f_p" onchange="$('#f_d').value=prc(this.value).dur">${activeProcs().map(p => `<option value="${p.id}" ${p.id === a.proc ? 'selected' : ''}>${esc(p.name)} (${p.dur} min)</option>`).join('')}</select>
  <label>Profissional</label><select id="f_pr">${activePros().map(p => `<option value="${p.id}" ${p.id === a.pro ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
  <div class="row"><div><label>Data</label><input type="date" id="f_dt" value="${a.date}"></div><div><label>Horário</label><select id="f_h">${timeOpts(a.time)}</select></div><div><label>Duração (min)</label><input type="text" id="f_d" value="${a.dur}"></div></div>
  <div class="acts"><button class="btn pri" id="f_save" onclick="saveAppt('${id || ''}')">Salvar</button><button class="btn" onclick="closeM()">Cancelar</button></div>`);
}
async function saveAppt(id) {
  const btn = $('#f_save'); btn.disabled = true;
  try {
    let c = $('#f_c').value;
    if (c === 'new') {
      const n = $('#f_n').value.trim(), t = $('#f_t').value.trim();
      if (!n || digits(t).length < 8) { toast('Informe nome e WhatsApp do cliente'); btn.disabled = false; return; }
      const nc = await api('POST', '/api/clients', { name: n, phone: t, notes: '' });
      S.clients.push(nc); S.clients.sort((a, b) => a.name.localeCompare(b.name)); c = nc.id;
    }
    if (!c) { toast('Selecione o cliente'); btn.disabled = false; return; }
    const body = { clientId: c, procedureId: $('#f_p').value, professionalId: $('#f_pr').value, date: $('#f_dt').value, time: $('#f_h').value, dur: parseInt($('#f_d').value) || 30 };
    const send = ov => id ? api('PATCH', '/api/appointments/' + id, { ...body, allowOverlap: ov }) : api('POST', '/api/appointments', { ...body, allowOverlap: ov });
    let r;
    try { r = await send(false); }
    catch (e) {
      if (e.code === 'overlap' && confirm('Já existe um paciente nesse horário com essa profissional. Marcar como encaixe (lado a lado)?')) r = await send(true);
      else throw e;
    }
    if (id) { const i = S.appts.findIndex(x => x.id === id); S.appts[i] = r; } else S.appts.push(r);
    closeM(); await ensureRange(body.date); ui.date = body.date; render(); toast('Agendamento salvo');
  } catch (e) { if (e.status !== 401 && e.status !== 402) toast(e.message); }
  const b2 = $('#f_save'); if (b2) b2.disabled = false;
}
function showAppt(id) {
  const a = apt(id), c = cli(a.client), p = pro(a.pro), x = prc(a.proc);
  const mine = isStaff() || S.me.id === a.pro;
  const btn = {
    agendado: (isStaff() ? `<button class="btn" onclick="sendConf('${id}')">💬 Enviar confirmação</button><button class="btn" onclick="setSt('${id}','confirmado')">✔ Marcar confirmado</button>` : '') + (mine ? `<button class="btn pri" onclick="setSt('${id}','atendimento')">▶ Iniciar atendimento</button>` : ''),
    confirmado: mine ? `<button class="btn pri" onclick="setSt('${id}','atendimento')">▶ Iniciar atendimento</button>` : '',
    atendimento: mine ? `<button class="btn grn" onclick="formBaixa('${id}')">✔ Dar baixa (foto / assinatura)</button>` : '',
    concluido: '', cancelado: ''
  }[a.status];
  const ev = a.status === 'concluido' ? `<div style="margin-top:14px"><h3>Comprovante da baixa</h3><div id="proof" class="kv">Carregando…</div></div>` : '';
  modal(`<h2>${esc(c.name)}</h2><span class="tag s-${a.status}">${STAT[a.status]}</span>
  <p class="kv">📞 ${esc(c.phone)}</p><p class="kv">✨ ${esc(x.name)} · ${a.dur} min · ${brl(x.price)}</p>
  <p class="kv">👩‍⚕️ ${esc(p.name)}</p><p class="kv">🗓 ${longD(a.date)} · ${a.time} – ${mt(tm(a.time) + a.dur)}</p>
  ${c.notes ? `<p class="kv">📝 ${esc(c.notes)}</p>` : ''}${a.wa ? '<p class="kv">💬 Confirmação registrada no WhatsApp</p>' : ''}${ev}
  <div class="acts">${btn}${isStaff() && (a.status === 'agendado' || a.status === 'confirmado') ? `<button class="btn" onclick="formAppt('${id}')">Editar / remarcar</button><button class="btn red" onclick="if(confirm('Cancelar este agendamento?'))setSt('${id}','cancelado')">Cancelar</button>` : ''}<button class="btn" onclick="closeM()">Fechar</button></div>`);
  if (a.status === 'concluido') loadProof(id);
}
async function loadProof(id) {
  const r = await run(() => api('GET', `/api/appointments/${id}/proof`));
  const box = $('#proof'); if (!box) return;
  if (!r) { box.textContent = 'Não foi possível carregar.'; return; }
  box.innerHTML = `<div class="row" style="gap:10px;align-items:flex-start">${r.sign ? `<div><small>Assinatura</small><br><img class="thumb" style="width:200px;height:90px;object-fit:contain" src="${r.sign}" alt="Assinatura"></div>` : ''}${r.photo ? `<div><small>Foto</small><br><img class="thumb" src="${r.photo}" alt="Foto do paciente"></div>` : ''}</div><p class="kv">Concluído em ${r.doneAt ? fmtDT(r.doneAt) : ''}${r.doneBy ? ' por ' + esc(r.doneBy) : ''}</p>`;
}
async function setSt(id, s) {
  const r = await run(() => api('POST', `/api/appointments/${id}/status`, { status: s }));
  if (!r) return;
  Object.assign(apt(id), r); closeM(); render();
  if (s === 'atendimento') { toast('Atendimento iniciado'); showAppt(id); }
}

/* ---------- baixa ---------- */
let sigDirty = false, photoData = null;
function formBaixa(id) {
  sigDirty = false; photoData = null;
  const a = apt(id);
  modal(`<h2>Dar baixa no atendimento</h2><p class="kv">${esc(cli(a.client).name)} · ${esc(prc(a.proc).name)}</p>
  <div class="seg" style="margin:12px 0"><button id="tb1" class="on" onclick="tab(1)">✍️ Assinatura</button><button id="tb2" onclick="tab(2)">📷 Foto do paciente</button></div>
  <div id="pn1"><canvas class="sig" id="sig"></canvas><div style="margin-top:8px"><button class="btn sm" onclick="clearSig()">Limpar</button> <small class="kv">O paciente assina na tela com mouse, dedo ou caneta.</small></div></div>
  <div id="pn2" style="display:none"><video id="vid" autoplay playsinline style="display:none"></video><img id="pv" class="pv" style="display:none" alt="">
  <div class="acts" style="margin-top:10px"><button class="btn" onclick="startCam()">📷 Usar câmera</button><button class="btn" id="snapb" style="display:none" onclick="snap()">Capturar</button><label class="btn" style="margin:0;cursor:pointer">📁 Enviar arquivo<input type="file" accept="image/*" hidden onchange="fileFoto(this)"></label></div></div>
  <div class="acts"><button class="btn grn" id="fin_b" onclick="finish('${id}')">Concluir atendimento</button><button class="btn" onclick="closeM()">Voltar</button></div>`);
  initSig();
}
function tab(n) { $('#pn1').style.display = n == 1 ? 'block' : 'none'; $('#pn2').style.display = n == 2 ? 'block' : 'none'; $('#tb1').classList.toggle('on', n == 1); $('#tb2').classList.toggle('on', n == 2); }
function initSig() {
  const c = $('#sig'); c.width = c.clientWidth * 2; c.height = 380; const x = c.getContext('2d'); x.scale(2, 2); x.lineWidth = 2.2; x.lineCap = 'round'; x.strokeStyle = '#1d1530';
  let dr = false; const pos = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  c.onpointerdown = e => { dr = true; c.setPointerCapture(e.pointerId); const [p, q] = pos(e); x.beginPath(); x.moveTo(p, q); };
  c.onpointermove = e => { if (!dr) return; const [p, q] = pos(e); x.lineTo(p, q); x.stroke(); sigDirty = true; };
  c.onpointerup = () => dr = false;
}
function clearSig() { const c = $('#sig'); c.getContext('2d').clearRect(0, 0, c.width, c.height); sigDirty = false; }
async function startCam() { try { camStream = await navigator.mediaDevices.getUserMedia({ video: true }); const v = $('#vid'); v.srcObject = camStream; v.style.display = 'block'; $('#pv').style.display = 'none'; $('#snapb').style.display = 'inline-block'; } catch (e) { toast('Câmera indisponível. Use "Enviar arquivo".'); } }
function shrink(src, max) { // reduz a foto para caber no banco sem perder qualidade útil
  const c = document.createElement('canvas'), k = Math.min(1, max / Math.max(src.width || src.videoWidth, src.height || src.videoHeight));
  const w = (src.width || src.videoWidth), h = (src.height || src.videoHeight);
  c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', .72);
}
function snap() { const v = $('#vid'); photoData = shrink(v, 960); stopCam(); v.style.display = 'none'; $('#snapb').style.display = 'none'; const i = $('#pv'); i.src = photoData; i.style.display = 'block'; }
function fileFoto(inp) {
  const f = inp.files[0]; if (!f) return; const r = new FileReader();
  r.onload = () => { const im = new Image(); im.onload = () => { photoData = shrink(im, 960); const i = $('#pv'); i.src = photoData; i.style.display = 'block'; $('#vid').style.display = 'none'; }; im.onerror = () => toast('Não foi possível ler essa imagem'); im.src = r.result; };
  r.readAsDataURL(f);
}
async function finish(id) {
  if (!sigDirty && !photoData) return toast('Colha a assinatura ou tire a foto do paciente');
  const b = $('#fin_b'); b.disabled = true;
  const r = await run(() => api('POST', `/api/appointments/${id}/finish`, { sign: sigDirty ? $('#sig').toDataURL('image/png') : null, photo: photoData }));
  if (!r) { b.disabled = false; return; }
  Object.assign(apt(id), r); closeM(); render(); toast('Atendimento concluído e baixado ✔');
}

/* ---------- bloqueio ---------- */
function formBlock() {
  const ps = isStaff() ? activePros() : activePros().filter(p => p.id === S.me.id);
  if (!ps.length) return toast('Nenhuma profissional disponível para bloquear');
  modal(`<h2>Bloquear ${isStaff() ? 'profissional' : 'minha agenda'}</h2><p class="kv">A agenda fica indisponível no período escolhido.</p>
  <label>Profissional</label><select id="b_p">${ps.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
  <div class="row"><div><label>Data</label><input type="date" id="b_d" value="${ui.date}"></div>
  <div><label>Período</label><select id="b_all" onchange="$('#b_t').style.display=this.value==='0'?'flex':'none'"><option value="1">Dia inteiro</option><option value="0">Horário específico</option></select></div></div>
  <div class="row" id="b_t" style="display:none"><div><label>Das</label><select id="b_s">${timeOpts('08:00')}</select></div><div><label>Até</label><select id="b_e">${timeOpts('12:00')}<option>19:00</option></select></div></div>
  <label>Motivo (opcional)</label><input type="text" id="b_r" placeholder="Ex.: consulta médica, curso, folga">
  <div class="acts"><button class="btn pri" onclick="saveBlock()">Bloquear</button><button class="btn" onclick="closeM()">Cancelar</button></div>`);
}
async function saveBlock() {
  const all = $('#b_all').value === '1', s = all ? mt(START) : $('#b_s').value, e = all ? mt(END) : $('#b_e').value;
  if (tm(e) <= tm(s)) return toast('O horário final deve ser depois do inicial');
  const pr = $('#b_p').value, d = $('#b_d').value;
  const n = S.appts.filter(a => a.date === d && a.pro === pr && a.status !== 'cancelado' && tm(a.time) < tm(e) && tm(a.time) + a.dur > tm(s)).length;
  if (n && !confirm(n + ' paciente(s) já agendado(s) nesse período. Bloquear mesmo assim? (os agendamentos continuam na agenda para você remarcar)')) return;
  const r = await run(() => api('POST', '/api/blocks', { professionalId: pr, date: d, start: s, end: e, reason: $('#b_r').value }));
  if (!r) return;
  S.blocks.push(r); closeM(); await ensureRange(d); ui.date = d; ui.view = 'dia'; render(); toast('Agenda bloqueada');
}
function showBlock(id) {
  const b = S.blocks.find(x => x.id === id);
  const can = isStaff() || b.pro === S.me.id;
  modal(`<h2>Bloqueio</h2><p class="kv">${esc(pro(b.pro).name)} · ${longD(b.date)}</p><p class="kv">${b.start} – ${b.end}</p><p class="kv">${esc(b.reason || 'Sem motivo informado')}</p>
  <div class="acts">${can ? `<button class="btn red" onclick="delBlock('${id}')">Remover bloqueio</button>` : ''}<button class="btn" onclick="closeM()">Fechar</button></div>`);
}
async function delBlock(id) {
  const r = await run(() => api('DELETE', '/api/blocks/' + id));
  if (!r) return;
  S.blocks = S.blocks.filter(x => x.id !== id); closeM(); render(); toast('Bloqueio removido');
}

/* ---------- WhatsApp (envio ainda simulado: registra a mensagem, não envia) ---------- */
function fill(t, a, extra) {
  const c = cli(a.client), p = pro(a.pro);
  return t.replace(/{nome}/g, c.name.split(' ')[0]).replace(/{procedimento}/g, prc(a.proc).name).replace(/{data}/g, shortD(a.date)).replace(/{hora}/g, a.time).replace(/{profissional}/g, p.name).replace(/{clinica}/g, S.clinic.name).replace(/{lista}/g, extra || '');
}
async function logWa(to, name, text, kind, apptId) { const m = await api('POST', '/api/messages', { kind, name, to, text, appointmentId: apptId }); S.log.unshift(m); }
async function sendConf(id) {
  if (!S.wa.connected) { closeM(); toast('Conecte o WhatsApp primeiro'); return go('whatsapp'); }
  const a = apt(id), c = cli(a.client);
  const r = await run(async () => { await logWa(c.phone, c.name, fill(S.wa.tpl.conf, a), 'Confirmação', id); return true; });
  if (!r) return;
  a.wa = true; closeM(); render(); toast('Confirmação registrada para ' + c.name.split(' ')[0] + ' (o envio real pelo WhatsApp chega na próxima etapa)');
}
async function sendAgenda(pid) {
  if (!S.wa.connected) { toast('Conecte o WhatsApp primeiro'); return go('whatsapp'); }
  const p = pro(pid), l = S.appts.filter(a => a.date === TODAY && a.pro === pid && a.status !== 'cancelado').sort((a, b) => a.time < b.time ? -1 : 1);
  if (!l.length) return toast('Sem pacientes hoje para ' + p.name);
  const lista = l.map(a => `• ${a.time} – ${cli(a.client).name} (${prc(a.proc).name})`).join('\n');
  const r = await run(async () => { await logWa('(profissional)', p.name, S.wa.tpl.agenda.replace(/{profissional}/g, p.name).replace(/{data}/g, shortD(TODAY)).replace(/{lista}/g, lista), 'Agenda da profissional'); return true; });
  if (r) toast('Agenda do dia registrada para ' + p.name + ' (envio real na próxima etapa)');
}
async function sendAllConf() {
  if (!S.wa.connected) return toast('Conecte o WhatsApp primeiro');
  const l = S.appts.filter(a => a.status === 'agendado' && !a.wa && a.date >= TODAY);
  if (!l.length) return toast('Nenhuma confirmação pendente');
  const r = await run(async () => { for (const a of l) { await logWa(cli(a.client).phone, cli(a.client).name, fill(S.wa.tpl.conf, a), 'Confirmação', a.id); a.wa = true; } return true; });
  render(); if (r) toast(l.length + ' confirmações registradas');
}
async function saveTpl() {
  const r = await run(() => api('PUT', '/api/settings/wa-templates', S.wa.tpl));
  if (r) toast('Mensagem salva');
}
function pgWa() {
  const w = S.wa, t = w.tpl;
  $('#view').innerHTML = `${warnHtml()}<div class="sim"><b>Modo de demonstração:</b> por enquanto o sistema <b>registra</b> as mensagens, mas ainda não as envia pelo WhatsApp. A conexão real por QR Code entra na próxima etapa.</div><div class="g2">
  <div class="card"><h3>Conexão do WhatsApp</h3>
   ${w.connected ? `<p><span class="tag s-concluido">● Conectado (simulação)</span></p><p class="kv">Na versão final, as mensagens saem do número da clínica, direto pelo sistema.</p><button class="btn red" onclick="S.wa.connected=false;saveSim(false);render()">Desconectar</button>`
    : `<p><span class="tag s-cancelado" style="text-decoration:none">● Desconectado</span></p><p class="kv">Na versão final, aqui aparece o QR Code para ler no WhatsApp da clínica (Aparelhos conectados › Conectar um aparelho).</p>
   <button class="btn pri" onclick="S.wa.connected=true;saveSim(true);render();toast('Modo de demonstração ativado')">Ativar modo de demonstração</button>`}
   <div style="margin-top:18px"><button class="btn" onclick="sendAllConf()">💬 Registrar confirmações pendentes</button></div></div>
  <div class="card"><h3>Mensagens automáticas</h3>
   <label style="margin-top:0">Confirmação de agendamento</label><textarea rows="4" onchange="S.wa.tpl.conf=this.value;saveTpl()">${esc(t.conf)}</textarea>
   <label>Lembrete (véspera)</label><textarea rows="2" onchange="S.wa.tpl.lemb=this.value;saveTpl()">${esc(t.lemb)}</textarea>
   <label>Agenda do dia para a profissional</label><textarea rows="3" onchange="S.wa.tpl.agenda=this.value;saveTpl()">${esc(t.agenda)}</textarea>
   <p class="kv">Variáveis: {nome} {procedimento} {data} {hora} {profissional} {clinica} {lista}</p></div></div>
  <div class="card" style="margin-top:16px"><h3>Mensagens registradas</h3>${S.log.length ? `<table><tr><th>Quando</th><th>Tipo</th><th>Para</th><th>Mensagem</th></tr>${S.log.slice(0, 15).map(l => `<tr><td>${fmtDT(l.t)}</td><td>${esc(l.kind)}<br><span class="pill">${esc(l.status)}</span></td><td>${esc(l.name)}<br><small class="kv">${esc(l.to)}</small></td><td><div class="wa">${esc(l.text)}</div></td></tr>`).join('')}</table>` : '<div class="empty">Nenhuma mensagem registrada ainda. Abra um agendamento e clique em “Enviar confirmação”.</div>'}</div>`;
}

/* ---------- atendimento do dia (visão da profissional) ---------- */
function pgHoje() {
  const ps = activePros();
  if (!ps.length) { $('#view').innerHTML = '<div class="card empty">Nenhuma profissional cadastrada ainda.</div>'; return; }
  if (!ps.find(x => x.id === ui.hojePro)) ui.hojePro = ps[0].id;
  const p = pro(ui.hojePro), l = S.appts.filter(a => a.date === TODAY && a.pro === p.id && a.status !== 'cancelado').sort((a, b) => a.time < b.time ? -1 : 1);
  const bl = S.blocks.filter(b => b.date === TODAY && b.pro === p.id);
  const canAct = isStaff() || S.me.id === p.id;
  $('#view').innerHTML = `${warnHtml()}<div class="bar"><div class="seg">${(isStaff() ? ps : ps.filter(x => x.id === S.me.id)).map(x => `<button class="${x.id === p.id ? 'on' : ''}" onclick="ui.hojePro='${x.id}';render()">${esc(x.name)}</button>`).join('')}</div><div class="sp"></div>${isStaff() ? `<button class="btn" onclick="sendAgenda('${p.id}')">💬 Enviar agenda do dia pelo WhatsApp</button>` : ''}</div>
  <div class="card"><h3>${esc(p.name)} · ${longD(TODAY)}</h3>
  ${bl.map(b => `<div class="blk" style="position:static;margin-bottom:10px">🚫 Bloqueada ${b.start}–${b.end} ${esc(b.reason || '')}</div>`).join('')}
  ${l.length ? l.map(a => { const c = cli(a.client); return `<div class="pl-row"><div style="width:56px;font-weight:700;font-size:16px">${a.time}</div><div style="flex:1"><b>${esc(c.name)}</b><div class="kv">${esc(prc(a.proc).name)} · ${a.dur} min${c.notes ? ' · 📝 ' + esc(c.notes) : ''}</div></div><span class="tag s-${a.status}">${STAT[a.status]}</span>
   ${canAct && (a.status === 'agendado' || a.status === 'confirmado') ? `<button class="btn pri sm" onclick="setSt('${a.id}','atendimento')">▶ Iniciar</button>` : ''}${canAct && a.status === 'atendimento' ? `<button class="btn grn sm" onclick="formBaixa('${a.id}')">✔ Dar baixa</button>` : ''}<button class="btn sm" onclick="showAppt('${a.id}')">Abrir</button></div>`; }).join('') : '<div class="empty">Nenhum paciente agendado para hoje.</div>'}</div>`;
}

/* ---------- clientes ---------- */
function pgClientes() {
  const q = ui.q.toLowerCase(), st = isStaff();
  const l = S.clients.filter(c => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q));
  $('#view').innerHTML = `${warnHtml()}<div class="bar"><input type="search" id="cq" placeholder="Buscar por nome ou telefone…" value="${esc(ui.q)}" style="max-width:340px" oninput="ui.q=this.value;pgClientes();const i=$('#cq');i.focus();i.setSelectionRange(99,99)"><div class="sp"></div>${st ? '<button class="btn" onclick="exportCsv()">⬆ Exportar</button><button class="btn" onclick="formImport()">⬇ Importar clientes</button><button class="btn pri" onclick="formCli()">+ Novo cliente</button>' : ''}</div>
  <div class="card" style="padding:6px 8px"><table><tr><th>Nome</th><th>WhatsApp</th></tr>${l.slice(0, 300).map(c => `<tr class="cl" onclick="fichaCli('${c.id}')"><td><b>${esc(c.name)}</b></td><td>${esc(c.phone)}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">Nenhum cliente encontrado</td></tr>'}</table>${l.length > 300 ? `<p class="kv" style="padding:10px 12px">Mostrando 300 de ${l.length}. Use a busca para encontrar os demais.</p>` : ''}</div>`;
}
function formCli(id) {
  const c = id ? cli(id) : { name: '', phone: '', notes: '' };
  modal(`<h2>${id ? 'Editar' : 'Novo'} cliente</h2><label>Nome completo</label><input type="text" id="c_n" value="${esc(c.name)}"><label>WhatsApp</label><input type="tel" id="c_t" value="${esc(c.phone)}" placeholder="(82) 90000-0000"><label>Observações / anamnese</label><textarea id="c_o" rows="4">${esc(c.notes)}</textarea>
  <div class="acts"><button class="btn pri" onclick="saveCli('${id || ''}')">Salvar</button><button class="btn" onclick="closeM()">Cancelar</button></div>`);
}
async function saveCli(id) {
  const n = $('#c_n').value.trim(), t = $('#c_t').value.trim();
  if (!n || digits(t).length < 8) return toast('Informe nome e WhatsApp');
  const body = { name: n, phone: t, notes: $('#c_o').value };
  const r = await run(() => id ? api('PATCH', '/api/clients/' + id, body) : api('POST', '/api/clients', body));
  if (!r) return;
  if (id) Object.assign(cli(id), r); else S.clients.push(r);
  S.clients.sort((a, b) => a.name.localeCompare(b.name)); closeM(); render(); toast('Cliente salvo');
}
async function fichaCli(id) {
  const c = cli(id);
  modal(`<h2>${esc(c.name)}</h2><p class="kv">📞 ${esc(c.phone)}</p>${c.notes ? `<p class="kv">📝 ${esc(c.notes)}</p>` : ''}
  <h3 style="margin-top:16px">Histórico</h3><div id="hist" class="loading">Carregando…</div>
  <div class="acts">${isStaff() ? `<button class="btn pri" onclick="formAppt(null,{client:'${id}'})">+ Agendar</button><button class="btn" onclick="formCli('${id}')">Editar</button>` : ''}<button class="btn" onclick="closeM()">Fechar</button></div>`, true);
  const r = await run(() => api('GET', `/api/clients/${id}/history`));
  const box = $('#hist'); if (!box) return;
  if (!r) { box.textContent = 'Não foi possível carregar o histórico.'; return; }
  box.className = '';
  box.innerHTML = r.appts.length ? r.appts.map(a => `<div class="pl-row" style="padding:9px 0"><div style="width:62px">${shortD(a.date)}<br><small class="kv">${a.time}</small></div><div style="flex:1">${esc(prc(a.proc).name)}<div class="kv">${esc(pro(a.pro).name)}</div></div><span class="tag s-${a.status}">${STAT[a.status]}</span>${a.hasPhoto ? '<span title="Tem foto">📷</span>' : ''}${a.hasSign ? '<span title="Tem assinatura">✍️</span>' : ''}</div>`).join('') : '<div class="empty">Sem atendimentos ainda.</div>';
}

/* ---------- importar / exportar clientes ---------- */
let imp = null;
function fmtPhone(s) { let d = digits(s); if (d.startsWith('55') && d.length > 11) d = d.slice(2); if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`; if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`; return String(s).trim(); }
function csvParse(t) {
  t = t.replace(/^﻿/, ''); const first = t.split(/\r?\n/)[0] || '';
  const d = first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
  const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === d) { r.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; r.push(f); f = ''; if (r.some(x => x.trim())) rows.push(r); r = []; }
    else f += c;
  }
  r.push(f); if (r.some(x => x.trim())) rows.push(r); return rows;
}
// Evita que planilhas executem fórmulas ao abrir o arquivo exportado
const safeCell = v => { v = String(v ?? ''); return /^[=+\-@\t\r]/.test(v) ? "'" + v : v; };
function dl(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
const q_ = v => '"' + safeCell(v).replace(/"/g, '""') + '"';
function tplCsv() { dl('modelo-clientes.csv', 'Nome;Telefone;Observações\nMaria Silva;(82) 99111-2233;Pele sensível\nCarla Mendes;82 99222-3344;'); }
function exportCsv() { dl('clientes-sua-clinica.csv', 'Nome;Telefone;Observações\n' + S.clients.map(c => [c.name, c.phone, c.notes].map(q_).join(';')).join('\n')); toast('Lista de clientes exportada'); }
function formImport() {
  modal(`<h2>Importar clientes</h2><p class="kv">Exporte a lista de clientes do sistema antigo (ou de uma planilha) em Excel (.xlsx) ou CSV e envie aqui.</p>
  <div class="acts" style="margin-top:8px"><label class="btn pri" style="margin:0;cursor:pointer">📁 Escolher arquivo (Excel ou CSV)<input type="file" accept=".xlsx,.csv,.txt,text/csv" hidden onchange="readImp(this)"></label><button class="btn" onclick="tplCsv()">⬇ Baixar modelo</button></div>
  <label>ou cole os dados aqui (com a linha de títulos)</label><textarea id="i_t" rows="5" placeholder="Nome;Telefone;Observações"></textarea>
  <div class="acts"><button class="btn" onclick="prevImp($('#i_t').value)">Continuar</button><button class="btn" onclick="closeM()">Cancelar</button></div>`, true);
}
function readText(inp, cb) { const f = inp.files[0]; if (!f) return; f.arrayBuffer().then(b => { let t; try { t = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { t = new TextDecoder('windows-1252').decode(b); } cb(t); }); }
function readImp(inp) { readTable(inp, prevImp); }

/* ---------- leitura de planilhas (.xlsx e .csv), sem bibliotecas externas ---------- */
async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
}
function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let e = u8.length - 22; const minE = Math.max(0, u8.length - 65557);
  while (e >= minE && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < minE) throw new Error('zip');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  const files = {};
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    files[new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl))] = { method: dv.getUint16(p + 10, true), csize: dv.getUint32(p + 20, true), lo: dv.getUint32(p + 42, true) };
    p += 46 + nl + el + cl;
  }
  return {
    async get(name) {
      const f = files[name]; if (!f) return null;
      const start = f.lo + 30 + dv.getUint16(f.lo + 26, true) + dv.getUint16(f.lo + 28, true);
      const data = u8.subarray(start, start + f.csize);
      return new TextDecoder().decode(f.method === 0 ? data : await inflateRaw(data));
    }
  };
}
async function xlsxRows(buf) {
  const zp = unzip(buf);
  const xml = async n => { const t = await zp.get(n); return t ? new DOMParser().parseFromString(t, 'application/xml') : null; };
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = await xml('xl/workbook.xml'), rels = await xml('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const sh = wb.getElementsByTagName('sheet')[0];
    const rid = sh && (sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
    const rel = [...rels.getElementsByTagName('Relationship')].find(r => r.getAttribute('Id') === rid);
    if (rel) { const t = rel.getAttribute('Target'); sheetPath = t.startsWith('/') ? t.slice(1) : 'xl/' + t; }
  }
  const ss = [], sst = await xml('xl/sharedStrings.xml');
  if (sst) for (const si of sst.getElementsByTagName('si')) {
    let t = ''; for (const x of si.getElementsByTagName('t')) if (x.parentNode.nodeName !== 'rPh') t += x.textContent; ss.push(t);
  }
  const dateXf = [], st = await xml('xl/styles.xml');
  if (st) {
    const custom = {}; for (const nf of st.getElementsByTagName('numFmt')) custom[nf.getAttribute('numFmtId')] = nf.getAttribute('formatCode') || '';
    const xfs = st.getElementsByTagName('cellXfs')[0];
    if (xfs) [...xfs.getElementsByTagName('xf')].forEach((x, i) => {
      const id = +x.getAttribute('numFmtId'), code = custom[id];
      dateXf[i] = (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (!!code && /[dmyhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')));
    });
  }
  const sx = await xml(sheetPath); if (!sx) throw new Error('aba');
  const colIdx = ref => { let n = 0; for (const ch of ref.replace(/\d/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const rows = [];
  for (const row of sx.getElementsByTagName('row')) {
    const arr = [];
    for (const c of row.getElementsByTagName('c')) {
      const ref = c.getAttribute('r'), t = c.getAttribute('t'), sIdx = +c.getAttribute('s');
      const vEl = c.getElementsByTagName('v')[0], v = vEl ? vEl.textContent : '';
      let val = '';
      if (t === 's') val = ss[+v] || '';
      else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
      else if (t === 'b') val = v === '1' ? 'Sim' : 'Não';
      else if (t === 'str' || t === 'e' || t === 'd') val = v;
      else if (v !== '') {
        if (dateXf[sIdx] && isFinite(parseFloat(v))) {
          const sec = Math.round(parseFloat(v) * 86400), d = new Date(Date.UTC(1899, 11, 30) + sec * 1000);
          val = d.getUTCFullYear() + '-' + z(d.getUTCMonth() + 1) + '-' + z(d.getUTCDate()) + (((sec % 86400) + 86400) % 86400 ? ' ' + z(d.getUTCHours()) + ':' + z(d.getUTCMinutes()) + ':' + z(d.getUTCSeconds()) : '');
        } else val = v;
      }
      arr[ref ? colIdx(ref) : arr.length] = val.trim();
    }
    const full = Array.from(arr, x => x == null ? '' : x);
    if (full.some(x => x !== '')) rows.push(full);
  }
  return rows;
}
// Lê .xlsx ou .csv e entrega uma lista de linhas (cada linha, uma lista de textos)
function readTable(inp, cb) {
  const f = inp.files[0]; if (!f) return;
  f.arrayBuffer().then(async b => {
    const h = new Uint8Array(b.slice(0, 4));
    try {
      if (h[0] === 0x50 && h[1] === 0x4b) cb(await xlsxRows(b));
      else if (h[0] === 0xD0 && h[1] === 0xCF) toast('Este é um Excel antigo (.xls). Abra no Excel e salve como .xlsx ou CSV.');
      else { let t; try { t = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { t = new TextDecoder('windows-1252').decode(b); } cb(csvParse(t)); }
    } catch (e) { toast('Não consegui ler esse arquivo. Salve como .xlsx ou CSV e tente de novo.'); }
    inp.value = '';
  });
}
// Ignora títulos e linhas soltas acima do cabeçalho (o Gestek coloca um cabeçalho do relatório no topo)
function fromHeader(rows, isHeader) { const i = rows.findIndex(isHeader); return i > 0 ? rows.slice(i) : rows; }

function prevImp(input) {
  let rows = Array.isArray(input) ? input : csvParse(input || '');
  rows = fromHeader(rows, r => r.some(c => /^(nome|cliente|paciente)\b/.test(normS(c))) && r.some(c => /tel|fone|whats|celular|contato/.test(normS(c))));
  if (rows.length < 2) return toast('Arquivo vazio ou sem linhas de clientes');
  const h = rows[0].map(x => String(x).trim()); const g = re => h.findIndex(x => re.test(x));
  imp = { h, rows: rows.slice(1), n: g(/nome|name|cliente|paciente/i), t: g(/tel|fone|whats|celular|contato/i), o: g(/obs|anota|nota/i) };
  showImp();
}
function showImp() {
  const opt = (sel, none) => `<option value="-1">${none ? '— ignorar —' : 'Selecione…'}</option>` + imp.h.map((x, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(x || 'Coluna ' + (i + 1))}</option>`).join('');
  const last = s => digits(s).slice(-9);
  const have = new Set(S.clients.map(c => last(c.phone)));
  const ok = []; let dup = 0, bad = 0;
  imp.rows.forEach(r => {
    const n = imp.n >= 0 ? (r[imp.n] || '').trim() : '', t = imp.t >= 0 ? (r[imp.t] || '').trim() : '';
    if (!n || digits(t).length < 8) { bad++; return; }
    const k = last(t); if (have.has(k)) { dup++; return; }
    have.add(k); ok.push({ name: n, phone: fmtPhone(t), notes: imp.o >= 0 ? (r[imp.o] || '').trim() : '' });
  });
  imp.ok = ok;
  modal(`<h2>Importar clientes</h2><p class="kv">Confira se as colunas foram reconhecidas.</p>
  <div class="row"><div><label>Nome</label><select onchange="imp.n=+this.value;showImp()">${opt(imp.n)}</select></div><div><label>WhatsApp</label><select onchange="imp.t=+this.value;showImp()">${opt(imp.t)}</select></div><div><label>Observações</label><select onchange="imp.o=+this.value;showImp()">${opt(imp.o, 1)}</select></div></div>
  <div style="margin:16px 0"><span class="tag s-concluido">${ok.length} novos</span> <span class="tag s-agendado">${dup} já cadastrados (ignorados)</span> <span class="tag s-cancelado" style="text-decoration:none">${bad} sem nome ou telefone válido</span></div>
  ${ok.length ? `<table><tr><th>Nome</th><th>WhatsApp</th><th>Observações</th></tr>${ok.slice(0, 5).map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${esc(c.notes)}</td></tr>`).join('')}</table>${ok.length > 5 ? `<p class="kv">…e mais ${ok.length - 5} clientes.</p>` : ''}` : '<div class="empty">Nenhum cliente novo para importar com essas colunas.</div>'}
  <div class="acts"><button class="btn pri" id="imp_b" ${ok.length ? '' : 'disabled'} onclick="doImport()">Importar ${ok.length} clientes</button><button class="btn" onclick="formImport()">Voltar</button></div>`, true);
}
async function doImport() {
  const b = $('#imp_b'); b.disabled = true;
  const r = await run(() => api('POST', '/api/clients/bulk', { clients: imp.ok }));
  if (!r) { b.disabled = false; return; }
  imp = null; closeM(); await run(reload); render(); toast(r.created + ' clientes importados');
}

/* ---------- importar agendamentos futuros ---------- */
let ia = null;
const normS = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const baseName = s => normS(s).replace(/\b(dra?|dr)\.?\s+/g, '').trim();
const likeName = (a, b) => { a = baseName(a); b = baseName(b); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); };
function parseDate(s) {
  s = String(s || '').trim(); let m, r = null;
  if (m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)) r = m[1] + '-' + z(+m[2]) + '-' + z(+m[3]);
  else if (m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/)) { let y = +m[3]; if (y < 100) y += 2000; r = y + '-' + z(+m[2]) + '-' + z(+m[1]); }
  if (!r) return null; const d = new Date(r + 'T12:00'); return isNaN(d) || iso(d) !== r ? null : r;
}
function parseTime(s) { s = String(s || '').trim().toLowerCase(); const dt = s.match(/^\d{4}-\d{2}-\d{2}[ t](\d{1,2}):(\d{2})/) || s.match(/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}[ t]+(\d{1,2}):(\d{2})/); if (dt) { const h = +dt[1], mi = +dt[2]; return h > 23 || mi > 59 ? null : z(h) + ':' + z(mi); } const m = s.match(/^(\d{1,2})\s*[:h]\s*(\d{2})?/); if (!m) return null; const h = +m[1], mi = +(m[2] || 0); return h > 23 || mi > 59 ? null : z(h) + ':' + z(mi); }
function tplIA() { const d = addD(TODAY, 1).split('-').reverse().join('/'); dl('modelo-agenda.csv', `Data;Hora;Cliente;Telefone;Profissional;Procedimento;Duração (min)\n${d};09:00;Maria Silva;(82) 99111-2233;${(activePros()[0] || { name: 'Dra. Fernanda' }).name};Limpeza de pele;60\n${d};10:30;Carla Mendes;(82) 99222-3344;${(activePros()[1] || activePros()[0] || { name: 'Dra. Camila' }).name};Peeling;40`); }
function formImportAppt() {
  modal(`<h2>Importar agendamentos futuros</h2><p class="kv">Exporte a agenda do sistema antigo (por exemplo, o relatório de agendamentos do Gestek) em Excel (.xlsx) ou CSV. Entram só os agendamentos de hoje em diante, dentro do horário da agenda (08:00–19:00). Clientes que ainda não existem são cadastrados automaticamente.</p>
  <div class="acts" style="margin-top:8px"><label class="btn pri" style="margin:0;cursor:pointer">📁 Escolher arquivo (Excel ou CSV)<input type="file" accept=".xlsx,.csv,.txt,text/csv" hidden onchange="readTable(this,prevIA)"></label><button class="btn" onclick="tplIA()">⬇ Baixar modelo</button></div>
  <label>ou cole os dados aqui (com a linha de títulos)</label><textarea id="ia_t" rows="5" placeholder="Data;Hora;Cliente;Telefone;Profissional;Procedimento"></textarea>
  <div class="acts"><button class="btn" onclick="prevIA($('#ia_t').value)">Continuar</button><button class="btn" onclick="closeM()">Cancelar</button></div>`, true);
}
function prevIA(input) {
  let rows = Array.isArray(input) ? input : csvParse(input || '');
  rows = fromHeader(rows, r => r.some(c => /^(nome|cliente|paciente)\b/.test(normS(c))) && r.some(c => /^(data|dia|inicio)\b/.test(normS(c))));
  if (rows.length < 2) return toast('Arquivo vazio ou sem agendamentos');
  const h = rows[0].map(x => String(x).trim());
  const gi = (re, not) => h.findIndex(x => { const n = normS(x); return re.test(n) && !(not && not.test(n)); });
  const first = (...i) => i.find(x => x >= 0) ?? -1;
  ia = { h, rows: rows.slice(1), proMap: {}, procMap: {}, col: {
    d: first(gi(/inicio/), gi(/^data$|^dia$/), gi(/^data/, /fim|cria/)),
    t: gi(/^hora|horario/, /fim|cria/),
    n: gi(/^(nome|cliente|paciente)/),
    f: gi(/tel|fone|whats|celular|contato/),
    p: gi(/profission|atendente|especialista/),
    x: gi(/procedim|servico|tratamento/),
    u: gi(/dura|minut/),
    e: gi(/fim|termino/, /cria/),
    s: gi(/^status|situacao/)
  } };
  showIA();
}
function showIA() {
  const c = ia.col, at = (r, k) => c[k] >= 0 ? String(r[c[k]] || '').trim() : '';
  const bad = { data: 0, hora: 0, nome: 0, fora: 0, passado: 0, cancel: 0 }; ia.items = [];
  ia.rows.forEach(r => {
    const dv = at(r, 'd'), date = parseDate(dv), time = c.t >= 0 ? parseTime(at(r, 't')) : parseTime(dv), name = at(r, 'n');
    if (c.s >= 0 && /cancel|falt|desmarc|nao compar/.test(normS(at(r, 's')))) { bad.cancel++; return; }
    if (!date) { bad.data++; return; } if (!time) { bad.hora++; return; } if (!name) { bad.nome++; return; }
    if (date < TODAY) { bad.passado++; return; }
    const m = tm(time); if (m < START || m >= END) { bad.fora++; return; }
    let dur = parseInt(at(r, 'u')) || 0;
    if (!dur && c.e >= 0) { const ev = at(r, 'e'), et = parseTime(ev); if (et && parseDate(ev) === date) { const df = tm(et) - m; if (df >= 5 && df <= 480) dur = df; } }
    ia.items.push({ date, time, name, phone: at(r, 'f'), pro: at(r, 'p'), proc: at(r, 'x'), dur });
  });
  ia.pk = [...new Set(ia.items.map(i => i.pro))]; ia.xk = [...new Set(ia.items.map(i => i.proc))];
  const aps = activePros();
  ia.pk.forEach(n => { if (!(n in ia.proMap)) { const p = aps.find(p => likeName(p.name, n)); ia.proMap[n] = p ? p.id : (!n && aps.length === 1 ? aps[0].id : ''); } });
  ia.xk.forEach(n => { if (!(n in ia.procMap)) { const p = n ? activeProcs().find(p => normS(p.name) === normS(n)) : null; ia.procMap[n] = p ? p.id : 'new'; } });
  const colSel = (k, lab, none) => `<div><label>${lab}</label><select onchange="ia.col.${k}=+this.value;showIA()"><option value="-1">${none ? (typeof none === 'string' ? none : '— não tenho —') : 'Selecione…'}</option>${ia.h.map((x, i) => `<option value="${i}" ${i === c[k] ? 'selected' : ''}>${esc(x || 'Coluna ' + (i + 1))}</option>`).join('')}</select></div>`;
  const valid = ia.items.filter(i => ia.proMap[i.pro]); const semPro = ia.items.length - valid.length;
  const newCli = new Set(valid.filter(i => !S.clients.some(cl => normS(cl.name) === normS(i.name) || (digits(i.phone).length >= 8 && digits(cl.phone).slice(-9) === digits(i.phone).slice(-9)))).map(i => normS(i.name))).size;
  modal(`<h2>Importar agendamentos futuros</h2><p class="kv">1. Confira as colunas</p>
  <div class="row">${colSel('d', 'Data (e hora, se juntas)')}${colSel('t', 'Hora', '— mesma da Data —')}${colSel('n', 'Cliente')}${colSel('f', 'Telefone', 1)}</div>
  <div class="row">${colSel('p', 'Profissional', 1)}${colSel('x', 'Procedimento', 1)}${colSel('u', 'Duração (min)', 1)}${colSel('e', 'Fim (para calcular a duração)', 1)}</div>
  <div class="row">${colSel('s', 'Status (ignora cancelados)', 1)}<div></div><div></div><div></div></div>
  <p class="kv" style="margin-top:16px">2. Ligue os nomes da planilha aos cadastros do sistema</p>
  ${ia.pk.map((n, i) => `<div class="pl-row" style="padding:8px 0"><div style="flex:1">Profissional: <b>${esc(n || '(sem profissional na planilha)')}</b></div><select style="width:230px" onchange="ia.proMap[ia.pk[${i}]]=this.value;showIA()"><option value="">Ignorar estes agendamentos</option>${aps.map(p => `<option value="${p.id}" ${ia.proMap[n] === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>`).join('')}
  ${ia.xk.map((n, i) => `<div class="pl-row" style="padding:8px 0"><div style="flex:1">Procedimento: <b>${esc(n || '(sem procedimento na planilha)')}</b></div><select style="width:230px" onchange="ia.procMap[ia.xk[${i}]]=this.value;showIA()"><option value="new" ${ia.procMap[n] === 'new' ? 'selected' : ''}>${n ? 'Criar novo procedimento' : 'Criar “Procedimento não informado”'}</option>${activeProcs().map(p => `<option value="${p.id}" ${ia.procMap[n] === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>`).join('')}
  <div style="margin:16px 0"><span class="tag s-concluido">${valid.length} agendamentos para importar</span> <span class="tag s-atendimento">${newCli} clientes novos</span></div>
  <p class="kv">Ignorados: ${semPro} sem profissional definida · ${bad.passado} em datas passadas · ${bad.fora} fora do horário da agenda · ${bad.cancel} cancelados ou faltas · ${bad.data + bad.hora + bad.nome} com data, hora ou nome inválido</p>
  <p class="kv">Horários sobrepostos entram como encaixe, lado a lado.</p>
  <div class="acts"><button class="btn pri" id="ia_b" ${valid.length ? '' : 'disabled'} onclick="doIA()">Importar ${valid.length} agendamentos</button><button class="btn" onclick="formImportAppt()">Voltar</button></div>`, true);
}
async function doIA() {
  const b = $('#ia_b'); b.disabled = true;
  const items = ia.items.filter(i => ia.proMap[i.pro]).map(i => {
    const m = ia.procMap[i.proc], known = m && m !== 'new' ? prc(m) : null;
    return { date: i.date, time: i.time, dur: i.dur || (known && known.dur) || 30, professionalId: ia.proMap[i.pro], procedureId: known ? known.id : null, procedureName: known ? known.name : (i.proc || 'Procedimento não informado'), clientName: i.name, phone: i.phone ? fmtPhone(i.phone) : '' };
  });
  const r = await run(() => api('POST', '/api/appointments/bulk', { items }));
  if (!r) { b.disabled = false; return; }
  const first = items.map(x => x.date).sort()[0];
  ia = null; closeM(); await run(async () => { await ensureRange(first); await reload(); });
  ui.date = first; ui.view = 'dia'; ui.page = 'agenda'; render();
  toast(r.created + ' agendamentos importados' + (r.newClients ? ' · ' + r.newClients + ' clientes novos' : '') + (r.newProcedures ? ' · ' + r.newProcedures + ' procedimentos criados' : '') + (r.skipped ? ' · ' + r.skipped + ' ignorados' : ''));
}

/* ---------- equipe e cadastros ---------- */
async function pgEquipe() {
  $('#view').innerHTML = warnHtml() + '<div class="loading">Carregando…</div>';
  let team = null;
  if (isAdmin()) { const r = await run(() => api('GET', '/api/team')); if (!r) return; team = r; S.clinic.usage = r.usage; }
  if (ui.page !== 'equipe') return;
  const cl = S.clinic, lim = cl.limits, us = cl.usage || { professional: 0, receptionist: 0 };
  const price = cl.plan === 'annual' ? 'R$ 899,90<small style="font-size:14px;color:var(--mut)"> /ano</small>' : 'R$ 99,90<small style="font-size:14px;color:var(--mut)"> /mês</small>';
  const stLabel = { active: ['Assinatura ativa', 'ok'], past_due: ['Pagamento pendente', 'bad'], canceled: ['Cancelada', 'off'] }[cl.status];
  const teamHtml = team ? `<div class="card"><h3>Equipe</h3>
    ${team.team.map(m => `<div class="trow"><input type="color" value="${m.color}" ${m.role === 'professional' ? '' : 'disabled'} onchange="patchMember('${m.id}',{color:this.value})" title="Cor na agenda">
      <div class="nm"><input type="text" value="${esc(m.name)}" onchange="patchMember('${m.id}',{name:this.value})"><small>${esc(m.email)}</small></div>
      <span class="pill ${m.active ? 'ok' : 'off'}">${ROLE[m.role]}${m.active ? '' : ' · inativa'}</span>
      ${m.role !== 'admin' ? `<button class="btn sm" onclick="newPw('${m.id}')">Nova senha</button><button class="btn sm ${m.active ? 'red' : ''}" onclick="patchMember('${m.id}',{active:${!m.active}})">${m.active ? 'Desativar' : 'Reativar'}</button>` : ''}</div>`).join('')}
    <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn pri" ${us.professional >= lim.professionals ? 'disabled' : ''} onclick="formTeam('professional')">+ Profissional</button><button class="btn" ${us.receptionist >= lim.receptionists ? 'disabled' : ''} onclick="formTeam('receptionist')">+ Recepcionista</button></div>
    <p class="kv" style="margin-top:10px">Profissionais: ${us.professional} de ${lim.professionals} · Recepção: ${us.receptionist} de ${lim.receptionists}. Sem custo adicional dentro do plano.</p></div>` : `<div class="card"><h3>Equipe</h3><p class="kv">Só a administradora gerencia a equipe.</p></div>`;
  $('#view').innerHTML = warnHtml() + `<div class="g2">${teamHtml}
  <div class="card"><h3>Plano e assinatura</h3><div style="font-size:30px;font-weight:700;color:var(--p)">${price}</div>
   <p class="kv" style="margin-top:8px">Plano ${esc(cl.planLabel)}<br>✔ Agenda por horário com bloqueio de profissional<br>✔ Cadastro de clientes e histórico<br>✔ WhatsApp integrado<br>✔ Baixa por foto ou assinatura<br>✔ ${cl.plan === 'annual' ? 'Até 5 usuários' : '2 profissionais + recepcionista'}</p><span class="pill ${stLabel[1]}">${stLabel[0]}</span></div></div>
  <div class="card" style="margin-top:16px"><h3>Procedimentos</h3><table><tr><th>Procedimento</th><th>Duração</th><th>Valor</th><th></th></tr>${activeProcs().map(p => `<tr><td>${esc(p.name)}</td><td>${p.dur} min</td><td>${brl(p.price)}</td><td style="text-align:right"><button class="btn sm" onclick="formProc('${p.id}')">Editar</button></td></tr>`).join('')}</table>
   <div class="row" style="margin-top:14px;align-items:flex-end"><div style="flex:2"><label>Nome</label><input type="text" id="n_n"></div><div><label>Minutos</label><input type="text" id="n_d" value="30"></div><div><label>Valor (R$)</label><input type="text" id="n_v" value="0"></div><div style="flex:0"><button class="btn pri" onclick="addProc()">Adicionar</button></div></div></div>`;
}
function formTeam(role) {
  modal(`<h2>${role === 'professional' ? 'Nova profissional' : 'Nova recepcionista'}</h2><p class="kv">Ela entra no sistema com este e-mail e senha.</p>
  <label>Nome</label><input type="text" id="t_n"><label>E-mail</label><input type="text" id="t_e" inputmode="email" autocomplete="off"><label>Senha inicial (mínimo 8 caracteres)</label><input type="text" id="t_p" autocomplete="off">
  <div class="acts"><button class="btn pri" onclick="saveTeam('${role}')">Cadastrar</button><button class="btn" onclick="closeM()">Cancelar</button></div>`);
}
async function saveTeam(role) {
  const r = await run(() => api('POST', '/api/team', { role, name: $('#t_n').value, email: $('#t_e').value, password: $('#t_p').value }));
  if (!r) return; closeM(); await run(reload); pgEquipe(); toast('Cadastrada. Passe o e-mail e a senha para ela entrar.');
}
async function patchMember(id, body) {
  const r = await run(() => api('PATCH', '/api/team/' + id, body));
  if (r) { await run(reload); pgEquipe(); }
  else pgEquipe();
}
function newPw(id) { const p = prompt('Nova senha (mínimo 8 caracteres):'); if (p) run(async () => { await api('PATCH', '/api/team/' + id, { password: p }); toast('Senha alterada'); }); }
async function addProc() {
  const n = $('#n_n').value.trim(); if (!n) return toast('Informe o nome');
  const r = await run(() => api('POST', '/api/procedures', { name: n, dur: $('#n_d').value, price: $('#n_v').value }));
  if (!r) return; S.procs.push(r); S.procs.sort((a, b) => a.name.localeCompare(b.name)); pgEquipe(); toast('Procedimento adicionado');
}
function formProc(id) {
  const p = prc(id);
  modal(`<h2>Editar procedimento</h2><label>Nome</label><input type="text" id="p_n" value="${esc(p.name)}"><div class="row"><div><label>Duração (min)</label><input type="text" id="p_d" value="${p.dur}"></div><div><label>Valor (R$)</label><input type="text" id="p_v" value="${p.price}"></div></div>
  <div class="acts"><button class="btn pri" onclick="saveProc('${id}')">Salvar</button><button class="btn red" onclick="if(confirm('Remover este procedimento da lista? Os agendamentos antigos continuam no histórico.'))hideProc('${id}')">Remover da lista</button><button class="btn" onclick="closeM()">Cancelar</button></div>`);
}
async function saveProc(id) {
  const r = await run(() => api('PATCH', '/api/procedures/' + id, { name: $('#p_n').value, dur: $('#p_d').value, price: $('#p_v').value }));
  if (!r) return; Object.assign(prc(id), r); closeM(); render(); toast('Procedimento salvo');
}
async function hideProc(id) {
  const r = await run(() => api('PATCH', '/api/procedures/' + id, { active: false }));
  if (!r) return; prc(id).active = false; closeM(); render();
}

boot();
