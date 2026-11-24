/* California intrastate, flammable-liquid tank vehicle hours of service:
   10 hours driving and no driving after the 16th hour, each measured from
   the last 10 consecutive hours off; 80 on-duty hours in 8 consecutive days;
   a 34-hour off-duty period starts a fresh 80. Built from ELD duty logs. */
const Core = require('../public/core.js');
const samsara = require('./samsara');
const { hosRow } = require('./reports');

const LIMIT = { cycle: 80 * Core.H, days: 8, drive: 10 * Core.H, window: 16 * Core.H, rest: 10 * Core.H, restart: 34 * Core.H };

/* blocks: merged rest/drive/duty blocks for one driver. asOf: epoch ms. dayStarts: 8 local midnights, oldest first */
function driverClock(blocks, asOf, dayStarts) {
  const bs = blocks.filter(b => b.s < asOf).map(b => ({ s: b.s, e: Math.min(b.e, asOf), c: b.c }));
  const work = (a, z, cls) => bs.reduce((t, b) => { if (b.c === 'rest' || (cls && b.c !== cls)) return t; const o = Math.min(b.e, z) - Math.max(b.s, a); return o > 0 ? t + o : t; }, 0);
  // most recent 34-hour reset
  let reset = null; for (const b of bs) if (b.c === 'rest' && b.e - b.s >= LIMIT.restart) reset = b;
  const inReset = !!reset && reset.e >= asOf;
  const from = Math.max(dayStarts[0], reset ? reset.e : 0);
  const used = inReset ? 0 : work(from, asOf);
  const days = dayStarts.map((d, i) => work(d, i + 1 < dayStarts.length ? dayStarts[i + 1] : asOf));
  let streak = 0; for (let i = days.length - 1; i >= 0; i--) { if (days[i] > 0) streak++; else if (i === days.length - 1) continue; else break; }
  // work periods: stretches between rests of 10 hours or more
  let overDrive = 0, pastWindow = 0, cur = null; const periods = [];
  const close = () => { if (cur) { periods.push(cur); cur = null; } };
  for (const b of bs) {
    if (b.c === 'rest' && b.e - b.s >= LIMIT.rest) { close(); continue; }
    if (b.c === 'rest') continue;
    if (!cur) cur = { s: b.s, drive: 0, lastDrive: null };
    if (b.c === 'drive') { cur.drive += b.e - b.s; cur.lastDrive = b.e; }
  }
  close();
  for (const p of periods) { if (p.s < dayStarts[0]) continue; if (p.drive > LIMIT.drive) overDrive++; if (p.lastDrive && p.lastDrive - p.s > LIMIT.window + 60000) pastWindow++; }
  return { used, left: LIMIT.cycle - used, days, streak, resetEnd: reset && !inReset ? reset.e : null, inReset, overDrive, pastWindow, active: days.some(d => d > 0) };
}

const cache = new Map();
async function getClocks(end, refresh) {
  if (!samsara.hasToken()) return { example: true, end, rows: [], dayLabels: [] };
  const hit = cache.get(end);
  if (hit && !refresh && Date.now() - hit.at < 10 * 60000) return hit.promise;
  const promise = (async () => {
    const asOf = Math.min(Date.now(), Core.laMidnight(Core.addDays(end, 1)));
    const last = Core.laDate(asOf - 1), dates = []; for (let i = LIMIT.days - 1; i >= 0; i--) dates.push(Core.addDays(last, -i));
    const dayStarts = dates.map(Core.laMidnight);
    const data = await samsara.getAll('/fleet/hos/logs', { startTime: new Date(dayStarts[0] - 8 * Core.DAY).toISOString(), endTime: new Date(asOf).toISOString() });
    const by = new Map();
    for (const r of data) { const id = r.driver && String(r.driver.id); if (!id) continue; const x = by.get(id) || { name: r.driver.name, logs: [] }; x.logs.push(...(r.hosLogs || [])); by.set(id, x); }
    const rows = [];
    for (const [id, x] of by) { const c = driverClock(Core.hosBlocks(x.logs.map(hosRow)), asOf, dayStarts); if (c.active) rows.push(Object.assign({ driverId: id, driver: Core.titleCase(x.name) }, c)); }
    rows.sort((a, b) => a.left - b.left);
    return { example: false, end, asOf, loadedAt: Date.now(), dayLabels: dates, rows };
  })();
  cache.set(end, { at: Date.now(), promise }); promise.catch(() => cache.delete(end));
  if (cache.size > 20) cache.delete(cache.keys().next().value);
  return promise;
}
module.exports = { getClocks, driverClock, LIMIT };
