import * as THREE from 'three';
import { STLLoader } from '../vendor/STLLoader.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { PointerLockControls } from '../vendor/PointerLockControls.js';
import { sunPosition, budget, fmt, DEFAULTS } from './sim.js';

const GROUND_Y = -0.4;            // flat zone sits just below the model's ground slabs
const TERRAIN_SIZE = 16000;
const MARS_G = 3.71;
const $ = id => document.getElementById(id);

// ---- renderer / scene -------------------------------------------------------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 2, 60000);
const sun = new THREE.DirectionalLight(0xffe2c4, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera; sc.left = -2600; sc.right = 2600; sc.top = 2600; sc.bottom = -2600; sc.near = 100; sc.far = 9000;
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xf0b894, 0x8a5a40, 0.6);
scene.add(hemi);

const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true; orbit.maxPolarAngle = Math.PI * 0.495; orbit.minDistance = 20; orbit.maxDistance = 20000;
const walk = new PointerLockControls(camera, document.body);
let mode = 'orbit';

// ---- current city -----------------------------------------------------------
let cities = [], cfg = null, terrainMesh = null, cityGroup = null, loadToken = 0;

// Terrain is procedural and illustrative: noise seeded from the city id, flattened around the city.
function hash(ix, iz) { let h = ix * 374761393 + iz * 668265263; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
let seed = [31, 17];
function seedFrom(id) { let h = 7; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0; return [31 + (h & 255), 17 + ((h >> 8) & 255)]; }
function rawHeight(x, z) {
  let h = 0, amp = 60, f = 1 / 2500;
  for (let o = 0; o < 5; o++) { h += (vnoise(x * f + seed[0], z * f + seed[1]) - 0.5) * amp; amp *= 0.5; f *= 2.1; }
  return h;
}
function heightAt(x, z) {
  const t = cfg ? THREE.MathUtils.smoothstep(Math.hypot(x, z), cfg.terrain.flatRadius, cfg.terrain.blendRadius) : 0;
  return GROUND_Y + (rawHeight(x, z) - rawHeight(0, 0)) * t;
}
function buildTerrain() {
  if (terrainMesh) { scene.remove(terrainMesh); terrainMesh.geometry.dispose(); terrainMesh.material.dispose(); }
  const seg = 320;
  const g = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = heightAt(x, z);
    pos.setY(i, y);
    const n = vnoise(x / 90, z / 90) * 0.12;
    col[i * 3] = 0.66 + n - y * 0.0008; col[i * 3 + 1] = 0.37 + n * 0.7 - y * 0.0006; col[i * 3 + 2] = 0.24 + n * 0.5;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  terrainMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);
}

// ---- model loading ----------------------------------------------------------
// The STL carries no colours, so tint by height and facing: roofs and slabs light, walls darker, tall stuff sandstone.
function tintStl(geo) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), up = Math.abs(nor.getY(i));
    if (y < 0.5 && up > 0.9) c.set(0x5f7f3c);
    else if (up > 0.9) c.set(y > 25 ? 0xb99a6b : 0xcfc7bd);
    else c.set(y > 25 ? 0x9a7f58 : 0xa9a39b);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
const asUrl = f => new URL('../' + f, import.meta.url).href;
function loadObject(spec) {
  const scale = spec.scale ?? 1, up = spec.upAxis ?? 'y', ground = (spec.groundLevel ?? 0) * scale;
  const fmtName = (spec.format || spec.file.split('.').pop()).toLowerCase();
  return new Promise((resolve, reject) => {
    if (fmtName === 'stl') {
      new STLLoader().load(asUrl(spec.file), geo => {
        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        // centre on the bounding box horizontally; model ground goes to y = 0
        if (up === 'z') geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(spec.groundLevel ?? 0));
        else geo.translate(-(bb.min.x + bb.max.x) / 2, -(spec.groundLevel ?? 0), -(bb.min.z + bb.max.z) / 2);
        if (up === 'z') geo.rotateX(-Math.PI / 2);
        geo.scale(scale, scale, scale);
        geo.computeVertexNormals();
        tintStl(geo);
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.05, side: THREE.DoubleSide }));
        m.castShadow = m.receiveShadow = true;
        resolve(m);
      }, undefined, reject);
    } else if (fmtName === 'glb' || fmtName === 'gltf') {
      new GLTFLoader().load(asUrl(spec.file), gltf => {
        const inner = gltf.scene, wrap = new THREE.Group();
        wrap.add(inner);
        if (up === 'z') inner.rotation.x = -Math.PI / 2;
        wrap.scale.setScalar(scale);
        wrap.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(wrap);
        wrap.position.set(-(bb.min.x + bb.max.x) / 2, -ground, -(bb.min.z + bb.max.z) / 2);
        wrap.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
        resolve(wrap);
      }, undefined, reject);
    } else reject(new Error('Unsupported model format: ' + fmtName));
  });
}

async function showCity(id) {
  const next = cities.find(c => c.id === id) || cities[0];
  const token = ++loadToken;
  cfg = next; seed = seedFrom(cfg.id);
  const en = $('enter'); en.disabled = true; en.textContent = 'Loading city model…';
  $('brand-name').textContent = cfg.name; $('intro-title').textContent = cfg.name;
  $('intro-region').textContent = 'InterImm · ' + cfg.region + ', Mars';
  $('intro-text').textContent = cfg.intro;
  document.title = cfg.name + ' | InterImm';
  if ($('city').value !== cfg.id) $('city').value = cfg.id;
  history.replaceState(null, '', '#city=' + cfg.id);
  if (mode === 'walk') setMode('orbit');
  buildTerrain();
  if (cityGroup) { scene.remove(cityGroup); cityGroup.traverse(o => { o.geometry?.dispose(); }); cityGroup = null; }
  try {
    const group = new THREE.Group();
    group.add(await loadObject(cfg.model));
    for (const ex of cfg.extras || []) { const o = await loadObject(ex); o.position.x += ex.position?.[0] ?? 0; o.position.z += ex.position?.[1] ?? 0; group.add(o); }
    if (token !== loadToken) return;          // another city was picked meanwhile
    cityGroup = group; scene.add(group);
    camera.position.set(...cfg.camera.orbit); orbit.target.set(...cfg.camera.target); camera.lookAt(orbit.target);
    $('pop').value = cfg.population ?? 1000;
    updateSun(); updateBudget();
    en.disabled = false; en.textContent = 'Enter the city';
  } catch (err) { if (token === loadToken) en.textContent = 'Could not load the city model: ' + err.message; }
}

// ---- sun / sky --------------------------------------------------------------
const skyDay = new THREE.Color(0xd9a07a), skyDusk = new THREE.Color(0x6d5a73), skyNight = new THREE.Color(0x0b0a12);
function updateSun() {
  const hour = +$('hour').value, ls = +$('ls').value;
  const { el, az } = sunPosition(hour, ls, cfg?.lat ?? 12.9);
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  sun.position.copy(dir).multiplyScalar(6000);
  sun.target.position.set(0, 0, 0);
  const up = Math.max(0, Math.sin(el));
  sun.intensity = 3.2 * Math.min(1, up * 4);
  hemi.intensity = 0.08 + 1.0 * Math.min(1, Math.max(0, (Math.sin(el) + 0.15) * 3));
  const k = THREE.MathUtils.clamp((Math.sin(el) + 0.1) / 0.45, 0, 1);
  const sky = skyNight.clone().lerp(skyDusk, Math.min(1, k * 2)).lerp(skyDay, Math.max(0, k * 2 - 1));
  scene.background = sky; scene.fog = new THREE.Fog(sky, 5000, 26000);
  $('o-hour').textContent = hour.toFixed(1) + ' h';
  $('o-ls').textContent = 'Ls ' + ls + '°';
  $('sun-readout').textContent = `Sun ${(el * 180 / Math.PI).toFixed(0)}° above the horizon at ${(cfg?.lat ?? 12.9).toFixed(1)}°N` + (el < 0 ? ' (night)' : '');
}
$('hour').addEventListener('input', updateSun); $('ls').addEventListener('input', updateSun);

// ---- walk mode --------------------------------------------------------------
const keys = new Set(); const vel = new THREE.Vector3(); let onGround = true;
addEventListener('keydown', e => keys.add(e.code)); addEventListener('keyup', e => keys.delete(e.code));
const ray = new THREE.Raycaster(); const down = new THREE.Vector3(0, -1, 0);
function floorAt(x, z) {
  let y = heightAt(x, z);
  if (cityGroup) { ray.set(new THREE.Vector3(x, camera.position.y + 3, z), down); ray.far = 500; const h = ray.intersectObject(cityGroup, true)[0]; if (h && h.point.y > y) y = h.point.y; }
  return y;
}
function setMode(m) {
  mode = m;
  $('btn-orbit').classList.toggle('on', m === 'orbit'); $('btn-walk').classList.toggle('on', m === 'walk');
  $('walk-help').hidden = m !== 'walk';
  orbit.enabled = m === 'orbit';
  if (m === 'walk') {
    const [wx, wz] = cfg.camera.walkStart;
    camera.position.set(wx, 0, wz); camera.position.y = floorAt(wx, wz) + 1.7; camera.lookAt(...cfg.camera.target);
    vel.set(0, 0, 0); walk.lock();
  } else {
    if (walk.isLocked) walk.unlock();
    camera.position.set(...cfg.camera.orbit); orbit.target.set(...cfg.camera.target); camera.lookAt(orbit.target);
  }
}
$('btn-orbit').onclick = () => setMode('orbit'); $('btn-walk').onclick = () => setMode('walk');
canvas.addEventListener('click', () => { if (mode === 'walk' && !walk.isLocked) walk.lock(); });

// ---- budget panel -----------------------------------------------------------
const assume = { ...Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) => [k, d.v])) };
function tile(k, v, unit, sub = '', cls = '') { return `<div class="tile ${cls}"><div class="k">${k}</div><div class="v">${v}<small>${unit}</small></div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`; }
function updateBudget() {
  const pop = +$('pop').value; $('o-pop').textContent = pop.toLocaleString();
  const b = budget(pop, assume);
  $('budget').innerHTML =
    tile('Power demand', fmt(b.powerMWhDay), 'MWh/day', 'about ' + fmt(b.reactorKWe / 1000) + ' MWe from a reactor') +
    tile('Solar array', fmt(b.panelKm2 >= 0.1 ? b.panelKm2 : b.panelM2), b.panelKm2 >= 0.1 ? 'km²' : 'm²', 'if solar-only') +
    tile('Dust-storm storage', fmt(b.stormStorageMWh), 'MWh', 'needed for a solar-only city; a reactor avoids it', 'wide warn') +
    tile('Oxygen', fmt(b.o2KgDay), 'kg/day') +
    tile('Water make-up', fmt(b.waterMakeupLDay), 'L/day') +
    tile('Farm area', fmt(b.farmM2), 'm²') +
    tile('Pressurised volume', fmt(b.habM3), 'm³');
}
$('pop').addEventListener('input', updateBudget);
$('assume').innerHTML = Object.entries(DEFAULTS).map(([k, d]) => `<label>${d.label}<input type="number" step="any" data-k="${k}" value="${d.v}"></label>`).join('');
$('assume').addEventListener('input', e => { const v = parseFloat(e.target.value); if (e.target.dataset.k && v >= 0) { assume[e.target.dataset.k] = v; updateBudget(); } });

// ---- intro ------------------------------------------------------------------
$('enter').addEventListener('click', () => $('intro').classList.add('gone'));
$('btn-info').addEventListener('click', () => $('intro').classList.remove('gone'));
addEventListener('keydown', e => { if (e.code === 'Escape') $('intro').classList.add('gone'); });
$('city').addEventListener('change', e => { $('intro').classList.remove('gone'); showCity(e.target.value); });

// ---- loop -------------------------------------------------------------------
const stage = $('explorer');
function resize() { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); new ResizeObserver(resize).observe(stage); resize();
$('year').textContent = new Date().getFullYear();
let last = performance.now();
renderer.setAnimationLoop(now => {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (mode === 'walk' && walk.isLocked) {
    const run = keys.has('ShiftLeft') ? 3 : 1, speed = 4 * run;
    const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    walk.moveForward(f * speed * dt); walk.moveRight(s * speed * dt);
    const fl = floorAt(camera.position.x, camera.position.z) + 1.7;
    vel.y -= MARS_G * dt;
    if (keys.has('Space') && onGround) { vel.y = 4.2; onGround = false; }
    camera.position.y += vel.y * dt;
    if (camera.position.y <= fl) { camera.position.y = fl; vel.y = 0; onGround = true; } else if (camera.position.y > fl + 0.05) onGround = false;
  } else if (mode === 'orbit') orbit.update();
  renderer.render(scene, camera);
});
walk.addEventListener('unlock', () => { if (mode === 'walk') setMode('orbit'); });
window.__mars = { camera, scene, setMode, showCity, get city() { return cityGroup; }, get cfg() { return cfg; }, heightAt };

// ---- boot -------------------------------------------------------------------
(async () => {
  try {
    const res = await fetch(new URL('../cities/cities.json', import.meta.url));
    cities = (await res.json()).cities;
    const sel = $('city');
    sel.innerHTML = cities.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    sel.hidden = cities.length < 2;
    const want = /city=([\w-]+)/.exec(location.hash)?.[1];
    await showCity(want);
  } catch (err) { $('enter').textContent = 'Could not load the city list: ' + err.message; }
})();
