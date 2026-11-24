/* Shift rules. Pure logic, no network and no page code, so the server, the
   browser and the tests all run exactly the same calculations.
   These rules were checked against two real shifts from Nov 23, 2026. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TZ = 'America/Los_Angeles';
  const DEFAULT_YARDS = { 'Petrol Transport': 'Petrol Transport (Bakersfield)', 'Santa Maria Yard': 'Santa Maria Yard', 'Coalinga Yard': 'Coalinga Yard' };
  let YARDS = Object.assign({}, DEFAULT_YARDS);
  const H = 3600000, MIN = 60000, DAY = 86400000;
  const HALF_MILE_M = 804.672, M_PER_MI = 1609.344;
  const RULES = { shortCycle: 4 * H, restGap: 10 * H, mergedMax: 18 * H, maxShift: 16 * H, maxDrive: 10 * H, minRest: 10 * H, restart: 34 * H, dutyBoundary: 5 * H };

  function setYards(map) { YARDS = Object.assign({}, map); }
  const isYard = n => !!n && Object.prototype.hasOwnProperty.call(YARDS, n);
  const label = n => (isYard(n) ? YARDS[n] : n);

  function tzOffsetMs(ms) {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
  }
  function laMidnight(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const utc = Date.UTC(y, m - 1, d);
    let ms = utc - tzOffsetMs(utc);
    ms = utc - tzOffsetMs(ms);
    return ms;
  }
  function laDate(ms) { return new Date(ms + tzOffsetMs(ms)).toISOString().slice(0, 10); }
  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  function fmtDT(ms) {
    if (ms == null) return '';
    return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
  }
  function fmtTime(ms) {
    if (ms == null) return '';
    return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
  }
  function fmtDTcsv(ms) {
    if (ms == null) return '';
    return new Date(ms + tzOffsetMs(ms)).toISOString().slice(0, 16).replace('T', ' ');
  }
  function fmtDur(ms) {
    if (ms == null) return '';
    const m = Math.round(ms / MIN);
    return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
  }
  function fmtDurWords(ms) {
    if (ms == null) return '';
    const m = Math.round(ms / MIN), h = Math.floor(m / 60);
    return h ? h + 'h ' + String(m % 60).padStart(2, '0') + 'm' : m + 'm';
  }
  const hrs = ms => (ms == null ? '' : (ms / H).toFixed(2));
  const miles = m => (m / M_PER_MI);
  const mph = (m, ms) => (ms > 0 ? miles(m) / (ms / H) : null);
  function titleCase(n) { return (n || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()); }

  /* trip rows for one vehicle -> sorted, de-duplicated drives */
  function extractTrips(rows, vehName) {
    const seen = new Set(), out = [];
    for (const r of rows || []) {
      if (r.step_type !== 'TRIP_ENTRY') continue;
      const s = +r.step_startMs, e = +r.step_endMs;
      if (!(e >= s) || seen.has(s)) continue;
      seen.add(s);
      out.push({
        veh: vehName, s, e, m: +r.step_distanceMeters || 0,
        driverId: r.driverId ? String(r.driverId) : '', driverName: r.driverName || '',
        fromName: r.step_startName || null, toName: r.step_endName || null
      });
    }
    return out.sort((a, b) => a.s - b.s);
  }

  /* one vehicle's drives -> yard-to-yard cycles */
  function buildCycles(trips) {
    const cycles = []; let cur = null, open = 0;
    const close = (endYard, e, noReturn) => {
      cur.endYard = endYard; cur.s = cur.trips[0].s; cur.e = e; cur.noReturn = !!noReturn;
      const tally = {};
      for (const t of cur.trips) if (t.driverId) { (tally[t.driverId] = tally[t.driverId] || { ms: 0, name: t.driverName }).ms += t.e - t.s; }
      const best = Object.entries(tally).sort((a, b) => b[1].ms - a[1].ms)[0];
      cur.driverId = best ? best[0] : ''; cur.driverName = best ? best[1].name : '';
      cycles.push(cur); cur = null;
    };
    for (const t of trips) {
      if (cur && isYard(t.fromName)) close(t.fromName, cur.trips[cur.trips.length - 1].e, true);
      if (!cur) { if (!isYard(t.fromName)) continue; cur = { veh: t.veh, startYard: t.fromName, trips: [] }; }
      cur.trips.push(t);
      if (isYard(t.toName)) close(t.toName, t.e, false);
    }
    if (cur) open = 1;
    return { cycles, open };
  }

  /* all cycles -> shifts (mid-shift yard returns joined per driver) */
  function buildShifts(allCycles) {
    const byDriver = {};
    for (const c of allCycles) if (c.driverId) (byDriver[c.driverId] = byDriver[c.driverId] || []).push(c);
    const shifts = [];
    for (const id of Object.keys(byDriver)) {
      const list = byDriver[id].sort((a, b) => a.s - b.s);
      let g = null;
      for (const c of list) {
        const gap = g ? c.s - g.e : null;
        const short = g && ((g.e - g.s) < RULES.shortCycle || (c.e - c.s) < RULES.shortCycle);
        if (g && gap >= 0 && gap < RULES.restGap && short && (c.e - g.s) <= RULES.mergedMax) { g.cycles.push(c); g.e = c.e; }
        else { if (g) shifts.push(g); g = { driverId: id, driverName: c.driverName, s: c.s, e: c.e, cycles: [c] }; }
      }
      if (g) shifts.push(g);
    }
    return shifts.map(finishShift).filter(s => s.stops > 0).sort((a, b) => a.s - b.s).map((s, i) => { s.num = i + 1; return s; });
  }

  function finishShift(g) {
    const trips = [].concat(...g.cycles.map(c => c.trips));
    const first = g.cycles[0], last = g.cycles[g.cycles.length - 1];
    let legs = [], accD = 0, accM = 0, accV = 0, accVT = 0, unlisted = 0, prev = label(first.startYard);
    for (let i = 0; i < trips.length; i++) {
      const t = trips[i]; accD += t.e - t.s; accM += t.m;
      if (i === trips.length - 1) { legs.push({ from: prev, name: 'Return: ' + label(last.endYard), place: last.endYard, arr: t.e, dep: null, drive: accD, m: accM, via: accV, viaTime: accVT, isReturn: true }); break; }
      const nx = trips[i + 1];
      const cycleEnd = isYard(t.toName) || (g.cycles.some(c => c.trips[c.trips.length - 1] === t));
      if (t.toName || cycleEnd) {
        const place = t.toName || g.cycles.find(c => c.trips[c.trips.length - 1] === t).endYard;
        const yard = isYard(place);
        legs.push({ from: prev, name: label(place) + (yard ? ' (mid-shift return)' : ''), place, arr: t.e, dep: nx.s, drive: accD, m: accM, via: accV, viaTime: accVT, yardVisit: yard });
        prev = label(place); accD = 0; accM = 0; accV = 0; accVT = 0;
      } else { const gap = Math.max(0, nx.s - t.e); unlisted += gap; accV++; accVT += gap; }
    }
    const merged = [];
    for (const l of legs) {
      const p = merged[merged.length - 1];
      if (p && !l.isReturn && !p.isReturn && p.place === l.place && l.m < HALF_MILE_M) { p.dep = l.dep; p.mergedCount = (p.mergedCount || 1) + 1; }
      else merged.push(l);
    }
    for (let i = 1; i < merged.length; i++) merged[i].from = merged[i - 1].name.replace(' (mid-shift return)', '');
    merged.forEach((l, i) => { l.leg = i + 1; l.onSite = l.isReturn ? null : l.dep - l.arr; });
    const sum = f => merged.reduce((a, l) => a + (f(l) || 0), 0);
    const vehs = [...new Set(g.cycles.map(c => c.veh))];
    return {
      driverId: g.driverId, driver: titleCase(g.driverName), vehicle: vehs.join(' / '),
      startYard: label(first.startYard), endYard: label(last.endYard), s: g.s, e: g.e, date: laDate(g.s),
      dur: g.e - g.s, drive: sum(l => l.drive), onSite: sum(l => l.yardVisit ? 0 : l.onSite), yardTime: sum(l => l.yardVisit ? l.onSite : 0),
      unlisted, meters: sum(l => l.m), stops: merged.filter(l => !l.isReturn && !l.yardVisit).length, legs: merged,
      midReturns: g.cycles.length - 1, noReturn: g.cycles.some(c => c.noReturn), hos: null, flags: []
    };
  }

  /* hours-of-service rows for one driver -> merged blocks of rest / drive / duty.
     activityStatus: 1 off duty, 2 sleeper, 3 driving, anything else on duty */
  function hosBlocks(rows) {
    const cls = st => (st === 1 || st === 2) ? 'rest' : (st === 3 ? 'drive' : 'duty');
    const seen = new Set(), ev = [];
    for (const r of rows || []) {
      const s = +r.startMs, e = +r.endMs; if (!(e > s) || seen.has(s)) continue; seen.add(s);
      ev.push({ s, e, c: cls(+r.activityStatus) });
    }
    ev.sort((a, b) => a.s - b.s);
    const out = [];
    for (const x of ev) {
      const p = out[out.length - 1];
      if (p && x.s < p.e) x.s = p.e;
      if (x.e <= x.s) continue;
      if (p && p.c === x.c && x.s - p.e <= 1000) p.e = x.e; else out.push({ s: x.s, e: x.e, c: x.c });
    }
    return out;
  }
  function hosForShift(shift, blocks) {
    if (!blocks || !blocks.length) return null;
    const slack = 30 * MIN, dataStart = blocks[0].s;
    const bound = b => b.c === 'rest' && (b.e - b.s) >= RULES.dutyBoundary;
    let before = null, after = null;
    for (const b of blocks) {
      if (!bound(b)) continue;
      if (b.e <= shift.s + slack) before = b;
      if (!after && b.s >= shift.e - slack) after = b;
    }
    const covering = blocks.find(b => bound(b) && b.s <= shift.s && b.e >= shift.e);
    if (covering) return { none: true };
    const clockIn = before ? before.e : null, clockOut = after ? after.s : null;
    const a = clockIn != null ? clockIn : shift.s, z = clockOut != null ? clockOut : shift.e;
    const tot = { drive: 0, duty: 0, rest: 0 };
    for (const b of blocks) { const o = Math.min(b.e, z) - Math.max(b.s, a); if (o > 0) tot[b.c] += o; }
    return {
      clockIn, clockOut, drive: tot.drive, onDutyNotDriving: tot.duty, breaks: tot.rest, onDuty: tot.drive + tot.duty,
      restBefore: before ? before.e - before.s : null, restBeforeOpen: before ? before.s <= dataStart : false
    };
  }
  function flagShift(s) {
    const f = [];
    if (s.dur > RULES.maxShift) f.push('Over 16h');
    if (s.drive > RULES.maxDrive) f.push('Drive over 10h');
    if (s.hos && !s.hos.none && s.hos.restBefore != null) {
      if (s.hos.restBefore >= RULES.restart) f.push('34h restart before');
      else if (s.hos.restBefore < RULES.minRest && !s.hos.restBeforeOpen) f.push('Rest under 10h');
    }
    if (s.midReturns) f.push('Returned to yard mid-shift');
    if (s.noReturn) f.push('Return not recorded');
    if (s.hos && s.hos.none) f.push('No ELD log');
    s.flags = f; return s;
  }
  const isOverLimit = f => /Over 16h|over 10h|under 10h/i.test(f);

  function dailyHours(shifts) {
    const m = new Map();
    for (const s of shifts) {
      const k = s.driverId + '|' + s.date;
      const r = m.get(k) || { driver: s.driver, date: s.date, shifts: 0, dur: 0, drive: 0, onSite: 0, meters: 0, stops: 0, hosOnDuty: null, hosDrive: null, flags: new Set() };
      r.shifts++; r.dur += s.dur; r.drive += s.drive; r.onSite += s.onSite; r.meters += s.meters; r.stops += s.stops;
      if (s.hos && !s.hos.none) { r.hosOnDuty = (r.hosOnDuty || 0) + s.hos.onDuty; r.hosDrive = (r.hosDrive || 0) + s.hos.drive; }
      s.flags.forEach(x => r.flags.add(x)); m.set(k, r);
    }
    return [...m.values()].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.driver.localeCompare(b.driver));
  }
  function driverTotals(shifts) {
    const m = new Map();
    for (const s of shifts) {
      const r = m.get(s.driverId) || { driver: s.driver, days: new Set(), shifts: 0, dur: 0, drive: 0, onSite: 0, meters: 0, stops: 0, longest: 0, hosOnDuty: null, over16: 0, over10: 0, shortRest: 0, restarts: 0 };
      r.days.add(s.date); r.shifts++; r.dur += s.dur; r.drive += s.drive; r.onSite += s.onSite; r.meters += s.meters; r.stops += s.stops; r.longest = Math.max(r.longest, s.dur);
      if (s.hos && !s.hos.none) r.hosOnDuty = (r.hosOnDuty || 0) + s.hos.onDuty;
      if (s.flags.includes('Over 16h')) r.over16++; if (s.flags.includes('Drive over 10h')) r.over10++;
      if (s.flags.includes('Rest under 10h')) r.shortRest++; if (s.flags.includes('34h restart before')) r.restarts++;
      m.set(s.driverId, r);
    }
    return [...m.values()].sort((a, b) => a.driver.localeCompare(b.driver));
  }

  return { TZ, RULES, H, MIN, DAY, DEFAULT_YARDS, setYards, isYard, label, laMidnight, laDate, addDays, fmtDT, fmtTime, fmtDTcsv, fmtDur, fmtDurWords, hrs, miles, mph, titleCase,
    extractTrips, buildCycles, buildShifts, hosBlocks, hosForShift, flagShift, isOverLimit, dailyHours, driverTotals };
});
