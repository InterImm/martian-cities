// Parametric buildings for claimed lots. A building is a handful of parameters
// ({type, floors, color, accent, roof, sign}); this file turns them into geometry, so nobody needs a
// modelling tool. All buildings in the city are merged into a few meshes (one per material),
// which keeps two thousand lots cheap to draw.
//
// Local frame for one building: x along the street frontage, z towards the street (front at +z),
// y up, origin at the lot's centre on the ground.

import * as THREE from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { hashSeed } from './land-plan.js';

const FLOOR = 3.6;               // storey height; the wall texture tile is 4 storeys (14.4 m) by 16 m
const GROUND = 0.02;             // top of the model's ground slab (z = 0 in the STL)

// ---- small geometry kit ----------------------------------------------------------
// Every piece ends up non-indexed with position, normal, color and uv, so they all merge.
function finish(g, color, uvFn) {
  if (g.index) g = g.toNonIndexed();
  const n = g.attributes.position.count, c = new Float32Array(n * 3), col = new THREE.Color(color);
  for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (uvFn) uvFn(g); else if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k)) g.deleteAttribute(k);
  return g;
}
// wall uvs in metres so windows line up with storeys whatever the building size
function wallUv(g) {
  const p = g.attributes.position, nrm = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const u = Math.abs(nrm.getX(i)) > Math.abs(nrm.getZ(i)) ? p.getZ(i) : p.getX(i);
    uv[i * 2] = u / 16; uv[i * 2 + 1] = (p.getY(i) - GROUND) / 14.4;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
// A box split into walls (window texture) and a roof cap (plain).
function block(out, w, h, d, x, y, z, color, roofColor = color, windows = true) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y + h / 2, z);
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z; 6 vertices per face after toNonIndexed
  const pos = g.attributes.position.array, nor = g.attributes.normal.array;
  const pick = faces => {
    const P = [], N = [];
    for (const f of faces) { P.push(...pos.slice(f * 18, f * 18 + 18)); N.push(...nor.slice(f * 18, f * 18 + 18)); }
    const q = new THREE.BufferGeometry();
    q.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); q.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    return q;
  };
  out[windows ? 'wall' : 'solid'].push(finish(pick([0, 1, 4, 5]), color, windows ? wallUv : null));
  out.solid.push(finish(pick([2]), roofColor));
}
function solid(out, g, color, x = 0, y = 0, z = 0, bucket = 'solid') { g.translate(x, y, z); out[bucket].push(finish(g, color)); }

// ---- roofs -----------------------------------------------------------------------
function roof(out, kind, w, d, y, x = 0, z = 0, b) {
  if (kind === 'solar') {
    const n = Math.max(1, Math.floor(w / 4));
    for (let i = 0; i < n; i++) { const g = new THREE.BoxGeometry(w / n - 0.8, 0.25, d * 0.7); g.rotateX(-0.25); solid(out, g, '#2b3a55', x - w / 2 + (i + 0.5) * w / n, y + 0.6, z); }
  } else if (kind === 'garden') {
    solid(out, new THREE.BoxGeometry(w - 1, 0.4, d - 1), '#5f7f3c', x, y + 0.2, z);
    const s = hashSeed(b?.sign || '') % 3 + 2;
    for (let i = 0; i < s; i++) solid(out, new THREE.ConeGeometry(1.2, 3, 6), '#4c6b32', x - w / 3 + i * (w / 1.5) / Math.max(1, s - 1), y + 1.9, z);
  } else if (kind === 'antenna') {
    solid(out, new THREE.CylinderGeometry(0.15, 0.2, 9, 6), '#8a8580', x + w / 4, y + 4.5, z - d / 4);
    const dish = new THREE.SphereGeometry(2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 3); dish.rotateX(-2.2);
    solid(out, dish, '#e6dfd2', x - w / 5, y + 2.4, z);
  }
}

// ---- building types -------------------------------------------------------------
const TYPES = {
  vault(out, b, W, D, C) {
    // n barrel vaults side by side, each covered with regolith; glazed fronts
    const n = Math.min(b.floors, Math.max(1, Math.floor(W / 7))), r = Math.min(W / n / 2 - 0.3, 5), len = D * 0.85;
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + (i + 0.5) * W / n;
      // half-cylinder with its axis along z and the arch up (theta pi/2..3pi/2 ends up above ground after rotateX)
      const shell = new THREE.CylinderGeometry(r + 0.6, r + 0.6, len, 18, 1, false, Math.PI / 2, Math.PI); shell.rotateX(Math.PI / 2);
      solid(out, shell, '#a8593a', x, GROUND, 0);
      const front = new THREE.CircleGeometry(r, 18, 0, Math.PI); solid(out, front, '#9fb7c9', x, GROUND, len / 2 + 0.01, 'glass');
      solid(out, new THREE.BoxGeometry(1.4, 2.2, 0.3), C.accent, x, GROUND + 1.1, len / 2 + 0.2);
    }
    solid(out, new THREE.BoxGeometry(W, 0.3, 2.5), C.body, 0, GROUND + 0.15, len / 2 + 1.6);
  },
  dome(out, b, W, D, C) {
    const r = Math.min(W, D) * 0.42, h = 0.75 + 0.25 * b.floors;
    const g = new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(1, h, 1);
    solid(out, g, C.body, 0, GROUND, 0);
    const band = new THREE.CylinderGeometry(r * 0.985, r * 0.985, 1.2, 24, 1, true); solid(out, band, '#9fb7c9', 0, GROUND + r * h * 0.32, 0, 'glass');
    solid(out, new THREE.CylinderGeometry(r * 1.03, r * 1.03, 0.8, 24), '#8d8378', 0, GROUND + 0.4, 0);
    const tunnel = new THREE.CylinderGeometry(1.6, 1.6, D / 2 - r + 1, 12, 1, false, Math.PI / 2, Math.PI); tunnel.rotateX(Math.PI / 2);
    solid(out, tunnel, C.accent, 0, GROUND, r + (D / 2 - r) / 2 - 0.5);
    roof(out, b.roof === 'antenna' ? 'antenna' : 'none', r, r, GROUND + r * h - 1, 0, 0, b);
  },
  tower(out, b, W, D, C) {
    let w = Math.min(W - 2, 26), d = Math.min(D - 8, 26), y = GROUND, left = b.floors;
    while (left > 0) {
      const f = Math.min(4, left); block(out, w, f * FLOOR, d, 0, y, 0, C.body, C.roof);
      y += f * FLOOR; left -= f;
      if (left > 0) { solid(out, new THREE.BoxGeometry(w + 0.6, 0.4, d + 0.6), C.accent, 0, y, 0); w *= 0.86; d *= 0.86; }
    }
    roof(out, b.roof, w, d, y, 0, 0, b);
    return { top: y, front: d / 2 };
  },
  office(out, b, W, D, C) {
    const w = W - 3, d = Math.min(D - 10, 34), h = b.floors * FLOOR;
    block(out, w, h, d, 0, GROUND, -2, C.body, C.roof);
    for (let i = 1; i <= b.floors; i++) solid(out, new THREE.BoxGeometry(w + 0.2, 0.9, d + 0.2), '#9fb7c9', 0, GROUND + i * FLOOR - 1.4, -2, 'glass');
    solid(out, new THREE.BoxGeometry(6, 3, 4), C.accent, 0, GROUND, d / 2);
    roof(out, b.roof, w, d, GROUND + h, 0, -2, b);
    return { top: GROUND + h, front: d / 2 - 2 };
  },
  shop(out, b, W, D, C) {
    const w = W - 2, d = Math.min(D - 6, 22), h = b.floors * FLOOR + 0.8, z = D / 2 - d / 2 - 3;
    block(out, w, h, d, 0, GROUND, z, C.body, C.roof);
    solid(out, new THREE.BoxGeometry(w - 1, 2.6, 0.2), '#9fb7c9', 0, GROUND + 1.4, z + d / 2 + 0.05, 'glass');
    const awn = new THREE.BoxGeometry(w, 0.25, 2.4); awn.rotateX(0.25); solid(out, awn, C.accent, 0, GROUND + 3.3, z + d / 2 + 1.1);
    roof(out, b.roof, w, d, GROUND + h, 0, z, b);
    return { top: GROUND + h, front: z + d / 2, signY: GROUND + h + 0.2 };
  },
  greenhouse(out, b, W, D, C) {
    const n = b.floors, r = Math.min(W / n / 2 - 0.4, 7), len = D * 0.8;
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + (i + 0.5) * W / n;
      const g = new THREE.CylinderGeometry(r, r, len, 20, 1, true, Math.PI / 2, Math.PI); g.rotateX(Math.PI / 2);
      solid(out, g, '#cfe3d4', x, GROUND, 0, 'glass');
      for (let k = -2; k <= 2; k++) solid(out, new THREE.BoxGeometry(r * 0.25, 0.9, len * 0.9), '#5f8f3a', x + k * r * 0.33, GROUND + 0.45, 0, 'plant');
      for (const e of [-1, 1]) { const ring = new THREE.TorusGeometry(r, 0.18, 6, 20, Math.PI); solid(out, ring, C.body, x, GROUND, e * len / 2); }
    }
  },
  workshop(out, b, W, D, C) {
    const w = W - 4, d = Math.min(D - 10, 36), h = 2 + b.floors * FLOOR, teeth = Math.max(2, Math.floor(w / 7));
    block(out, w, h, d, 0, GROUND, -2, C.body, C.roof);
    for (let i = 0; i < teeth; i++) {
      const s = new THREE.CylinderGeometry(3.2, 3.2, d, 3, 1); s.rotateX(Math.PI / 2); s.rotateZ(Math.PI); s.scale(w / teeth / 5.5, 0.6, 1);
      solid(out, s, C.roof, -w / 2 + (i + 0.5) * w / teeth, GROUND + h + 1.5, -2);
    }
    solid(out, new THREE.CylinderGeometry(3, 3, 7, 16), '#d8d2c6', w / 2 - 3, GROUND + 3.5, d / 2 + 2);
    solid(out, new THREE.BoxGeometry(0.6, h + 6, 0.6), C.accent, -w / 2 + 1, GROUND + (h + 6) / 2, d / 2);
    solid(out, new THREE.BoxGeometry(10, 0.6, 0.6), C.accent, -w / 2 + 5.5, GROUND + h + 6, d / 2);
    return { top: GROUND + h, front: d / 2 - 2 };
  },
  garden(out, b, W, D, C, seed) {
    // low wall with a gate, paths, a pond and trees in a pattern of the holder's own
    for (const [w, d, x, z] of [[W - 2, 0.6, 0, -D / 2 + 1], [0.6, D - 2, -W / 2 + 1, 0], [0.6, D - 2, W / 2 - 1, 0], [(W - 8) / 2, 0.6, -(W + 4) / 4, D / 2 - 1], [(W - 8) / 2, 0.6, (W + 4) / 4, D / 2 - 1]])
      solid(out, new THREE.BoxGeometry(w, 1.2, d), C.body, x, GROUND + 0.6, z);
    solid(out, new THREE.BoxGeometry(W - 3, 0.25, D - 3), '#6f8c45', 0, GROUND + 0.12, 0);
    solid(out, new THREE.BoxGeometry(3, 0.3, D - 3), '#cdbfa6', 0, GROUND + 0.15, 0);
    const pond = new THREE.CircleGeometry(Math.min(W, D) * 0.18, 20); pond.rotateX(-Math.PI / 2); solid(out, pond, '#5f86a3', -W / 4, GROUND + 0.32, -D / 6);
    let s = seed;
    const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0) / 4294967296);
    for (let i = 0; i < 9; i++) {
      const x = (rnd() - 0.5) * (W - 6), z = (rnd() - 0.5) * (D - 6);
      if (Math.abs(x) < 3) continue;
      const h = 3 + rnd() * 4;
      solid(out, new THREE.CylinderGeometry(0.2, 0.3, h * 0.4, 5), '#6b4e35', x, GROUND + h * 0.2, z);
      solid(out, new THREE.ConeGeometry(1 + rnd() * 1.5, h, 7), i % 3 ? '#4f7034' : C.accent, x, GROUND + h * 0.4 + h / 2, z, 'plant');
    }
  },
  monument(out, b, W, D, C) {
    const h = 6 + b.floors * 4;
    solid(out, new THREE.BoxGeometry(10, 1.6, 10), '#8d8378', 0, GROUND + 0.8, 0);
    solid(out, new THREE.BoxGeometry(6, 1.2, 6), C.body, 0, GROUND + 2.2, 0);
    const ob = new THREE.CylinderGeometry(0.6, 1.6, h, 4); ob.rotateY(Math.PI / 4); solid(out, ob, C.body, 0, GROUND + 2.8 + h / 2, 0);
    const tip = new THREE.ConeGeometry(0.85, 1.6, 4); tip.rotateY(Math.PI / 4); solid(out, tip, C.accent, 0, GROUND + 2.8 + h + 0.8, 0);
    for (const [x, z] of [[-W / 3, D / 4], [W / 3, D / 4], [-W / 3, -D / 4], [W / 3, -D / 4]]) solid(out, new THREE.SphereGeometry(1.2, 8, 6), '#4f7034', x, GROUND + 1.2, z, 'plant');
    return { top: GROUND + 2.8 + h, front: 5 };
  },
};

// geometry for one building, in its lot's local frame, sorted by material bucket
export function buildingParts(b, lotW, lotD, colors, seed = 1) {
  const out = { wall: [], solid: [], glass: [], plant: [] };
  const W = Math.max(8, lotW - 6), D = Math.max(10, lotD - 10);  // setbacks: 3 m sides, 6 m front, 4 m back
  const body = colors[b.color] || '#e6dfd2', accent = colors[b.accent] || '#9a3c22';
  const C = { body, accent, roof: new THREE.Color(body).multiplyScalar(0.82).getStyle() };
  const info = TYPES[b.type](out, b, W, D, C, seed) || {};
  // a paved forecourt to the street on every lot
  solid(out, new THREE.BoxGeometry(Math.min(W, 10), 0.12, lotD / 2 - D / 2 + 1), '#cdbfa6', 0, GROUND + 0.06, D / 2 + (lotD / 2 - D / 2) / 2);
  return { parts: out, info: { top: info.top ?? GROUND + 6, front: info.front ?? D / 2, signY: info.signY } };
}

// ---- materials and the merged city layer ------------------------------------------
export function makeMaterials(wallTex, wallGlow) {
  return {
    wall: new THREE.MeshStandardMaterial({ vertexColors: true, map: wallTex, emissiveMap: wallGlow, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.85, metalness: 0.05 }),
    solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.05, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.55, side: THREE.DoubleSide, emissive: 0x334433, emissiveIntensity: 0, depthWrite: false }),
    plant: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, emissive: 0x9cff7a, emissiveIntensity: 0 }),
  };
}

// items: [{ frame: {x, z, yaw, w, d}, building, seed }]. Returns a Group with one mesh per material.
export function buildLayer(items, mats, colors) {
  const buckets = { wall: [], solid: [], glass: [], plant: [] };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(1, 1, 1);
  const tops = [];
  for (const it of items) {
    const { parts, info } = buildingParts(it.building, it.frame.w, it.frame.d, colors, it.seed);
    // frontier lots sit on bare regolith below the city's ground slab: give them a foundation pad
    if (it.pad) solid(parts, new THREE.BoxGeometry(it.frame.w - 2, 0.5, it.frame.d - 2), '#b9a58c', 0, GROUND - 0.25, 0);
    m.compose(new THREE.Vector3(it.frame.x, 0, it.frame.z), q.setFromAxisAngle(up, it.frame.yaw), s);
    for (const k of Object.keys(parts)) for (const g of parts[k]) { g.applyMatrix4(m); buckets[k].push(g); }
    tops.push({ id: it.id, top: info.top, front: info.front, signY: info.signY });
  }
  const group = new THREE.Group();
  for (const k of Object.keys(buckets)) {
    if (!buckets[k].length) continue;
    const g = mergeGeometries(buckets[k], false);
    for (const p of buckets[k]) p.dispose();
    const mesh = new THREE.Mesh(g, mats[k]);
    mesh.castShadow = k !== 'glass'; mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.tops = tops;
  return group;
}

// A sign board with the holder's text, facing the street. Canvas texture, drawn once.
export function signMesh(text, accent, frame, info) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f6f1e7'; g.fillRect(0, 0, 512, 128);
  g.fillStyle = accent; g.fillRect(0, 0, 512, 10); g.fillRect(0, 118, 512, 10);
  g.fillStyle = '#1d1b19'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = 64; g.font = `600 ${size}px "Noto Serif SC","Source Serif 4",serif`;
  while (g.measureText(text).width > 480 && size > 24) { size -= 4; g.font = `600 ${size}px "Noto Serif SC","Source Serif 4",serif`; }
  g.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const w = Math.min(frame.w - 6, 14), mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  const y = info.signY ?? Math.min(info.top + 1.8, GROUND + 9);
  const local = new THREE.Vector3(0, y + w / 8, info.front + 0.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), frame.yaw);
  mesh.position.set(frame.x + local.x, local.y, frame.z + local.z);
  mesh.rotation.y = frame.yaw;
  return mesh;
}
