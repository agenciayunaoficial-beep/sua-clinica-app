'use strict';
// Roda contra um Postgres de teste: DATABASE_URL=postgres://... npm test
process.env.JWT_SECRET = 'teste';
process.env.SETUP_KEY = 'chave-de-teste';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { migrate, pool, q } = require('../src/db');
const { createApp } = require('../src/app');
const { createClinic } = require('../src/services/clinics');

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
  await call('adminA', 'POST', '/api/messages', { kind: 'Confirmação', name: 'Maria', to: '82991112233', text: 'oi', appointmentId: a.data.id });
  let cur = (await call('adminA', 'GET', `/api/appointments?from=${DAY}&to=${DAY}`)).data.appts.find(x => x.id === a.data.id);
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
