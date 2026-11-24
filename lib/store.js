/* Saved history. With a DATABASE_URL (Replit's PostgreSQL) each day of
   Samsara data is kept so past days load without calling Samsara again.
   Without one, the app keeps days in memory only and works as before. */
let pool = null, ready = null;
const mem = { days: new Map(), settings: new Map() };

function usingDb() { return !!process.env.DATABASE_URL; }
function init(customPool) {
  if (ready) return ready;
  if (!usingDb() && !customPool) return (ready = Promise.resolve(false));
  if (customPool) pool = customPool;
  else {
    const { Pool } = require('pg');
    const local = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, ssl: local || /sslmode=disable/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
    pool.on('error', e => console.error('database connection error:', e.message));
  }
  ready = (async () => {
    await pool.query('create table if not exists day_store (kind text not null, day text not null, data text not null, fetched_at bigint not null, primary key (kind, day))');
    await pool.query('create table if not exists settings (key text primary key, value text not null)');
    return true;
  })();
  ready.catch(e => { console.error('database setup failed, running without saved history:', e.message); pool = null; ready = Promise.resolve(false); });
  return ready;
}

/* -> Map(day -> { data, fetchedAt }) for kind between two 'YYYY-MM-DD' days, inclusive */
async function getDays(kind, from, to) {
  const out = new Map();
  if (await init() && pool) {
    const r = await pool.query('select day, data, fetched_at from day_store where kind = $1 and day >= $2 and day <= $3', [kind, from, to]);
    for (const row of r.rows) out.set(row.day, { data: JSON.parse(row.data), fetchedAt: Number(row.fetched_at) });
  } else for (const [k, v] of mem.days) { const [kk, d] = k.split('|'); if (kk === kind && d >= from && d <= to) out.set(d, v); }
  return out;
}
async function putDay(kind, day, data) {
  const now = Date.now();
  if (await init() && pool) await pool.query('insert into day_store (kind, day, data, fetched_at) values ($1, $2, $3, $4) on conflict (kind, day) do update set data = excluded.data, fetched_at = excluded.fetched_at', [kind, day, JSON.stringify(data), now]);
  else { mem.days.set(kind + '|' + day, { data, fetchedAt: now }); if (mem.days.size > 400) mem.days.delete(mem.days.keys().next().value); }
}
async function coverage(kind) {
  if (await init() && pool) { const r = await pool.query('select min(day) as a, max(day) as z, count(*) as n from day_store where kind = $1', [kind]); return { first: r.rows[0].a, last: r.rows[0].z, days: Number(r.rows[0].n) }; }
  const ds = [...mem.days.keys()].filter(k => k.startsWith(kind + '|')).map(k => k.split('|')[1]).sort();
  return { first: ds[0] || null, last: ds[ds.length - 1] || null, days: ds.length };
}
async function getSetting(key, fallback) {
  if (await init() && pool) { const r = await pool.query('select value from settings where key = $1', [key]); return r.rows.length ? JSON.parse(r.rows[0].value) : fallback; }
  return mem.settings.has(key) ? mem.settings.get(key) : fallback;
}
async function putSetting(key, value) {
  if (await init() && pool) await pool.query('insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [key, JSON.stringify(value)]);
  else mem.settings.set(key, value);
}
async function saved() { return !!(await init()) && !!pool; }
function _reset() { pool = null; ready = null; mem.days.clear(); mem.settings.clear(); }
module.exports = { init, usingDb, saved, getDays, putDay, coverage, getSetting, putSetting, _reset };
