/* Builds the shift report for a date range: loads Samsara data, converts it
   to the shapes the shift rules expect, and runs the rules. */
const Core = require('../public/core.js');
const samsara = require('./samsara');
const example = require('./example');

/* Yard names must match the saved place names in Samsara exactly.
   Override with the YARD_NAMES secret: "Samsara name=Display name; ..." */
function loadYards() {
  const raw = (process.env.YARD_NAMES || '').trim();
  if (!raw) return Core.DEFAULT_YARDS;
  const map = {};
  for (const part of raw.split(';')) {
    const [name, shown] = part.split('=').map(x => (x || '').trim());
    if (name) map[name] = shown || name;
  }
  return Object.keys(map).length ? map : Core.DEFAULT_YARDS;
}
Core.setYards(loadYards());

const HOS_STATUS = { offDuty: 1, sleeperBed: 2, personalConveyance: 1, driving: 3, onDuty: 4, yardMove: 4 };

const placeName = a => (a && a.name ? a.name : null);
function tripRow(t, driverNames) {
  const id = t.driverId ? String(t.driverId) : '';
  return {
    step_type: 'TRIP_ENTRY', step_startMs: t.startMs, step_endMs: t.endMs, step_distanceMeters: t.distanceMeters,
    driverId: id, driverName: driverNames[id] || (id ? 'Driver ' + id : ''),
    step_startName: placeName(t.startAddress), step_endName: placeName(t.endAddress)
  };
}
function hosRow(l) {
  return { startMs: Date.parse(l.logStartTime), endMs: l.logEndTime ? Date.parse(l.logEndTime) : Date.now(), activityStatus: HOS_STATUS[l.hosStatusType] || 4 };
}

function exampleReport() {
  let cycles = [];
  for (const v of Object.keys(example.trips)) cycles = cycles.concat(Core.buildCycles(Core.extractTrips(example.trips[v], v)).cycles);
  const shifts = Core.buildShifts(cycles);
  shifts.forEach(s => { s.hos = Core.hosForShift(s, Core.hosBlocks(example.hos[s.driverId])); Core.flagShift(s); });
  return { example: true, start: '2026-11-23', end: '2026-11-23', loadedAt: Date.now(), shifts, inProgress: 0, vehicles: 2, issues: [] };
}

const cache = new Map(); // "start|end" -> { at, promise }
const TTL = 10 * 60000;

async function build(start, end) {
  const a = Core.laMidnight(start) - Core.DAY;
  const z = Math.min(Date.now(), Core.laMidnight(Core.addDays(end, 1)) + 2 * Core.DAY);
  const issues = [];

  const [vehicles, drivers] = await Promise.all([samsara.listVehicles(), samsara.listDrivers()]);
  const driverNames = {}; for (const d of drivers) driverNames[String(d.id)] = d.name;

  let cycles = [], inProgress = 0;
  const errs = await samsara.pool(vehicles, 4, async v => {
    const trips = await samsara.vehicleTrips(v.id, a, z);
    const b = Core.buildCycles(Core.extractTrips(trips.map(t => tripRow(t, driverNames)), v.name));
    cycles = cycles.concat(b.cycles); inProgress += b.open;
  });
  if (errs.length) issues.push('Trips could not be loaded for ' + errs.length + ' truck' + (errs.length > 1 ? 's' : '') + ': ' + errs[0].message);

  const shifts = Core.buildShifts(cycles).filter(s => s.date >= start && s.date <= end);
  shifts.forEach((s, i) => { s.num = i + 1; });

  const ids = [...new Set(shifts.map(s => s.driverId))];
  let blocks = {};
  if (ids.length) {
    try {
      const logs = await samsara.hosLogs(ids, Core.laMidnight(start) - 3 * Core.DAY, z);
      for (const id of Object.keys(logs)) blocks[id] = Core.hosBlocks(logs[id].map(hosRow));
    } catch (e) {
      if (e.status === 401) throw e;
      issues.push('Hours-of-service logs could not be loaded, so the ELD columns and rest flags are blank: ' + e.message);
    }
  }
  for (const s of shifts) { s.hos = Core.hosForShift(s, blocks[s.driverId]); Core.flagShift(s); }
  return { example: false, start, end, loadedAt: Date.now(), shifts, inProgress, vehicles: vehicles.length, issues };
}

function getReport(start, end, refresh) {
  if (!samsara.hasToken()) return Promise.resolve(exampleReport());
  const key = start + '|' + end, hit = cache.get(key);
  if (hit && !refresh && Date.now() - hit.at < TTL) return hit.promise;
  const promise = build(start, end);
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return promise;
}

/* Used by the Connection check page: one small request per data type */
async function checkConnection() {
  const out = []; const now = Date.now();
  const tryOne = async (name, fn) => {
    try { out.push({ name, ok: true, detail: await fn() }); } catch (e) { out.push({ name, ok: false, detail: e.message }); }
  };
  let vehicles = [];
  await tryOne('Vehicles', async () => { vehicles = await samsara.listVehicles(); return vehicles.length + ' vehicles found'; });
  await tryOne('Drivers', async () => (await samsara.listDrivers()).length + ' drivers found');
  await tryOne('Trips', async () => {
    if (!vehicles.length) return 'No vehicles to check';
    let n = 0, named = 0;
    for (const v of vehicles.slice(0, 5)) {
      const t = await samsara.vehicleTrips(v.id, now - 3 * Core.DAY, now);
      n += t.length; named += t.filter(x => placeName(x.startAddress) || placeName(x.endAddress)).length;
    }
    return n + ' trips in the last 3 days on the first 5 trucks, ' + named + ' touching a saved place';
  });
  await tryOne('Yards', async () => {
    const places = await samsara.getAll('/addresses', { limit: 512 });
    const names = new Set(places.map(p => p.name));
    const missing = Object.keys(loadYards()).filter(y => !names.has(y));
    if (missing.length) throw new Error('No saved place in Samsara is named: ' + missing.join(', ') + '. Shifts starting there will not be found.');
    return 'All ' + Object.keys(loadYards()).length + ' yards match saved places (' + places.length + ' saved places total)';
  });
  await tryOne('Hours of service', async () => {
    const j = await samsara.get('/fleet/hos/logs', { startTime: new Date(now - Core.DAY).toISOString(), endTime: new Date(now).toISOString() });
    return (j.data || []).length + ' drivers with logs in the last day';
  });
  return out;
}

module.exports = { getReport, checkConnection, exampleReport, tripRow, hosRow };
