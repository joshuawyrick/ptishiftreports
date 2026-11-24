/* PTI Shift Reports: web server.
   Secrets (set in Replit under Secrets, never in this code):
     SAMSARA_API_TOKEN  read-only Samsara API key
     APP_PASSWORD       the shared password for the office
     SESSION_SECRET     optional; any long random text */
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const Core = require('./public/core.js');
const samsara = require('./lib/samsara');
const reports = require('./lib/reports');
const faults = require('./lib/faults');
const hos = require('./lib/hos');
const eld = require('./lib/eldshifts');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false }));

const PASSWORD = (process.env.APP_PASSWORD || '').trim();
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('pti|' + PASSWORD + '|' + (process.env.SAMSARA_API_TOKEN || '')).digest('hex');
const LIVE = samsara.hasToken();
const WEEK = 7 * 86400000;

/* ---- sign-in: one shared password, signed cookie ---- */
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
function makeCookie() { const exp = String(Date.now() + WEEK); return exp + '.' + sign(exp); }
function validCookie(c) {
  if (!c) return false;
  const [exp, sig] = c.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}
const attempts = new Map(); // ip -> { n, until }
function tooMany(ip) { const a = attempts.get(ip); return a && a.n >= 8 && a.until > Date.now(); }
function noteFail(ip) {
  const a = attempts.get(ip); const now = Date.now();
  if (!a || a.until < now) attempts.set(ip, { n: 1, until: now + 15 * 60000 }); else a.n++;
}

const page = name => path.join(__dirname, 'public', name);

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff'); res.set('X-Frame-Options', 'SAMEORIGIN'); res.set('Referrer-Policy', 'same-origin');
  next();
});
app.get('/healthz', (req, res) => res.send('ok'));

app.get('/login', (req, res) => res.sendFile(page('login.html')));
app.post('/login', (req, res) => {
  if (!PASSWORD) return res.redirect('/');
  const ip = req.ip;
  if (tooMany(ip)) return res.redirect('/login?e=wait');
  const given = Buffer.from(String(req.body.password || '')), want = Buffer.from(PASSWORD);
  if (given.length === want.length && crypto.timingSafeEqual(given, want)) {
    attempts.delete(ip);
    res.cookie('pti', makeCookie(), { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: WEEK });
    return res.redirect('/');
  }
  noteFail(ip);
  res.redirect('/login?e=wrong');
});
app.post('/logout', (req, res) => { res.clearCookie('pti'); res.redirect('/login'); });

/* files the sign-in page itself needs */
app.get(['/styles.css', '/favicon.svg', '/pti-logo.png', '/oilfield-banner.png'], (req, res) => res.sendFile(page(req.path.slice(1))));

/* gate: live data is never shown without the password */
app.use((req, res, next) => {
  if (!LIVE) return next();                       // example data only, nothing private
  if (!PASSWORD) {
    if (req.path.startsWith('/api/')) return res.status(503).json({ error: 'Set the APP_PASSWORD secret, then restart the app.' });
    return res.status(503).sendFile(page('setup.html'));
  }
  if (validCookie(readCookie(req, 'pti'))) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Signed out. Sign in again.' });
  res.redirect('/login');
});

app.get('/api/status', (req, res) => res.json({ live: LIVE, signedIn: LIVE && !!PASSWORD, today: Core.laDate(Date.now()) }));

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
app.get('/api/report', async (req, res) => {
  const { start, end } = req.query;
  if (!isDate(start) || !isDate(end) || end < start) return res.status(400).json({ error: 'Choose a start date and an end date on or after it.' });
  const days = Math.round((Core.laMidnight(end) - Core.laMidnight(start)) / Core.DAY) + 1;
  if (days > 92) return res.status(400).json({ error: 'Choose a period of 92 days or less.' });
  try {
    res.json(await reports.getReport(start, end, req.query.refresh === '1'));
  } catch (e) {
    console.error('report failed:', e.message);
    res.status(502).json({ error: e.message || 'The report could not be loaded.' });
  }
});
app.get('/api/faults', async (req, res) => {
  const { start, end } = req.query;
  if (!isDate(start) || !isDate(end) || end < start) return res.status(400).json({ error: 'Choose a start date and an end date on or after it.' });
  if (Math.round((Core.laMidnight(end) - Core.laMidnight(start)) / Core.DAY) + 1 > 92) return res.status(400).json({ error: 'Choose a period of 92 days or less.' });
  try { res.json(await faults.getFaults(start, end, req.query.refresh === '1')); }
  catch (e) { console.error('faults failed:', e.message); res.status(502).json({ error: e.message || 'Fault history could not be loaded.' }); }
});
app.get('/api/eldshifts', async (req, res) => {
  const { start, end } = req.query;
  if (!isDate(start) || !isDate(end) || end < start) return res.status(400).json({ error: 'Choose a start date and an end date on or after it.' });
  if (Math.round((Core.laMidnight(end) - Core.laMidnight(start)) / Core.DAY) + 1 > 92) return res.status(400).json({ error: 'Choose a period of 92 days or less.' });
  try { res.json(await eld.getEldShifts(start, end, req.query.refresh === '1')); }
  catch (e) { console.error('eld shifts failed:', e.message); res.status(502).json({ error: e.message || 'Shift hours could not be loaded.' }); }
});
app.get('/api/hos', async (req, res) => {
  if (!isDate(req.query.end)) return res.status(400).json({ error: 'Choose an end date.' });
  try { res.json(await hos.getClocks(req.query.end, req.query.refresh === '1')); }
  catch (e) { console.error('hos failed:', e.message); res.status(502).json({ error: e.message || 'Hours of service could not be loaded.' }); }
});
app.get('/api/check', async (req, res) => {
  if (!LIVE) return res.json({ live: false, checks: [] });
  try { res.json({ live: true, checks: await reports.checkConnection() }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: 0 }));

const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log('PTI Shift Reports running on port ' + port + (LIVE ? ' with live Samsara data' : ' with example data (no SAMSARA_API_TOKEN yet)'));
  if (LIVE && !PASSWORD) console.log('APP_PASSWORD is not set: the app is locked until it is.');
});
