import assert from 'node:assert/strict';
import { sunPosition, budget, MARS } from './js/sim.js';
const d = x => x * 180 / Math.PI;
// Noon at equinox: sun due south-ish high, elevation = 90 - lat.
let s = sunPosition(MARS.solHours / 2, 0);
assert.ok(Math.abs(d(s.el) - (90 - 12.9)) < 0.01, 'noon equinox elevation');
assert.ok(Math.abs(Math.abs(d(s.az)) - 180) < 0.01, 'noon sun due south');
// Midnight: sun below horizon.
assert.ok(sunPosition(0, 90).el < 0, 'midnight below horizon');
// Morning sun is in the east (azimuth between 0 and 180).
s = sunPosition(8, 0); assert.ok(d(s.az) > 0 && d(s.az) < 180, 'morning east');
s = sunPosition(16, 0); assert.ok(d(s.az) < 0, 'afternoon west');
// Budget scales linearly and matches hand calc: 1000 people * 30 kWh / (2.5*.22*.75) = 72727 m2.
let b = budget(1000);
assert.ok(Math.abs(b.panelM2 - 72727.27) < 1);
assert.ok(Math.abs(budget(2000).panelM2 / b.panelM2 - 2) < 1e-9);
assert.ok(Math.abs(b.waterMakeupLDay - 1250) < 1e-6);
assert.ok(Math.abs(b.stormStorageMWh - 630) < 1e-6);
// Latitude parameter: noon equinox elevation is 90 - lat anywhere.
s = sunPosition(MARS.solHours / 2, 0, 40); assert.ok(Math.abs(d(s.el) - 50) < 0.01, 'noon elevation at 40N');
console.log('sim tests pass');
