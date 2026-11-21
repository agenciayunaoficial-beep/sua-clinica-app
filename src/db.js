'use strict';
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

types.setTypeParser(1082, v => v); // DATE volta como texto "AAAA-MM-DD"

const url = process.env.DATABASE_URL || '';
const local = /localhost|127\.0\.0\.1|railway\.internal|host=\/|%2F/.test(url);
const ssl = process.env.PGSSL === 'disable' || local ? false : { rejectUnauthorized: false };

const pool = new Pool({ connectionString: url || undefined, ssl, max: 10 });
pool.on('error', e => console.error('Erro no banco:', e.message));

const q = (text, params) => pool.query(text, params);

async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally { c.release(); }
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = { pool, q, tx, migrate };
