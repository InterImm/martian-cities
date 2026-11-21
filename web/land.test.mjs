// Checks for the land register plan (web/js/land-plan.js + cities/isidis-procyon/plots.json).
// Run: node web/land.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { readPlan, lotFrame, lotAddress, ringStatus, cleanBuilding, lotLatLon, storyDate, polar } from './js/land-plan.js';

const plan = readPlan(JSON.parse(readFileSync(new URL('./cities/isidis-procyon/plots.json', import.meta.url))));
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('lot ids are unique and well formed', () => {
  assert.equal(plan.byId.size, plan.lots.length);
  for (const l of plan.lots) assert.match(l.id, /^[A-H]\d{1,4}$/);
  assert.ok(plan.lots.length > 1500, 'enough lots');
});

t('house numbers: odd on the inner side, even on the outer side', () => {
  for (const l of plan.lots) assert.equal(+l.id.slice(1) % 2, l.side === 0 ? 1 : 0, l.id);
});

t('lots do not overlap each other or the streets', () => {
  const W = plan.widths;
  for (const l of plan.lots) {
    const ring = plan.rings[l.ring];
    assert.ok(l.r2 <= ring.r - W.street / 2 + 1e-9 || l.r1 >= ring.r + W.street / 2 - 1e-9, `${l.id} off its ring street`);
    for (const av of plan.avenues) {
      const rm = (l.r1 + l.r2) / 2, half = (W.avenue / 2) / rm * 180 / Math.PI;
      for (const b of [av.bearing, av.bearing + 360]) assert.ok(l.b2 <= b - half + 2e-3 || l.b1 >= b + half - 2e-3, `${l.id} crosses ${av.id}`); // bearings are stored to 0.001°
    }
  }
  // same ring and side: angular ranges must not intersect
  const groups = new Map();
  for (const l of plan.lots) { const k = l.ring + ':' + l.side; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
  for (const list of groups.values()) {
    list.sort((a, b) => a.b1 - b.b1);
    for (let i = 1; i < list.length; i++) assert.ok(list[i].b1 >= list[i - 1].b2 - 1e-6, `${list[i - 1].id} overlaps ${list[i].id}`);
  }
});

t('a building faces its street', () => {
  for (const l of plan.lots.slice(0, 400)) {
    const f = lotFrame(plan, l), front = [f.x + Math.sin(f.yaw) * 10, f.z + Math.cos(f.yaw) * 10];
    const ring = plan.rings[l.ring], street = polar(plan.core, ring.r, f.bearing), here = [f.x, f.z];
    const d0 = Math.hypot(here[0] - street[0], here[1] + street[1]), d1 = Math.hypot(front[0] - street[0], front[1] + street[1]);
    assert.ok(d1 < d0, `${l.id} faces away from ${ring.name}`);
  }
});

t('addresses read well in both languages', () => {
  const l = plan.byId.get(plan.lots.find(x => x.ring === 0).id);
  const en = lotAddress(plan, l, 'en'), cn = lotAddress(plan, l, 'cn');
  assert.match(en.line, /^\d+ Pioneer Ring$/); assert.match(cn.line, /^开拓者环 \d+ 号$/);
  assert.match(en.between, /^between \w+ and \w+ avenues$/); assert.match(cn.between, /大道与.+大道之间$/);
});

t('frontier rings open in order as the city fills', () => {
  let s = ringStatus(plan, { lots: {} });
  assert.deepEqual(s.map(r => r.open), [true, true, true, true, false, false, false, false]);
  const D = plan.lots.filter(l => l.ringInfo.id === 'D'), need = Math.ceil(D.length * 0.25);
  const lots = Object.fromEntries(D.slice(0, need - 1).map(l => [l.id, { holder: 'x' }]));
  assert.equal(ringStatus(plan, { lots }).find(r => r.id === 'E').open, false);
  lots[D[need - 1].id] = { holder: 'x' };
  s = ringStatus(plan, { lots });
  assert.equal(s.find(r => r.id === 'E').open, true);
  assert.equal(s.find(r => r.id === 'F').open, false);
});

t('building parameters are cleaned to the zone rules', () => {
  const b = cleanBuilding(plan, 'homes', { type: 'workshop', floors: 99, color: 'pink', roof: 'pool', sign: '<b>hello</b> this is far too long a sign' });
  assert.equal(b.type, 'vault'); assert.ok(b.floors <= 6); assert.equal(b.color, 'regolith'); assert.equal(b.roof, 'flat');
  assert.ok(!b.sign.includes('<') && b.sign.length <= plan.building.signMax);
  const tower = cleanBuilding(plan, 'commerce', { type: 'tower', floors: 12 });
  assert.equal(tower.floors, 12);
  assert.equal(cleanBuilding(plan, 'homes', { type: 'tower', floors: 12 }).floors, 6);
});

t('coordinates and story date', () => {
  const l = plan.lots[0], { lat, lon } = lotLatLon(plan, l);
  assert.ok(Math.abs(lat - 16.18) < 0.05 && Math.abs(lon - 84.62) < 0.05);
  assert.equal(storyDate(new Date('2026-10-03T12:00:00Z')), '2219-10-03');
});

console.log(`${n} land checks passed`);
