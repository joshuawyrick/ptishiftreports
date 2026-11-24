/* Checks the shift rules against the two Nov 23, 2026 shifts that were
   confirmed by hand, and checks the Samsara API conversion. Run: npm test */
const assert = require('assert');
const Core = require('../public/core.js');
const { exampleReport, tripRow, hosRow } = require('../lib/reports');

const r = exampleReport();
assert.strictEqual(r.shifts.length, 2, 'two shifts');
const [dan, juan] = [r.shifts.find(s => s.driver === 'Daniel Sandoval'), r.shifts.find(s => s.driver === 'Juan Ramos')];

// Daniel Sandoval, A287
assert.strictEqual(dan.vehicle, 'A287');
assert.strictEqual(dan.date, '2026-11-23');
assert.strictEqual(Core.fmtDur(dan.dur), '11:06');
assert.strictEqual(dan.stops, 5);                       // WF36, Continental, Magenheimer, Pentland twice
assert.strictEqual(dan.legs.filter(l => l.place === 'Pentland Station').length, 2, 'a 0.57 mile move inside Pentland is over the half-mile merge limit');
assert.strictEqual(Core.miles(dan.meters).toFixed(1), '331.3');
assert.ok(dan.hos && !dan.hos.none);
assert.strictEqual(Core.fmtDur(dan.hos.restBefore), '12:34');
assert.deepStrictEqual(dan.flags, []);

// Juan Ramos, J1: drives through unsaved stops roll into the next saved stop
assert.strictEqual(juan.vehicle, 'J1');
assert.strictEqual(Core.fmtDur(juan.dur), '14:33');
assert.strictEqual(juan.stops, 4);
const rob = juan.legs.find(l => l.place === 'Robinson B Dehy Lease');
assert.strictEqual(Core.miles(rob.m).toFixed(1), '147.5');
assert.ok(juan.unlisted > 0);

// totals
assert.strictEqual(Core.dailyHours(r.shifts).length, 2);
assert.strictEqual(Core.driverTotals(r.shifts).length, 2);

// Samsara REST shapes convert to what the rules expect
const row = tripRow({ startMs: 1, endMs: 2, distanceMeters: 10, driverId: 7, startAddress: { id: 1, name: 'Petrol Transport' }, endAddress: null }, { 7: 'A B' });
assert.deepStrictEqual([row.step_startName, row.step_endName, row.driverName, row.driverId], ['Petrol Transport', null, 'A B', '7']);
assert.strictEqual(hosRow({ hosStatusType: 'sleeperBed', logStartTime: '2026-11-23T00:00:00Z', logEndTime: '2026-11-23T01:00:00Z' }).activityStatus, 2);
assert.strictEqual(hosRow({ hosStatusType: 'driving', logStartTime: '2026-11-23T00:00:00Z', logEndTime: '2026-11-23T01:00:00Z' }).activityStatus, 3);

console.log('All shift rule checks passed.');

// point-to-point: Olympus -> Robinson passed through unsaved stops, Mt Poso -> Olympus passed through one
assert.strictEqual(juan.legs.find(l => l.place === 'Robinson B Dehy Lease').via, 2);
assert.strictEqual(dan.legs.find(l => l.place === 'WF36').via, 0);
assert.strictEqual(Core.mph(1609.344 * 60, Core.H).toFixed(0), '60');
console.log('Point-to-point checks passed.');

// fault history: readings -> episodes
const { buildEpisodes } = require('../lib/faults');
const dtc = (spn, fmi, n) => ({ spnId: spn, fmiId: fmi, occurrenceCount: n, spnDescription: 'Thing', fmiDescription: 'Low', txId: 0 });
const rd = (time, codes, stop) => ({ time, value: { j1939: { checkEngineLights: { stopIsOn: !!stop }, diagnosticTroubleCodes: codes } } });
const ep = buildEpisodes([{ id: '1', name: 'A287', faultCodes: [
  rd('2026-11-20T10:00:00Z', [dtc(100, 1, 1)]), rd('2026-11-20T12:00:00Z', [dtc(100, 1, 3), dtc(200, 4, 1)], true),
  rd('2026-11-21T09:00:00Z', [dtc(200, 4, 2)]), rd('2026-11-22T09:00:00Z', [dtc(100, 1, 4), dtc(200, 4, 2)])] }]);
assert.strictEqual(ep.length, 3, 'code 100 cleared then came back = two episodes, code 200 = one');
const e200 = ep.find(e => e.code === 'SPN 200 / FMI 4');
assert.ok(e200.active && e200.count === 2 && e200.lamps.includes('Stop'));
const first100 = ep.filter(e => e.code === 'SPN 100 / FMI 1').sort((a, b) => a.first - b.first)[0];
assert.ok(!first100.active && first100.cleared === Date.parse('2026-11-21T09:00:00Z') && first100.count === 3);
console.log('Fault history checks passed.');

// 80-hour clock
const { driverClock } = require('../lib/hos');
const HR = 3600000, d0 = Core.laMidnight('2026-11-16'), ds = Array.from({ length: 8 }, (_, i) => Core.laMidnight(Core.addDays('2026-11-16', i)));
const mk = []; // 6 days of 14h on duty (11h drive), 10h off between, then a 34h+ rest, then one 5h day
for (let i = 0; i < 6; i++) { const s = d0 + i * 24 * HR + 4 * HR; mk.push({ s: s, e: s + 11 * HR, c: 'drive' }, { s: s + 11 * HR, e: s + 14 * HR, c: 'duty' }, { s: s + 14 * HR, e: s + 24 * HR, c: 'rest' }); }
const asOf1 = d0 + 6 * 24 * HR + 2 * HR;
const c1 = driverClock(mk.map(x => Object.assign({}, x)), asOf1, ds);
assert.strictEqual(c1.used, 84 * HR, '6 x 14h = 84h, over 80'); assert.ok(c1.left < 0); assert.strictEqual(c1.overDrive, 6); assert.strictEqual(c1.pastWindow, 0);
const mk2 = mk.slice(0, -1).concat([{ s: d0 + 5 * 24 * HR + 18 * HR, e: d0 + 7 * 24 * HR + 6 * HR, c: 'rest' }, { s: d0 + 7 * 24 * HR + 6 * HR, e: d0 + 7 * 24 * HR + 11 * HR, c: 'duty' }]);
const c2 = driverClock(mk2, d0 + 7 * 24 * HR + 12 * HR, ds);
assert.strictEqual(c2.used, 5 * HR, 'only time after the 36h reset counts'); assert.ok(c2.resetEnd);
console.log('80-hour clock checks passed.');

// ELD-first shifts, from Raul Aldape's real log blocks, Nov 1-3 2026 (timesheet: 11/1 = 12.00, 11/2 = 17.00)
const eldLib = require('../lib/eldshifts');
const Y = { lat: 35.45495, lng: -119.035034 }, L = { lat: 35.294937, lng: -118.92461 }, X = { lat: 33.9, lng: -118.2 };
const B = (s, e, c, p) => Object.assign({ s, e, c }, p || { lat: 0, lng: 0 });
const raul = [
  B(1793516400000, 1793545331000, 'duty', X), B(1793545331000, 1793581424000, 'rest', Y),
  B(1793581424000, 1793581435119, 'duty'), B(1793581435119, 1793596939000, 'duty', Y), B(1793596939000, 1793599105000, 'rest', X), B(1793599105000, 1793607000000, 'drive', X),
  B(1793607000000, 1793608800000, 'rest', X), B(1793608800000, 1793623618000, 'drive', X), B(1793623618000, 1793624485000, 'duty', Y),
  B(1793624485000, 1793690879168, 'rest', Y), B(1793690879168, 1793692279000, 'rest', Y),
  B(1793692279000, 1793709168000, 'duty', Y), B(1793709168000, 1793711770000, 'rest', X), B(1793711770000, 1793717100000, 'duty', X), B(1793717100000, 1793718900000, 'rest', X),
  B(1793718900000, 1793736398000, 'drive', X), B(1793736398000, 1793738466000, 'rest', X), B(1793738466000, 1793749462000, 'duty', L), B(1793749462000, 1793800000000, 'rest', L)];
const rs = eldLib.buildDriverShifts(raul, eldLib.FALLBACK_YARDS, 1793800000000).shifts;
assert.strictEqual(rs.length, 3);
assert.strictEqual(rs[1].date, '2026-11-01'); assert.strictEqual((rs[1].span / 3600000).toFixed(2), '11.96'); assert.strictEqual(rs[1].startPlace, 'Petrol Transport (Bakersfield)'); assert.strictEqual(rs[1].endPlace, 'Petrol Transport (Bakersfield)');
assert.strictEqual(rs[2].date, '2026-11-02', 'a shift that starts 11:51 PM on 11/2 belongs to 11/2'); assert.strictEqual((rs[2].span / 3600000).toFixed(2), '15.88'); assert.strictEqual(rs[2].endPlace, '');
assert.ok(eldLib.flag(Object.assign({ yardOut: null, yardIn: null }, rs[2])).flags.includes('Ended away from a yard'));
// a 6 hour off-duty stretch does not end the shift and is flagged
const odd = eldLib.buildDriverShifts([B(0, 36e6, 'rest', Y), B(36e6, 54e6, 'duty', Y), B(54e6, 54e6 + 6 * 36e5, 'rest', Y), B(54e6 + 6 * 36e5, 100e6, 'duty', Y), B(100e6, 140e6, 'rest', Y)], eldLib.FALLBACK_YARDS, 140e6).shifts;
assert.strictEqual(odd.length, 1); assert.ok(eldLib.flag(Object.assign({ yardOut: null, yardIn: null }, odd[0])).flags.some(f => /mid-shift/.test(f)));
console.log('ELD shift checks passed.');
