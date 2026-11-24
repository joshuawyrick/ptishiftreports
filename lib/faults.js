/* Truck fault history. Samsara reports a "fault code reading" every time the
   set of active codes on a truck changes. This turns those readings into
   one row per fault episode: when a code first showed, when it was last
   seen, and whether it was still active at the end of the period. */
const Core = require('../public/core.js');
const samsara = require('./samsara');

function codesIn(reading) {
  const out = [];
  const j = reading.j1939, o = reading.obdii;
  if (j) {
    const l = j.checkEngineLights || {};
    const lamps = [l.stopIsOn && 'Stop', l.warningIsOn && 'Warning', l.protectIsOn && 'Protect', l.emissionsIsOn && 'Emissions'].filter(Boolean);
    for (const d of j.diagnosticTroubleCodes || []) out.push({
      key: 'J|' + d.spnId + '|' + d.fmiId + '|' + (d.txId == null ? '' : d.txId),
      code: 'SPN ' + d.spnId + ' / FMI ' + d.fmiId,
      description: [d.spnDescription, d.fmiDescription].filter(Boolean).join(': '),
      source: d.sourceAddressName || (d.txId == null ? '' : 'Source ' + d.txId), count: d.occurrenceCount || 0, lamps
    });
  }
  if (o) {
    const lamps = o.checkEngineLightIsOn ? ['Check engine'] : [];
    for (const d of o.diagnosticTroubleCodes || [])
      for (const [kind, list] of [['Confirmed', d.confirmedDtcs], ['Pending', d.pendingDtcs], ['Permanent', d.permanentDtcs]])
        for (const c of list || []) out.push({
          key: 'O|' + (c.dtcShortCode || c.dtcId) + '|' + kind, code: c.dtcShortCode || String(c.dtcId), description: c.dtcDescription || '',
          source: kind, count: 0, lamps
        });
  }
  return out;
}

/* vehicles: [{ id, name, faultCodes: [reading, ...] }] -> episodes */
function buildEpisodes(vehicles) {
  const rows = [];
  for (const v of vehicles || []) {
    const readings = (v.faultCodes || []).map(r => Object.assign({ t: Date.parse(r.time) }, r.value || r)).filter(r => r.t).sort((a, b) => a.t - b.t);
    const open = new Map();
    for (const r of readings) {
      const now = codesIn(r), seen = new Set();
      for (const c of now) {
        seen.add(c.key);
        let e = open.get(c.key);
        if (!e) { e = { truck: v.name, code: c.code, description: c.description, source: c.source, first: r.t, last: r.t, readings: 0, count: 0, lamps: new Set(), active: true, cleared: null }; open.set(c.key, e); rows.push(e); }
        e.last = r.t; e.readings++; e.count = Math.max(e.count, c.count); c.lamps.forEach(x => e.lamps.add(x));
        if (!e.description && c.description) e.description = c.description;
      }
      for (const [k, e] of open) if (!seen.has(k)) { e.active = false; e.cleared = r.t; open.delete(k); }
    }
  }
  return rows.map(e => Object.assign(e, { lamps: [...e.lamps], firstDate: Core.laDate(e.first) })).sort((a, b) => b.last - a.last);
}

const cache = new Map();
async function getFaults(start, end, refresh) {
  if (!samsara.hasToken()) return { example: true, start, end, loadedAt: Date.now(), rows: [], trucks: 0 };
  const key = start + '|' + end, hit = cache.get(key);
  if (hit && !refresh && Date.now() - hit.at < 10 * 60000) return hit.promise;
  const promise = (async () => {
    const a = Core.laMidnight(start), z = Math.min(Date.now(), Core.laMidnight(Core.addDays(end, 1)));
    // paged per vehicle by Samsara: merge pages for the same truck
    const data = await samsara.getAll('/fleet/vehicles/stats/history', { types: 'faultCodes', startTime: new Date(a).toISOString(), endTime: new Date(z).toISOString() });
    const byId = new Map();
    for (const v of data) { const x = byId.get(v.id) || { id: v.id, name: v.name, faultCodes: [] }; x.faultCodes.push(...(v.faultCodes || [])); byId.set(v.id, x); }
    return { example: false, start, end, loadedAt: Date.now(), rows: buildEpisodes([...byId.values()]), trucks: byId.size };
  })();
  cache.set(key, { at: Date.now(), promise }); promise.catch(() => cache.delete(key));
  if (cache.size > 20) cache.delete(cache.keys().next().value);
  return promise;
}

module.exports = { getFaults, buildEpisodes, codesIn };
