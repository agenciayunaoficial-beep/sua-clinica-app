'use strict';
// Uso: npm run create-clinic -- "Nome da Clínica" "Nome da Admin" email@exemplo.com "senha-forte" [monthly|annual]
const { migrate, pool } = require('../src/db');
const { createClinic } = require('../src/services/clinics');

(async () => {
  const [clinicName, adminName, email, password, plan] = process.argv.slice(2);
  if (!clinicName || !adminName || !email || !password) {
    console.log('Uso: npm run create-clinic -- "Clínica" "Nome da Admin" email "senha" [monthly|annual]');
    process.exit(1);
  }
  await migrate();
  const r = await createClinic({ name: clinicName, adminName, email, password, plan: plan || 'monthly' });
  console.log('Clínica criada:', r);
  await pool.end();
})().catch(e => { console.error('Erro:', e.message); process.exit(1); });
