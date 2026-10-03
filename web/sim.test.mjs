import assert from 'node:assert/strict';
import { marsState, taiMinusUtc } from './js/marstime.js';
import { sunPosition, MARS } from './js/sim.js';
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
// Latitude parameter: noon equinox elevation is 90 - lat anywhere.
s = sunPosition(MARS.solHours / 2, 0, 40); assert.ok(Math.abs(d(s.el) - 50) < 0.01, 'noon elevation at 40N');
console.log('sim tests pass');

// ---- Mars time ----
{
  const wrap = x => ((x + 180) % 360 + 360) % 360 - 180;
  assert.equal(taiMinusUtc(Date.UTC(2026, 9, 3)), 37, 'TAI-UTC is 37 s now');
  assert.equal(taiMinusUtc(Date.UTC(2013, 0, 1)), 35);
  assert.ok(Math.abs(wrap(marsState(Date.UTC(2021, 1, 7)).ls)) < 2, 'Mars year 36 starts near 2021-02-07 (Ls 0)');
  assert.ok(Math.abs(marsState(Date.UTC(2022, 11, 26)).ls - 360) < 2 || marsState(Date.UTC(2022, 11, 26)).ls < 2, 'Mars year 37 starts near 2022-12-26');
  const a = marsState(Date.UTC(2026, 9, 3, 0), 87), b = marsState(Date.UTC(2026, 9, 4, 0), 87);
  const drift = ((b.lmst - a.lmst + 36) % 24) - 12;
  assert.ok(Math.abs(drift - (-0.6597)) < 0.02, 'mean solar time slips by ~39.6 min per Earth day, got ' + drift);
  const c = marsState(Date.UTC(2026, 9, 3, 6), 0), d = marsState(Date.UTC(2026, 9, 3, 6), 90);
  assert.ok(Math.abs(((d.lmst - c.lmst + 24) % 24) - 6) < 1e-6, '90 degrees east is 6 h later');
  assert.ok(Math.abs(c.eotHours) < 0.7, 'equation of time within +-40 min');
}
console.log('mars time tests pass');
