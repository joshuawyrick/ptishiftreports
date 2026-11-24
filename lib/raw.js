/* Raw Samsara data by Pacific day: trips and hours-of-service logs.
   Days are read from saved history when they are settled; recent days and
   missing days are pulled from Samsara and saved. Reports are always
   calculated from this raw data, so a rule change never needs a re-download. */
const Core = require('../public/core.js');
const samsara = require('./samsara');
const store = require('./store');

const SETTLE_DAYS = 14;          // a day younger than this is re-pulled, because logs still get edited
const FRESH_MS = 10 * 60000;     // ...but not more often than this
const MAX_INLINE_DAYS = 100;     // more missing days than this must be loaded from the History page
const RUN_DAYS = 28;
const HOS_CODE = { offDuty: 'off', sleeperBed: 'sb', personalConveyance: 'pc', driving: 'd', onDuty: 'on', yardMove: 'ym' };
const HOS_STATUS = { off: 1, sb: 2, pc: 1, d: 3, on: 4, ym: 4 };
const HOS_CLASS = { off: 'rest', sb: 'rest', pc: 'rest', d: 'drive', on: 'duty', ym: 'duty' };

function daysBetween(a, z) { const out = []; for (let d = a; d <= z; d = Core.addDays(d, 1)) out.push(d); return out; }
const settled = (day, fetchedAt) => fetchedAt >= Core.laMidnight(day) + (SETTLE_DAYS + 1) * Core.DAY;

/* split one duty-status log at Pacific midnights so each day holds its own part */
function splitLog(s, e, rest, add) {
  let a = s;
  while (a < e) { const day = Core.laDate(a), next = Core.laMidnight(Core.addDays(day, 1)), b = Math.min(e, next); add(day, Object.assign({ s: a, e: b }, rest)); a = b; }
}

async function fetchRun(first, last) {
  const a = Core.laMidnight(first), z = Math.min(Date.now(), Core.laMidnight(Core.addDays(last, 1)));
  const trips = {}, hos = {}; for (const d of daysBetween(first, last)) { trips[d] = []; hos[d] = {}; }
  const issues = [];
  if (z <= a) return { trips, hos, issues };
  const [vehicles, drivers] = await Promise.all([samsara.listVehicles(), samsara.listDrivers()]);
  const names = {}; for (const d of drivers) names[String(d.id)] = d.name;
  const errs = await samsara.pool(vehicles, 4, async v => {
    for (const t of await samsara.vehicleTrips(v.id, a, z)) {
      const day = Core.laDate(t.startMs); if (!trips[day]) continue;
      const id = t.driverId ? String(t.driverId) : '';
      trips[day].push({ v: v.name, s: t.startMs, e: t.endMs, m: t.distanceMeters || 0, d: id, dn: names[id] || (id ? 'Driver ' + id : ''), f: (t.startAddress && t.startAddress.name) || null, t: (t.endAddress && t.endAddress.name) || null });
    }
  });
  if (errs.length) issues.push('Trips could not be loaded for ' + errs.length + ' truck' + (errs.length > 1 ? 's' : '') + ': ' + errs[0].message);
  try {
    const data = await samsara.getAll('/fleet/hos/logs', { startTime: new Date(a).toISOString(), endTime: new Date(z).toISOString() });
    for (const r of data) {
      const id = r.driver && String(r.driver.id); if (!id) continue;
      for (const l of r.hosLogs || []) {
        const s = Math.max(a, Date.parse(l.logStartTime)), e = Math.min(z, l.logEndTime ? Date.parse(l.logEndTime) : Date.now()); if (!(e > s)) continue;
        const loc = l.logRecordedLocation || l.location || {};
        splitLog(s, e, { st: HOS_CODE[l.hosStatusType] || 'on', la: loc.latitude || 0, lo: loc.longitude || 0 }, (day, row) => { if (!hos[day]) return; (hos[day][id] = hos[day][id] || { n: r.driver.name, r: [] }).r.push(row); });
      }
    }
  } catch (e) { if (e.status === 401) throw e; issues.push('Hours-of-service logs could not be loaded: ' + e.message); }
  return { trips, hos, issues };
}

const inflight = new Map();
/* Make sure every day from..to is available, then return the combined raw data.
   refresh: false = use what is saved; 'recent' = re-pull unsettled days; 'all' = re-pull everything */
async function load(from, to, refresh, onProgress) {
  const today = Core.laDate(Date.now()); if (to > today) to = today;
  if (from > to) return { trips: new Map(), hos: new Map(), issues: [], vehicles: 0 };
  const key = from + '|' + to + '|' + (refresh || ''); if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const days = daysBetween(from, to), [T, Hh] = await Promise.all([store.getDays('trips', from, to), store.getDays('hos', from, to)]), now = Date.now();
    const need = days.filter(d => {
      const t = T.get(d), h = Hh.get(d); if (!t || !h || refresh === 'all') return true;
      const at = Math.min(t.fetchedAt, h.fetchedAt); if (settled(d, at)) return false;
      return refresh === 'recent' || now - at > FRESH_MS;
    });
    if (need.length > MAX_INLINE_DAYS && !onProgress) { const e = new Error(need.length + ' days in this period are not saved yet. Open History in the menu and load them first, then run the report again.'); e.status = 409; throw e; }
    const issues = []; let done = 0;
    for (let i = 0; i < need.length;) {           // pull runs of consecutive days
      let j = i; while (j + 1 < need.length && j - i + 1 < RUN_DAYS && need[j + 1] === Core.addDays(need[j], 1)) j++;
      const got = await fetchRun(need[i], need[j]); issues.push(...got.issues);
      for (let k = i; k <= j; k++) { const d = need[k]; T.set(d, { data: got.trips[d], fetchedAt: now }); Hh.set(d, { data: got.hos[d], fetchedAt: now }); if (!got.issues.length) { await store.putDay('trips', d, got.trips[d]); await store.putDay('hos', d, got.hos[d]); } }
      done += j - i + 1; if (onProgress) onProgress(done, need.length); i = j + 1;
    }
    const trips = new Map(), hos = new Map();
    for (const d of days) {
      for (const t of (T.get(d) || { data: [] }).data) (trips.get(t.v) || trips.set(t.v, []).get(t.v)).push(t);
      const hd = (Hh.get(d) || { data: {} }).data;
      for (const id of Object.keys(hd)) { const x = hos.get(id) || { name: hd[id].n, rows: [] }; x.name = hd[id].n; x.rows.push(...hd[id].r); hos.set(id, x); }
    }
    return { trips, hos, issues: [...new Set(issues)], vehicles: trips.size, pulled: need.length };
  })();
  inflight.set(key, p); p.finally(() => inflight.delete(key)).catch(() => {});
  return p;
}

/* shapes the calculation code expects */
const tripRow = t => ({ step_type: 'TRIP_ENTRY', step_startMs: t.s, step_endMs: t.e, step_distanceMeters: t.m, driverId: t.d, driverName: t.dn, step_startName: t.f, step_endName: t.t });
const hosRow = r => ({ startMs: r.s, endMs: r.e, activityStatus: HOS_STATUS[r.st] || 4 });
const logRow = r => ({ s: r.s, e: r.e, c: HOS_CLASS[r.st] || 'duty', lat: r.la, lng: r.lo });

/* background load of a long stretch of history */
const job = { running: false, done: 0, total: 0, from: null, to: null, error: '', finishedAt: null };
function startBackfill(from, to, replace) {
  if (job.running) return job;
  Object.assign(job, { running: true, done: 0, total: daysBetween(from, to).length, from, to, error: '', finishedAt: null });
  (async () => {
    try {
      let base = 0;
      for (let a = from; a <= to; a = Core.addDays(a, RUN_DAYS)) {
        const z = Core.addDays(a, RUN_DAYS - 1) > to ? to : Core.addDays(a, RUN_DAYS - 1);
        const r = await load(a, z, replace ? 'all' : false, () => {}); if (r.issues.length) throw new Error(r.issues[0]);
        base += daysBetween(a, z).length; job.done = Math.min(job.total, base);
      }
    } catch (e) { job.error = e.message || 'Loading stopped.'; }
    job.running = false; job.finishedAt = Date.now();
  })();
  return job;
}
module.exports = { load, tripRow, hosRow, logRow, startBackfill, job, splitLog, settled, SETTLE_DAYS };
