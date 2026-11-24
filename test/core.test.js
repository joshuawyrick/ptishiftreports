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
