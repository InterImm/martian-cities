// Cuts Procyon City's free land into numbered lots: the land register behind "claim a plot".
//
//   node tools/plots.mjs            writes web/cities/isidis-procyon/plots.json
//   node tools/plots.mjs --check    fails if that file is out of date (CI)
//
// The lots come from the city model itself. The STL is rasterised top-down at 2 m; a lot is
// only kept where the ground is free: on the green ground slab for the inner rings (no
// building, no road), on bare regolith for the frontier rings. Streets follow the city's
// octagonal plan: ring streets around the InterImm core, named after the years the city grew
// through, and radial avenues that point along the great circle to the other Mars cities.
// Lots are stored in polar form (radii and bearings around the core), so the explorer, the
// deed poster and the desk all rebuild exactly the same shapes from a small file.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STL = join(ROOT, 'web/assets/isidis-city-procyon.stl');
const OUT = join(ROOT, 'web/cities/isidis-procyon/plots.json');
const CELL = 2;               // raster cell, metres (the STL is in metres)
const FLAT_RADIUS = 2300;     // web/cities/cities.json terrain.flatRadius: flat ground around the model's centre

// ---- the plan ----------------------------------------------------------------
// Ring streets: inner rings sit on the green ground slab and are open from the start; frontier
// rings go out onto bare regolith and open one by one as the ring inside them fills up.
export const RINGS = [
  { id: 'A', r: 540,  year: 2070, name: 'Pioneer Ring',       name_cn: '开拓者环', zone: 'commerce',  note: 'The first outpost on the Isidis Plain, April 2070.', note_cn: '2070 年 4 月，伊希地平原上的第一个前哨站。' },
  { id: 'B', r: 660,  year: 2075, name: 'Propellant Ring',    name_cn: '推进剂环', zone: 'homes',     note: 'Propellant self-sufficiency, 2075.', note_cn: '2075 年，推进剂实现自给。' },
  { id: 'C', r: 780,  year: 2080, name: 'Fission Ring',       name_cn: '裂变环',   zone: 'homes',     note: 'Nuclear power takes over, 2080.', note_cn: '2080 年，核能成为主要能源。' },
  { id: 'D', r: 900,  year: 2123, name: 'Referendum Ring',    name_cn: '公决环',   zone: 'gardens',   note: 'The city is named by public vote, 17 February 2123.', note_cn: '2123 年 2 月 17 日，全民公决为城市命名。' },
  { id: 'E', r: 1080, year: 2150, name: 'Amazonis Ring',      name_cn: '亚马逊环', zone: 'works',     note: 'The Amazonis circle of cities, 2150s.', note_cn: '2150 年代，亚马逊城市圈。', frontier: true },
  { id: 'F', r: 1240, year: 2168, name: 'Hellas Ring',        name_cn: '希腊环',   zone: 'farms',     note: 'The Hellas circle, 2168.', note_cn: '2168 年，希腊城市圈。', frontier: true },
  { id: 'G', r: 1400, year: 2200, name: 'Eleven Cities Ring', name_cn: '十一城环', zone: 'works',     note: 'Eleven cities on Mars by 2200.', note_cn: '2200 年，火星上已有十一座城市。', frontier: true },
  { id: 'H', r: 1560, year: 2219, name: 'Terraforming Ring',  name_cn: '改造环',   zone: 'farms',     note: 'Terraforming begins, 2219: the present.', note_cn: '2219 年，地球化改造开始：就是现在。', frontier: true },
];
// A frontier ring opens when the ring inside it has this share of its lots claimed.
export const OPEN_SHARE = 0.25;

// Radial avenues, named after the city each one points to (initial great-circle bearing from
// Procyon, coordinates from InterImmData/opendata/MarsCities.kmz). Atlantis (80°) sits too close
// to Kroran (84°) for its own avenue.
export const AVENUES = [
  { id: 'polar',       bearing: 0,   name: 'Polar Avenue',       name_cn: '北极大道', toward: 'the north pole', toward_cn: '北极' },
  { id: 'pompeii',     bearing: 67,  name: 'Pompeii Avenue',     name_cn: '庞贝大道', toward: 'Pompeii City, 6,421 km', toward_cn: '庞贝城，6421 公里' },
  { id: 'kroran',      bearing: 84,  name: 'Kroran Avenue',      name_cn: '楼兰大道', toward: 'Kroran City, 5,305 km', toward_cn: '楼兰城，5305 公里' },
  { id: 'betelgeuse',  bearing: 118, name: 'Betelgeuse Avenue',  name_cn: '参宿大道', toward: 'Betelgeuse City, 597 km', toward_cn: '参宿城，597 公里' },
  { id: 'sirius',      bearing: 167, name: 'Sirius Avenue',      name_cn: '天狼大道', toward: 'Sirius City, 529 km', toward_cn: '天狼城，529 公里' },
  { id: 'terminus',    bearing: 178, name: 'Terminus Avenue',    name_cn: '端点大道', toward: 'Terminus City, 3,216 km', toward_cn: '端点城，3216 公里' },
  { id: 'trantor',     bearing: 195, name: 'Trantor Avenue',     name_cn: '川陀大道', toward: 'Trantor City, 3,446 km', toward_cn: '川陀城，3446 公里' },
  { id: 'horizon',     bearing: 271, name: 'Horizon Avenue',     name_cn: '视界大道', toward: 'Horizon City, 4,331 km', toward_cn: '视界城，4331 公里' },
  { id: 'singularity', bearing: 287, name: 'Singularity Avenue', name_cn: '奇点大道', toward: 'Singularity City, 5,248 km', toward_cn: '奇点城，5248 公里' },
  { id: 'bolide',      bearing: 316, name: 'Bolide Avenue',      name_cn: '星坠大道', toward: 'Bolide City, 6,964 km', toward_cn: '星坠城，6964 公里' },
];

// What may be built in each zone. The explorer offers these and the desk enforces them.
export const ZONES = {
  commerce: { name: 'Commerce', name_cn: '商业区', types: ['shop', 'tower', 'office', 'garden', 'monument'], maxFloors: 12 },
  homes:    { name: 'Homes',    name_cn: '住宅区', types: ['vault', 'dome', 'tower', 'garden'], maxFloors: 6 },
  gardens:  { name: 'Gardens',  name_cn: '花园区', types: ['greenhouse', 'dome', 'vault', 'garden', 'monument'], maxFloors: 3 },
  works:    { name: 'Works',    name_cn: '工坊区', types: ['workshop', 'office', 'vault', 'garden'], maxFloors: 4 },
  farms:    { name: 'Farms',    name_cn: '农场区', types: ['greenhouse', 'vault', 'dome', 'garden'], maxFloors: 2 },
};

// The building kit: every building in the register is drawn from these few parameters, so
// nobody needs a 3D modelling tool (the reason the 2017 attempt stalled).
export const BUILDING = {
  types: {
    vault:      { name: 'Regolith vault', name_cn: '覆土拱屋', floors: [1, 3], note: 'Barrel vaults under a metre of regolith: the oldest way to live on Mars.', note_cn: '覆盖一米风化层的筒形拱屋，火星上最古老的居住方式。' },
    dome:       { name: 'Dome',           name_cn: '穹顶屋',   floors: [1, 3], note: 'A pressurised dome with a ring of windows.', note_cn: '带一圈舷窗的加压穹顶。' },
    tower:      { name: 'Tower',          name_cn: '塔楼',     floors: [3, 12], note: 'Stacked floors with setbacks, for homes or offices.', note_cn: '逐层退台的塔楼，住宅或办公。' },
    office:     { name: 'Office hall',    name_cn: '办公楼',   floors: [1, 6], note: 'A wide hall with bands of glass.', note_cn: '带通长玻璃带的宽体楼。' },
    shop:       { name: 'Shopfront',      name_cn: '商铺',     floors: [1, 3], note: 'A street-front shop with an awning and a big sign.', note_cn: '临街商铺，有雨棚和大招牌。' },
    greenhouse: { name: 'Greenhouse',     name_cn: '温室',     floors: [1, 2], note: 'A glass vault full of crops, glowing at night.', note_cn: '种满作物的玻璃拱棚，夜里会发光。' },
    workshop:   { name: 'Workshop',       name_cn: '工坊',     floors: [1, 4], note: 'Saw-tooth roof, a tank and a crane.', note_cn: '锯齿屋顶、储罐和吊车。' },
    garden:     { name: 'Garden',         name_cn: '花园',     floors: [1, 1], note: 'Trees, a pond and a low wall: a public garden.', note_cn: '树、池塘和矮墙：一座公共花园。' },
    monument:   { name: 'Monument',       name_cn: '纪念碑',   floors: [1, 12], note: 'An obelisk on a plinth.', note_cn: '基座上的方尖碑。' },
  },
  colors: { regolith: '#b5653f', ochre: '#c99a5b', chalk: '#e6dfd2', basalt: '#5d5751', rust: '#9a3c22', sage: '#7d8d68', sky: '#7d96ab', ink: '#2e2c2a' },
  roofs: ['flat', 'solar', 'garden', 'antenna'],
  signMax: 16,
};

const STREET = 12, AVENUE = 16, LANE = 6, GROUP = 8;          // widths (m), lots per group between lanes
const INNER = { spacing: 120, depth: 50, frontage: 28 };
const OUTER = { spacing: 160, depth: 70, frontage: 40 };

// ---- raster -----------------------------------------------------------------
function rasterise(buf) {
  const n = buf.readUInt32LE(80);
  const tri = new Float64Array(n * 9);
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) {
    const v = buf.readFloatLE(84 + t * 50 + 12 + k * 4); tri[t * 9 + k] = v;
    if (k % 3 === 0) { mnx = Math.min(mnx, v); mxx = Math.max(mxx, v); } else if (k % 3 === 1) { mny = Math.min(mny, v); mxy = Math.max(mxy, v); }
  }
  // the explorer centres the model on its bounding box: use the same frame
  const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2;
  const W = Math.ceil((mxx - mnx) / CELL) + 2, H = Math.ceil((mxy - mny) / CELL) + 2;
  const top = new Float32Array(W * H).fill(-1);
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const xs = [0, 3, 6].map(k => (tri[o + k] - mnx) / CELL), ys = [1, 4, 7].map(k => (tri[o + k] - mny) / CELL), zs = [2, 5, 8].map(k => tri[o + k]);
    const den = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2]);
    if (Math.abs(den) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
      const px = gx + 0.5, py = gy + 0.5;
      const l1 = ((ys[1] - ys[2]) * (px - xs[2]) + (xs[2] - xs[1]) * (py - ys[2])) / den;
      const l2 = ((ys[2] - ys[0]) * (px - xs[2]) + (xs[0] - xs[2]) * (py - ys[2])) / den;
      const l3 = 1 - l1 - l2;
      if (l1 < -0.01 || l2 < -0.01 || l3 < -0.01) continue;
      const z = l1 * zs[0] + l2 * zs[1] + l3 * zs[2], i = gy * W + gx;
      if (z > top[i]) top[i] = z;
    }
  }
  // sample in centred model coordinates (X east, Y north)
  const at = (X, Y) => {
    const gx = Math.floor((X + cx - mnx) / CELL), gy = Math.floor((Y + cy - mny) / CELL);
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) return NaN;   // beyond the outer ring road: not city land
    return top[gy * W + gx];
  };
  // the InterImm core: centroid of everything taller than 150 m
  let sx = 0, sy = 0, c = 0;
  for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) if (top[gy * W + gx] > 150) { sx += mnx + (gx + 0.5) * CELL - cx; sy += mny + (gy + 0.5) * CELL - cy; c++; }
  return { at, core: [sx / c, sy / c] };
}

// ---- geometry -----------------------------------------------------------------
const RAD = Math.PI / 180;
export function polar(core, r, bearingDeg) { const b = bearingDeg * RAD; return [core[0] + Math.sin(b) * r, core[1] + Math.cos(b) * r]; }

// share of 2 m samples inside an annular sector that pass `ok`
function sectorShare(at, core, r1, r2, b1, b2, ok) {
  let good = 0, all = 0;
  for (let r = r1 + 1; r < r2; r += CELL) {
    const step = (CELL / r) / RAD;
    for (let b = b1 + step / 2; b < b2; b += step) {
      const [X, Y] = polar(core, r, b);
      if (Math.hypot(X, Y) > FLAT_RADIUS - 150) return 0;
      all++; if (ok(at(X, Y))) good++;
    }
  }
  return all ? good / all : 0;
}

export function buildPlots(stlBuffer) {
  const { at, core } = rasterise(stlBuffer);
  const ground = v => v >= 0 && v < 0.6, bare = v => v < 0;  // NaN (outside the model) passes neither
  const lots = [], rings = [];
  RINGS.forEach((ring, ri) => {
    const P = ring.frontier ? OUTER : INNER;
    const sides = [
      { side: 'in',  r1: ring.r - STREET / 2 - P.depth, r2: ring.r - STREET / 2 },
      { side: 'out', r1: ring.r + STREET / 2, r2: ring.r + STREET / 2 + P.depth },
    ];
    const made = [];
    for (const s of sides) {
      const rm = (s.r1 + s.r2) / 2;
      AVENUES.forEach((av, ai) => {
        const next = AVENUES[(ai + 1) % AVENUES.length];
        const half = (AVENUE / 2) / rm / RAD;
        const a0 = av.bearing + half, a1 = (next.bearing > av.bearing ? next.bearing : next.bearing + 360) - half;
        const span = (a1 - a0) * RAD * rm;                      // metres of frontage between the two avenues
        // groups of GROUP lots separated by lanes; as many whole lots as fit, spread evenly
        let n = Math.floor((span + LANE) / P.frontage);
        while (n > 0 && n * P.frontage + Math.floor((n - 1) / GROUP) * LANE > span) n--;
        if (!n) return;
        const lanes = Math.floor((n - 1) / GROUP), f = (span - lanes * LANE) / n;
        let pos = 0;
        for (let k = 0; k < n; k++) {
          if (k && k % GROUP === 0) pos += LANE;
          const b1 = a0 + (pos / rm) / RAD, b2 = a0 + ((pos + f) / rm) / RAD;
          pos += f;
          const share = sectorShare(at, core, s.r1, s.r2, b1, b2, ring.frontier ? bare : ground);
          if (share < (ring.frontier ? 0.995 : 0.985)) continue;
          made.push({ side: s.side, r1: s.r1, r2: s.r2, b1: ((b1 % 360) + 360) % 360, b2: ((b2 % 360) + 360) % 360, seg: ai });
        }
      });
    }
    // house numbers run clockwise from Polar Avenue: odd on the inner side, even on the outer side
    for (const side of ['in', 'out']) {
      made.filter(l => l.side === side).sort((a, b) => a.b1 - b.b1).forEach((l, k) => {
        const no = side === 'in' ? 2 * k + 1 : 2 * k + 2;
        const area = Math.round(Math.PI * (l.r2 ** 2 - l.r1 ** 2) * (((l.b2 - l.b1 + 360) % 360) / 360));
        lots.push([ring.id + no, ri, side === 'in' ? 0 : 1, +l.b1.toFixed(3), +l.b2.toFixed(3), l.r1, l.r2, area, l.seg]);
      });
    }
    rings.push({ ...ring, frontier: !!ring.frontier, street: STREET, depth: P.depth, lots: made.length,
      opens: ring.frontier ? { after: RINGS[ri - 1].id, share: OPEN_SHARE } : null });
  });
  return {
    version: 1,
    city: 'isidis-procyon',
    about: 'Land register plan for Procyon City. Generated by tools/plots.mjs from the city model; do not edit by hand.',
    units: 'm',
    frame: 'Centred model coordinates: X east, Y north (three.js x = X, z = -Y). Bearings in degrees clockwise from north around the core.',
    core: core.map(v => +v.toFixed(2)),
    geo: { lat: 16.18146, lon: 84.62398, metresPerDegree: 59158 },
    widths: { street: STREET, avenue: AVENUE, lane: LANE },
    zones: ZONES,
    building: BUILDING,
    rings,
    avenues: AVENUES,
    lotFields: ['id', 'ring', 'side', 'b1', 'b2', 'r1', 'r2', 'area', 'segment'],
    lots,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const plan = buildPlots(readFileSync(STL));
  const text = JSON.stringify(plan, null, 0).replace(/\],\[/g, '],\n[') + '\n';
  if (process.argv.includes('--check')) {
    let old = ''; try { old = readFileSync(OUT, 'utf8'); } catch {}
    if (old !== text) { console.error('plots.json is out of date: run node tools/plots.mjs'); process.exit(1); }
    console.log('plots.json is up to date');
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, text);
    console.log(`${plan.lots.length} lots`, plan.rings.map(r => `${r.id}:${r.lots}`).join(' '), 'core', plan.core);
  }
}
