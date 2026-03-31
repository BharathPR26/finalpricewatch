const { Pool } = require('pg');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Works both locally and on Render
// If DATABASE_URL exists (Render/Supabase), use it
// Otherwise use individual settings from .env
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      }
    : {
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT) || 5432,
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME     || 'pricewatch',
      }
);

pool.connect()
  .then(c => { console.log('✅ PostgreSQL connected'); c.release(); })
  .catch(e => console.error('❌ PostgreSQL error:', e.message));

// Wrapper so all routes work without changes
// Converts MySQL ? to PostgreSQL $1, $2, $3
const db = {
  query: async (sql, params) => {
    let i = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++i}`);
    const result = await pool.query(pgSql, params);
    return [result.rows, result.fields];
  },
};

module.exports = db;