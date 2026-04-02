const { Pool } = require('pg');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ── Single shared pool — used by BOTH db queries AND session store
// Supabase free plan: max 15 connections
// Keep pool small to avoid exhaustion
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max:             5,   // max 5 connections in pool
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      }
    : {
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT) || 5432,
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME     || 'pricewatch',
        max:      5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      }
);

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

pool.connect()
  .then(c => { console.log('✅ PostgreSQL connected'); c.release(); })
  .catch(e => console.error('❌ PostgreSQL error:', e.message));

// Query wrapper — converts MySQL ? placeholders to PostgreSQL $1,$2,$3
const db = {
  query: async (sql, params) => {
    let i = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++i}`);
    try {
      const result = await pool.query(pgSql, params);
      return [result.rows, result.fields];
    } catch (err) {
      console.error('DB Query Error:', err.message, '\nSQL:', pgSql);
      throw err;
    }
  },
  // Expose pool so server.js can reuse it for session store
  pool,
};

module.exports = db;