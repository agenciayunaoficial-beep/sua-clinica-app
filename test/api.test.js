'use strict';
// Roda contra um Postgres de teste: DATABASE_URL=postgres://... npm test
process.env.JWT_SECRET = 'teste';
process.env.SETUP_KEY = 'chave-de-teste';
process.env.WA_DRIVER = 'fake';          // WhatsApp de mentira (não abre navegador)
process.env.WA_MIN_GAP_MS = '0'; process.env.WA_MAX_GAP_MS = '0';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { migrate, pool, q } = require('../src/db');
const { createApp } = require('../src/app');
const { createClinic } = require('../src/services/clinics');
const wa = require('../src/services/whatsapp');
const waitFor = async (fn, ms = 3000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise(r => setTimeout(r, 25)); } };

let server, base;
const jar = {};   // cookie por "usuário"

async function call(who, method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(jar[who] ? { cookie: jar[who] } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const sc = res.headers.get('set-cookie');
  if (sc) jar[who] = sc.split(';')[0];
  let data = null; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}
const login = async (who, email, password = 'senha-forte-1') => (await call(who, 'POST', '/api/auth/login', { email, password }));

const DAY = '2030-05-14';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let A, B, pro1, pro2, client1, proc1;

before(async () => {
  await migrate();
  await pool.query('TRUNCATE clinics RESTART IDENTITY CASCADE');
  A = await createClinic({ name: 'Clínica A', adminName: 'Ana', email: 'ana@a.com', password: 'senha-forte-1', plan: 'monthly' });
  B = await createClinic({ name: 'Clínica B', adminName: 'Bia', email: 'bia@b.com', password: 'senha-forte-1', plan: 'annual' });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await pool.end(); });

test('login: erra senha, acerta senha, sessão', async () => {
  assert.equal((await login('x', 'ana@a.com', 'errada123')).status, 401);
  assert.equal((await login('x', 'naoexiste@a.com')).status, 401);
  assert.equal((await call('anon', 'GET', '/api/bootstrap')).status, 401);
  assert.equal((await login('adminA', 'ana@a.com')).status, 200);
  assert.equal((await login('adminB', 'bia@b.com')).status, 200);
  const me = await call('adminA', 'GET', '/api/auth/me');
  assert.equal(me.data.me.role, 'admin');
});

test('equipe: limite do plano mensal (2 profissionais + 1 recepcionista)', async () => {
  const mk = (name, email, role) => call('adminA', 'POST', '/api/team', { name, email, role, password: 'senha-forte-1' });
  const p1 = await mk('Dra. Fernanda', 'fer@a.com', 'professional'); assert.equal(p1.status, 201); pro1 = p1.data.id;
  const p2 = await mk('Dra. Camila', 'cam@a.com', 'professional'); assert.equal(p2.status, 201); pro2 = p2.data.id;
  const p3 = await mk('Dra. Extra', 'extra@a.com', 'professional');
  assert.equal(p3.status, 409); assert.equal(p3.data.code, 'plan_limit');
  assert.equal((await mk('Rê', 'rece@a.com', 'receptionist')).status, 201);
  assert.equal((await mk('Rê 2', 'rece2@a.com', 'receptionist')).status, 409);
  assert.equal((await mk('Dup', 'fer@a.com', 'receptionist')).status, 409);       // e-mail repetido
  assert.equal((await call('adminA', 'POST', '/api/team', { name: 'X', email: 'x@a.com', role: 'professional', password: '123' })).status, 400); // senha curta
  // desativar libera vaga
  assert.equal((await call('adminA', 'PATCH', `/api/team/${pro2}`, { active: false })).status, 200);
  const novo = await mk('Dra. Nova', 'nova@a.com', 'professional'); assert.equal(novo.status, 201);
  assert.equal((await call('adminA', 'PATCH', `/api/team/${pro2}`, { active: true })).status, 409); // sem vaga
  pro2 = novo.data.id;
});

test('equipe: plano anual comporta 4 profissionais + 1 recepcionista', async () => {
  for (let i = 1; i <= 4; i++) {
    const r = await call('adminB', 'POST', '/api/team', { name: 'P' + i, email: `p${i}@b.com`, role: 'professional', password: 'senha-forte-1' });
    assert.equal(r.status, 201, 'profissional ' + i);
  }
  assert.equal((await call('adminB', 'POST', '/api/team', { name: 'P5', email: 'p5@b.com', role: 'professional', password: 'senha-forte-1' })).status, 409);
  assert.equal((await call('adminB', 'POST', '/api/team', { name: 'R', email: 'r@b.com', role: 'receptionist', password: 'senha-forte-1' })).status, 201);
});

test('clientes e procedimentos', async () => {
  const c = await call('adminA', 'POST', '/api/clients', { name: 'Maria Silva', phone: '(82) 99111-2233', notes: 'Pele sensível' });
  assert.equal(c.status, 201); client1 = c.data.id;
  assert.equal((await call('adminA', 'POST', '/api/clients', { name: '', phone: '(82) 99111-2233' })).status, 400);
  assert.equal((await call('adminA', 'POST', '/api/clients', { name: 'Sem fone', phone: '12' })).status, 400);
  const p = await call('adminA', 'POST', '/api/procedures', { name: 'Limpeza de pele', dur: 60, price: '150,50' });
  assert.equal(p.status, 201); assert.equal(p.data.price, 150.5); proc1 = p.data.id;
  assert.equal((await call('adminA', 'POST', '/api/procedures', { name: 'X', dur: 2, price: 1 })).status, 400);
});

test('agenda: cria, conflito, encaixe, horário fora, bloqueio', async () => {
  const base = { clientId: client1, procedureId: proc1, professionalId: pro1, date: DAY, time: '08:00', dur: 60 };
  const a1 = await call('adminA', 'POST', '/api/appointments', base);
  assert.equal(a1.status, 201); assert.equal(a1.data.time, '08:00'); assert.equal(a1.data.status, 'agendado');
  const ov = await call('adminA', 'POST', '/api/appointments', { ...base, time: '08:30' });
  assert.equal(ov.status, 409); assert.equal(ov.data.code, 'overlap');
  assert.equal((await call('adminA', 'POST', '/api/appointments', { ...base, time: '08:30', allowOverlap: true })).status, 201); // encaixe
  assert.equal((await call('adminA', 'POST', '/api/appointments', { ...base, professionalId: pro2 })).status, 201);            // outra profissional
  assert.equal((await call('adminA', 'POST', '/api/appointments', { ...base, time: '07:00' })).status, 400);
  assert.equal((await call('adminA', 'POST', '/api/appointments', { ...base, date: '2030-02-31' })).status, 400);
  // bloqueio
  const bl = await call('adminA', 'POST', '/api/blocks', { professionalId: pro1, date: '2030-05-15', start: '08:00', end: '19:00', reason: 'Folga' });
  assert.equal(bl.status, 201);
  const blocked = await call('adminA', 'POST', '/api/appointments', { ...base, date: '2030-05-15', time: '10:00', allowOverlap: true });
  assert.equal(blocked.status, 409); assert.equal(blocked.data.code, 'blocked');
  assert.equal((await call('adminA', 'DELETE', `/api/blocks/${bl.data.id}`)).status, 200);
  assert.equal((await call('adminA', 'POST', '/api/appointments', { ...base, date: '2030-05-15', time: '10:00' })).status, 201);
});

test('fluxo de atendimento e baixa por assinatura/foto', async () => {
  const a = await call('adminA', 'POST', '/api/appointments', { clientId: client1, procedureId: proc1, professionalId: pro1, date: DAY, time: '15:00', dur: 30 });
  const id = a.data.id;
  // não conclui sem iniciar
  assert.equal((await call('adminA', 'POST', `/api/appointments/${id}/finish`, { sign: PNG })).status, 400);
  assert.equal((await call('adminA', 'POST', `/api/appointments/${id}/status`, { status: 'concluido' })).status, 400);
  assert.equal((await call('adminA', 'POST', `/api/appointments/${id}/status`, { status: 'confirmado' })).status, 200);
  assert.equal((await call('adminA', 'POST', `/api/appointments/${id}/status`, { status: 'atendimento' })).status, 200);
  // sem comprovante / comprovante inválido
  assert.equal((await call('adminA', 'POST', `/api/appointments/${id}/finish`, {})).status, 400);
  assert.equal((await call('adminA', 'POST', `/api/appointments/${id}/finish`, { sign: 'data:text/html;base64,AAAA' })).status, 400);
  const ok = await call('adminA', 'POST', `/api/appointments/${id}/finish`, { sign: PNG, photo: PNG });
  assert.equal(ok.status, 200); assert.equal(ok.data.status, 'concluido'); assert.equal(ok.data.hasSign, true); assert.equal(ok.data.hasPhoto, true);
  const proof = await call('adminA', 'GET', `/api/appointments/${id}/proof`);
  assert.equal(proof.data.sign, PNG);
  // concluído não volta
  assert.equal((await call('adminA', 'POST', `/api/appointments/${id}/status`, { status: 'cancelado' })).status, 400);
  assert.equal((await call('adminA', 'PATCH', `/api/appointments/${id}`, { time: '16:00' })).status, 400);
  // listas não carregam as imagens
  const list = await call('adminA', 'GET', `/api/appointments?from=${DAY}&to=${DAY}`);
  assert.ok(!JSON.stringify(list.data).includes('base64'));
});

test('permissões: profissional só inicia/baixa os próprios atendimentos', async () => {
  assert.equal((await login('proA', 'fer@a.com')).status, 200);
  const mine = await call('adminA', 'POST', '/api/appointments', { clientId: client1, procedureId: proc1, professionalId: pro1, date: DAY, time: '17:00', dur: 30 });
  const other = await call('adminA', 'POST', '/api/appointments', { clientId: client1, procedureId: proc1, professionalId: pro2, date: DAY, time: '17:00', dur: 30 });
  assert.equal((await call('proA', 'POST', '/api/appointments', { clientId: client1, procedureId: proc1, professionalId: pro1, date: DAY, time: '18:00', dur: 30 })).status, 403);
  assert.equal((await call('proA', 'POST', `/api/appointments/${other.data.id}/status`, { status: 'atendimento' })).status, 403);
  assert.equal((await call('proA', 'POST', `/api/appointments/${mine.data.id}/status`, { status: 'cancelado' })).status, 403);
  assert.equal((await call('proA', 'POST', `/api/appointments/${mine.data.id}/status`, { status: 'atendimento' })).status, 200);
  assert.equal((await call('proA', 'POST', `/api/appointments/${mine.data.id}/finish`, { photo: PNG })).status, 200);
  assert.equal((await call('proA', 'GET', '/api/team')).status, 403);
  assert.equal((await call('proA', 'POST', '/api/clients', { name: 'X', phone: '82999990000' })).status, 403);
  assert.equal((await call('proA', 'POST', '/api/blocks', { professionalId: pro2, date: DAY, start: '09:00', end: '10:00' })).status, 403);
  assert.equal((await call('proA', 'POST', '/api/blocks', { professionalId: pro1, date: DAY, start: '09:00', end: '10:00' })).status, 201);
});

test('isolamento entre clínicas', async () => {
  const bootB = await call('adminB', 'GET', '/api/bootstrap');
  assert.equal(bootB.data.clients.length, 0);
  assert.equal(bootB.data.appts.length, 0);
  assert.ok(!JSON.stringify(bootB.data).includes('Maria Silva'));
  const appts = (await call('adminA', 'GET', `/api/appointments?from=${DAY}&to=${DAY}`)).data.appts;
  const id = appts[0].id;
  assert.equal((await call('adminB', 'POST', `/api/appointments/${id}/status`, { status: 'cancelado' })).status, 404);
  assert.equal((await call('adminB', 'GET', `/api/appointments/${id}/proof`)).status, 404);
  assert.equal((await call('adminB', 'PATCH', `/api/clients/${client1}`, { name: 'Invadida', phone: '82999990000' })).status, 404);
  assert.equal((await call('adminB', 'GET', `/api/clients/${client1}/history`)).status, 404);
  assert.equal((await call('adminB', 'PATCH', `/api/team/${pro1}`, { name: 'Invadida' })).status, 404);
  // B tenta agendar usando cliente/profissional da clínica A
  const bpro = (await call('adminB', 'GET', '/api/team')).data.team.find(x => x.role === 'professional').id;
  assert.equal((await call('adminB', 'POST', '/api/appointments', { clientId: client1, procedureId: proc1, professionalId: bpro, date: DAY, time: '09:00', dur: 30 })).status, 400);
});

test('importações em lote', async () => {
  const c = await call('adminA', 'POST', '/api/clients/bulk', { clients: [
    { name: 'Carla Mendes', phone: '82 99222-3344' },
    { name: 'Duplicada', phone: '(82) 99111-2233' },     // mesmo telefone da Maria
    { name: 'Joana Lima', phone: '82992223344' },        // duplicada dentro do próprio lote
    { name: '', phone: '82988887777' },
    { name: 'Sem Telefone', phone: '' }
  ] });
  assert.deepEqual(c.data, { created: 1, duplicated: 2, invalid: 2 });
  const b = await call('adminA', 'POST', '/api/appointments/bulk', { items: [
    { date: '2030-06-10', time: '09:00', dur: 40, professionalId: pro1, procedureName: 'Peeling', clientName: 'Carla Mendes', phone: '82992223344' },
    { date: '2030-06-10', time: '09:10', dur: 40, professionalId: pro1, procedureName: 'peeling', clientName: 'Nova Cliente', phone: '82977776666' }, // encaixe, mesmo procedimento
    { date: '2030-06-10', time: '20:00', dur: 40, professionalId: pro1, procedureName: 'Peeling', clientName: 'Fora do horário' },
    { date: '2030-06-10', time: '09:00', dur: 40, professionalId: '999999', procedureName: 'Peeling', clientName: 'Pro inexistente' },
    { date: 'lixo', time: '09:00', professionalId: pro1, procedureName: 'Peeling', clientName: 'Data ruim' }
  ] });
  assert.deepEqual(b.data, { created: 2, newClients: 1, newProcedures: 1, skipped: 3 });
  const hist = await call('adminA', 'GET', `/api/clients/${(await call('adminA', 'GET', '/api/bootstrap')).data.clients.find(x => x.name === 'Carla Mendes').id}/history`);
  assert.equal(hist.data.appts.length, 1);
});

test('edição/remarcação e cancelamento', async () => {
  const a = await call('adminA', 'POST', '/api/appointments', { clientId: client1, procedureId: proc1, professionalId: pro2, date: DAY, time: '11:00', dur: 30 });
  await call('adminA', 'POST', `/api/appointments/${a.data.id}/status`, { status: 'confirmado' });
  assert.equal((await call('adminA', 'POST', '/api/whatsapp/connect')).status, 200); wa.fakeScan(A.clinicId);
  assert.equal((await call('adminA', 'POST', '/api/messages', { kind: 'Confirmação', name: 'Maria', to: '82991112233', text: 'oi', appointmentId: a.data.id })).status, 202);
  const getCur = async () => (await call('adminA', 'GET', `/api/appointments?from=${DAY}&to=${DAY}`)).data.appts.find(x => x.id === a.data.id);
  assert.ok(await waitFor(async () => (await getCur()).wa));
  const cur = await getCur();
  assert.equal(cur.wa, true); assert.equal(cur.status, 'confirmado');
  const mv = await call('adminA', 'PATCH', `/api/appointments/${a.data.id}`, { time: '11:30' });   // remarcar → volta a "agendado" e pede nova confirmação
  assert.equal(mv.status, 200); assert.equal(mv.data.time, '11:30'); assert.equal(mv.data.status, 'agendado'); assert.equal(mv.data.wa, false);
  assert.equal((await call('adminA', 'POST', `/api/appointments/${a.data.id}/status`, { status: 'cancelado' })).status, 200);
  // cancelado libera o horário
  assert.equal((await call('adminA', 'POST', '/api/appointments', { clientId: client1, procedureId: proc1, professionalId: pro2, date: DAY, time: '11:30', dur: 30 })).status, 201);
});

test('modelos de mensagem, senha e criação de clínica protegida', async () => {
  assert.equal((await call('adminA', 'PUT', '/api/settings/wa-templates', { conf: 'a {nome}', lemb: 'b', agenda: 'c' })).status, 200);
  assert.equal((await call('adminA', 'PUT', '/api/settings/wa-templates', { conf: '', lemb: 'b', agenda: 'c' })).status, 400);
  assert.equal((await call('adminA', 'GET', '/api/bootstrap')).data.templates.conf, 'a {nome}');
  assert.equal((await call('adminA', 'POST', '/api/auth/password', { current: 'errada', next: 'nova-senha-123' })).status, 400);
  assert.equal((await call('adminA', 'POST', '/api/auth/password', { current: 'senha-forte-1', next: 'nova-senha-123' })).status, 200);
  assert.equal((await login('novo', 'ana@a.com', 'nova-senha-123')).status, 200);
  const body = { clinicName: 'Nova', adminName: 'N', email: 'n@n.com', password: 'senha-forte-1' };
  assert.equal((await call('anon2', 'POST', '/api/admin/clinics', body)).status, 403);
  assert.equal((await call('anon2', 'POST', '/api/admin/clinics', body, { 'x-setup-key': 'chave-de-teste' })).status, 201);
});

test('clínica cancelada perde o acesso', async () => {
  await q(`UPDATE clinics SET status='canceled' WHERE id=$1`, [B.clinicId]);
  assert.equal((await call('adminB', 'GET', '/api/bootstrap')).status, 402);
  assert.equal((await login('b2', 'bia@b.com')).status, 402);
  await q(`UPDATE clinics SET status='past_due' WHERE id=$1`, [B.clinicId]);
  assert.equal((await call('adminB', 'GET', '/api/bootstrap')).status, 200);
});


test('WhatsApp: conexão por QR, fila de envio, resposta 1/2 e isolamento entre clínicas', async () => {
  await call('adminA', 'POST', '/api/whatsapp/disconnect');
  let st = (await call('adminA', 'GET', '/api/whatsapp/status')).data;
  assert.equal(st.mode, 'real'); assert.equal(st.status, 'disconnected');
  const msg = (extra = {}) => call('adminA', 'POST', '/api/messages', { kind: 'Confirmação', name: 'Maria', to: '82991112233', text: 'oi', ...extra });
  const r0 = await msg(); assert.equal(r0.status, 409); assert.equal(r0.data.code, 'wa_disconnected');

  st = (await call('adminA', 'POST', '/api/whatsapp/connect')).data;
  assert.equal(st.status, 'qr'); assert.ok(st.qr);
  assert.equal((await call('adminB', 'GET', '/api/whatsapp/status')).data.status, 'disconnected');   // outra clínica não é afetada
  assert.equal(wa.fakeScan(A.clinicId), true);
  assert.equal((await call('adminA', 'GET', '/api/whatsapp/status')).data.status, 'connected');

  assert.equal((await msg({ to: 'abc' })).status, 400);                                // telefone inválido
  const cl = (await call('adminA', 'POST', '/api/clients', { name: 'Joana Teste', phone: '(82) 99888-7766' })).data;
  const ap = (await call('adminA', 'POST', '/api/appointments', { clientId: cl.id, procedureId: proc1, professionalId: pro1, date: '2030-06-03', time: '09:00', dur: 30 })).data;
  const sent = await msg({ to: cl.phone, name: cl.name, appointmentId: ap.id });
  assert.equal(sent.status, 202);
  const log = async () => (await call('adminA', 'GET', '/api/whatsapp/status')).data.log.find(l => l.id === sent.data.id);
  assert.equal((await waitFor(async () => (await log()).status === 'enviado')), true);
  const list = (await call('adminA', 'GET', '/api/appointments?from=2030-06-03&to=2030-06-03')).data.appts;
  assert.equal(list.find(x => x.id === ap.id).wa, true);

  const bad = await msg({ to: '(82) 90000-0000', name: 'Sem Zap' });                       // número sem WhatsApp → falha registrada
  assert.equal(bad.status, 202);
  assert.ok(await waitFor(async () => { const l = (await call('adminA', 'GET', '/api/whatsapp/status')).data.log.find(x => x.id === bad.data.id); return l.status === 'falhou' && /WhatsApp/.test(l.detail); }));

  // cliente responde 2 e depois 1
  const said = []; const reply = t => said.push(t);
  await wa.handleReply(A.clinicId, '5582998887766', '2', reply);
  assert.match(said[0], /remarcar/);
  let cur = (await call('adminA', 'GET', '/api/appointments?from=2030-06-03&to=2030-06-03')).data.appts.find(x => x.id === ap.id);
  assert.equal(cur.status, 'agendado');
  await wa.handleReply(A.clinicId, '5582998887766', '1', reply);
  assert.match(said[1], /Confirmado/);
  cur = (await call('adminA', 'GET', '/api/appointments?from=2030-06-03&to=2030-06-03')).data.appts.find(x => x.id === ap.id);
  assert.equal(cur.status, 'confirmado');
  await wa.handleReply(A.clinicId, '5582900000001', '1', reply);                       // número desconhecido é ignorado
  assert.equal(said.length, 2);

  // profissional não mexe no WhatsApp
  assert.equal((await login('pro', 'fer@a.com')).status, 200);
  assert.equal((await call('pro', 'GET', '/api/whatsapp/status')).status, 403);
  assert.equal((await call('pro', 'POST', '/api/whatsapp/connect')).status, 403);

  await call('adminA', 'POST', '/api/whatsapp/disconnect');
  assert.equal((await msg()).status, 409);
});

test('vendas: pagamento, etiqueta de paga, pacote com sessões e indicadores do mês', async () => {
  assert.equal((await login('pro', 'fer@a.com')).status, 200);
  const cl = (await call('adminA', 'POST', '/api/clients', { name: 'Paula Pacote', phone: '(82) 98111-0000' })).data;
  const mkAp = (time, extra = {}) => call('adminA', 'POST', '/api/appointments', { clientId: cl.id, procedureId: proc1, professionalId: pro1, date: '2030-07-10', time, dur: 30, ...extra });
  const av = (await mkAp('10:00')).data;
  const pay = (v) => ({ method: 'pix', amount: v });
  const sale = (extra = {}) => call('adminA', 'POST', '/api/sales', { clientId: cl.id, appointmentId: av.id, kind: 'package', name: 'Pacote Laser 6 sessões', sessions: 3, total: 1200,
    validUntil: '2030-12-31', payments: [{ method: 'pix', amount: 200 }, { method: 'credito', amount: 1000, installments: 4 }], ...extra });

  // validações
  assert.equal((await sale({ payments: [pay(100)] })).status, 400);                         // soma diferente do total
  assert.equal((await sale({ payments: [{ method: 'credito', amount: 1200, installments: 25 }] })).status, 400);
  assert.equal((await sale({ payments: [{ method: 'cheque', amount: 1200 }] })).status, 400);
  assert.equal((await sale({ total: 0 })).status, 400);
  assert.equal((await sale({ sessions: 0 })).status, 400);
  assert.equal((await call('adminB', 'POST', '/api/sales', { clientId: cl.id, kind: 'procedure', name: 'X', total: 10, payments: [pay(10)] })).status, 400); // cliente de outra clínica

  const ok = await sale();
  assert.equal(ok.status, 201);
  assert.equal(ok.data.total, 1200); assert.equal(ok.data.payments.length, 2); assert.equal(ok.data.payments[1].installments, 4);
  assert.equal(ok.data.used, 0);
  let appts = (await call('adminA', 'GET', '/api/appointments?from=2030-07-10&to=2030-07-10')).data.appts;
  assert.equal(appts.find(x => x.id === av.id).paid, true);                                 // etiqueta "Paga"
  assert.equal((await sale()).status, 409);                                                // não paga duas vezes o mesmo agendamento

  // pacote de 3 sessões
  const s1 = await mkAp('11:00', { saleId: ok.data.id }), s2 = await mkAp('12:00', { saleId: ok.data.id }), s3 = await mkAp('13:00', { saleId: ok.data.id });
  assert.equal([s1, s2, s3].every(x => x.status === 201), true);
  const full = await mkAp('14:00', { saleId: ok.data.id });
  assert.equal(full.status, 409); assert.equal(full.data.code, 'pkg_full');
  const late = await call('adminA', 'POST', '/api/appointments', { clientId: cl.id, procedureId: proc1, professionalId: pro1, date: '2031-02-01', time: '10:00', dur: 30, saleId: ok.data.id });
  assert.equal(late.status, 409);                                                          // depois da validade (e pacote cheio: qualquer um dos dois bloqueia)
  // cancelar uma sessão devolve a vaga
  assert.equal((await call('adminA', 'POST', `/api/appointments/${s3.data.id}/status`, { status: 'cancelado' })).status, 200);
  assert.equal((await mkAp('14:00', { saleId: ok.data.id })).status, 201);
  // sessão de outro cliente não usa pacote alheio
  const outro = (await call('adminA', 'POST', '/api/clients', { name: 'Outra Pessoa', phone: '(82) 97000-1111' })).data;
  assert.equal((await call('adminA', 'POST', '/api/appointments', { clientId: outro.id, procedureId: proc1, professionalId: pro1, date: '2030-07-11', time: '10:00', dur: 30, saleId: ok.data.id })).status, 400);

  // ficha do cliente: sessões
  const fich = (await call('adminA', 'GET', `/api/sales?clientId=${cl.id}`)).data.sales[0];
  assert.equal(fich.sessions, 3); assert.equal(fich.scheduled, 3); assert.equal(fich.used, 0);

  // segunda venda avulsa, em outro cliente, para os indicadores
  const av2 = (await call('adminA', 'POST', '/api/appointments', { clientId: outro.id, procedureId: proc1, professionalId: pro1, date: '2030-07-12', time: '10:00', dur: 30 })).data;
  const v2 = await call('adminA', 'POST', '/api/sales', { clientId: outro.id, appointmentId: av2.id, kind: 'procedure', name: 'Pacote Laser 6 sessões', total: 300.5, payments: [{ method: 'debito', amount: 300.5 }] });
  assert.equal(v2.status, 201);
  const v3 = await call('adminA', 'POST', '/api/sales', { clientId: outro.id, kind: 'procedure', name: 'Limpeza de pele', total: 99.5, payments: [{ method: 'dinheiro', amount: 99.5 }] });
  assert.equal(v3.status, 201);

  const month = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7);
  const st = (await call('adminA', 'GET', `/api/sales/stats?month=${month}`)).data;
  assert.equal(st.count, 3); assert.equal(st.revenue, 1600);
  assert.equal(Math.round(st.ticket * 100) / 100, 533.33);
  assert.equal(st.top[0].name, 'Pacote Laser 6 sessões'); assert.equal(st.top[0].qty, 2);
  assert.equal(st.top[1].name, 'Limpeza de pele');
  const pix = st.methods.find(m => m.method === 'pix'); assert.equal(pix.amount, 200);

  // profissional não vê vendas; só admin cancela
  assert.equal((await call('pro', 'GET', '/api/sales/stats')).status, 403);
  assert.equal((await call('pro', 'POST', '/api/sales', { clientId: cl.id, kind: 'procedure', name: 'X', total: 10, payments: [pay(10)] })).status, 403);
  assert.equal((await call('adminA', 'PATCH', `/api/sales/${v3.data.id}`, { status: 'cancelada' })).status, 200);
  const st2 = (await call('adminA', 'GET', `/api/sales/stats?month=${month}`)).data;
  assert.equal(st2.count, 2); assert.equal(st2.revenue, 1500.5);
  // cancelar a venda tira a etiqueta
  assert.equal((await call('adminA', 'PATCH', `/api/sales/${v2.data.id}`, { status: 'cancelada' })).status, 200);
  appts = (await call('adminA', 'GET', '/api/appointments?from=2030-07-12&to=2030-07-12')).data.appts;
  assert.equal(appts.find(x => x.id === av2.id).paid, false);
  // vendas de uma clínica não aparecem na outra
  assert.equal((await call('adminB', 'GET', `/api/sales/stats?month=${month}`)).data.count, 0);
});
