/* ELD-first shifts. A shift starts when a driver first goes on duty after a
   full rest and ends when they go off duty for the next full rest. Off-duty
   breaks inside the shift (lunch and so on) do not end it. The shift date is
   the Pacific date it started. Yard GPS data is used as a cross-check. */
const Core = require('../public/core.js');
const samsara = require('./samsara');
const reports = require('./reports');
const raw = require('./raw');

const H = Core.H, MIN = Core.MIN;
const CFG = {
  shiftRest: (Number(process.env.SHIFT_REST_HOURS) || 9) * H,   // a rest this long ends a shift (10h is the legal minimum; 9h allows for small log discrepancies)
  legalRest: 10 * H, restart: 34 * H, maxShift: 16 * H, maxDrive: 10 * H,
  longBreak: 4 * H,          // an off-duty stretch this long inside a shift is an anomaly
  yardRadiusM: 800, lateLogin: 5 * MIN, lateLogout: 60 * MIN
};
const FALLBACK_YARDS = [
  { name: 'Petrol Transport', lat: 35.4544, lng: -119.036 }, { name: 'Santa Maria Yard', lat: 34.9219, lng: -120.468 }, { name: 'Coalinga Yard', lat: 36.1142, lng: -120.372 }];

function meters(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const hasLoc = p => p && p.lat && p.lng;
function yardAt(p, yards) {
  if (!hasLoc(p)) return null;
  for (const y of yards) if (meters(p, y) <= Math.max(CFG.yardRadiusM, y.radius || 0)) return Core.label(y.name);
  return '';
}

/* rows: [{ s, e, c: 'rest'|'drive'|'duty', lat, lng }] for one driver -> shifts */
function buildDriverShifts(rows, yards, asOf) {
  const ev = rows.filter(r => r.e > r.s).sort((a, b) => a.s - b.s);
  // merge neighbouring rest rows into rest blocks
  const blocks = [];
  for (const r of ev) {
    const p = blocks[blocks.length - 1], rest = r.c === 'rest';
    if (p && p.rest && rest && r.s - p.e <= 1000) { p.e = Math.max(p.e, r.e); continue; }
    blocks.push({ s: r.s, e: r.e, rest, c: r.c, lat: r.lat, lng: r.lng });
  }
  const shifts = []; let cur = null, restBefore = null;
  const close = (endRest) => {
    if (!cur) return;
    cur.restAfter = endRest ? endRest.e - endRest.s : null;
    cur.restAfterOpen = !!endRest && endRest.e >= asOf;
    shifts.push(cur); cur = null;
  };
  for (const b of blocks) {
    if (b.rest && b.e - b.s >= CFG.shiftRest) { close(b); restBefore = b; continue; }
    if (b.rest) { if (cur) { cur.breaks.push(b.e - b.s); cur.lastRest = b; } continue; }
    if (!cur) cur = { s: b.s, e: b.e, drive: 0, duty: 0, breaks: [], first: null, last: null, restBefore: restBefore ? restBefore.e - restBefore.s : null, restBeforeOpen: !restBefore };
    cur.e = b.e; cur[b.c === 'drive' ? 'drive' : 'duty'] += b.e - b.s;
    if (hasLoc(b)) { if (!cur.first && b.s - cur.s <= 20 * MIN) cur.first = b; cur.last = b; }
  }
  const open = cur ? 1 : 0;   // still working, or no full rest seen yet: not a finished shift
  return {
    open, shifts: shifts.map(x => {
      // breaks recorded after the last work block do not belong to the shift
      const breaks = x.breaks.slice(0); const inside = [];
      let t = 0; for (const d of breaks) inside.push(d);
      const span = x.e - x.s, onDuty = x.drive + x.duty, off = Math.max(0, span - onDuty);
      const startPlace = yardAt(x.first, yards), endPlace = yardAt(x.last, yards);
      return { s: x.s, e: x.e, date: Core.laDate(x.s), span, onDuty, drive: x.drive, breakTime: off, breakCount: inside.filter(d => d >= 5 * MIN).length, longestBreak: inside.length ? Math.max(...inside) : 0,
        startPlace, endPlace, restBefore: x.restBefore, restBeforeOpen: x.restBeforeOpen, restAfter: x.restAfter, restAfterOpen: x.restAfterOpen };
    })
  };
}

function flag(s) {
  const f = [];
  if (s.span > CFG.maxShift) f.push('Over 16h');
  if (s.drive > CFG.maxDrive) f.push('Drive over 10h');
  if (s.longestBreak >= CFG.longBreak) f.push('Off ' + (s.longestBreak / H).toFixed(1) + 'h mid-shift');
  if (s.restBefore != null && !s.restBeforeOpen && s.restBefore < CFG.legalRest) f.push('Rest before under 10h');
  if (s.startPlace === '') f.push('Started away from a yard');
  if (s.endPlace === '') f.push('Ended away from a yard');
  if (s.yardOut != null && s.yardOut - s.s < -CFG.lateLogin) f.push('On duty after leaving yard');
  if (s.yardIn != null && s.e - s.yardIn > CFG.lateLogout) f.push('On duty long after return');
  if (s.yardOut == null) f.push('No yard trip matched');
  if (s.restAfter != null && s.restAfter >= CFG.restart) f.push('34h reset after');
  s.flags = f; return s;
}
const REVIEW = /Over 16h|over 10h|mid-shift|under 10h|away from a yard|after leaving|long after/i;

async function loadYards() {
  const names = Object.keys(reports.yards());
  try {
    const places = await samsara.getAll('/addresses', { limit: 512 });
    const out = [];
    for (const n of names) {
      const p = places.find(x => x.name === n); if (!p || !p.latitude) continue;
      const r = p.geofence && p.geofence.circle && p.geofence.circle.radiusMeters;
      out.push({ name: n, lat: p.latitude, lng: p.longitude, radius: r || 0 });
    }
    if (out.length) return out;
  } catch (e) { /* fall through */ }
  return FALLBACK_YARDS.filter(y => names.includes(y.name));
}

const HOS_CLASS = { offDuty: 'rest', sleeperBed: 'rest', personalConveyance: 'rest', driving: 'drive', onDuty: 'duty', yardMove: 'duty' };
function logRow(l) {
  const loc = l.logRecordedLocation || l.location || {};
  return { s: Date.parse(l.logStartTime), e: l.logEndTime ? Date.parse(l.logEndTime) : Date.now(), c: HOS_CLASS[l.hosStatusType] || 'duty', lat: loc.latitude || 0, lng: loc.longitude || 0 };
}

const cache = new Map();
function getEldShifts(start, end, refresh) {
  if (!samsara.hasToken()) return Promise.resolve({ example: true, start, end, rows: [], open: 0 });
  const key = start + '|' + end, hit = cache.get(key);
  if (hit && !refresh && Date.now() - hit.at < 2 * 60000) return hit.promise;
  const promise = (async () => {
    const asOf = Date.now();
    const [report, yards, data] = await Promise.all([reports.getReport(start, end, refresh), loadYards(), raw.load(Core.addDays(start, -3), Core.addDays(end, 3), refresh ? 'recent' : false)]);
    const by = new Map(); for (const [id, x] of data.hos) by.set(id, { name: x.name, logs: x.rows });
    const rows = []; let open = 0, located = 0;
    for (const [id, x] of by) {
      const built = buildDriverShifts(x.logs.map(raw.logRow), yards, asOf); open += built.open;
      for (const s of built.shifts) {
        if (s.date < start || s.date > end) continue;
        const gps = report.shifts.filter(g => g.driverId === id && g.s < s.e + 2 * H && g.e > s.s - 2 * H);
        s.driverId = id; s.driver = Core.titleCase(x.name);
        s.truck = [...new Set(gps.map(g => g.vehicle))].join(' / ');
        s.yardOut = gps.length ? Math.min(...gps.map(g => g.s)) : null;
        s.yardIn = gps.length && !gps[gps.length - 1].noReturn ? Math.max(...gps.map(g => g.e)) : null;
        s.yardSpan = s.yardOut != null && s.yardIn != null ? s.yardIn - s.yardOut : null;
        s.stops = gps.reduce((n, g) => n + g.stops, 0); s.meters = gps.reduce((n, g) => n + g.meters, 0);
        if (s.startPlace == null && gps.length) s.startPlace = gps[0].startYard;       // no ELD position: use the GPS yard
        if (s.endPlace == null && s.yardIn != null) s.endPlace = gps[gps.length - 1].endYard;
        if (s.startPlace != null) located++;
        rows.push(flag(s));
      }
    }
    rows.sort((p, q) => p.s - q.s);
    return { example: false, start, end, loadedAt: Date.now(), rows, open, shiftRestHours: CFG.shiftRest / H };
  })();
  cache.set(key, { at: Date.now(), promise }); promise.catch(() => cache.delete(key));
  if (cache.size > 20) cache.delete(cache.keys().next().value);
  return promise;
}
module.exports = { getEldShifts, buildDriverShifts, flag, CFG, FALLBACK_YARDS, REVIEW };
