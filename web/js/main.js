import * as THREE from 'three';
import { STLLoader } from '../vendor/STLLoader.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { PointerLockControls } from '../vendor/PointerLockControls.js';
import { sunPosition, budget, fmt, DEFAULTS } from './sim.js';

const MODEL_SCALE = 1;            // assumption: STL units are metres
const GROUND_Y = -0.4;            // flat zone sits just below the model's z=0 ground slabs
const TERRAIN_SIZE = 16000;
const FLAT_R = 2300, BLEND_R = 3400;
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

// ---- terrain (illustrative) -------------------------------------------------
function hash(ix, iz) { let h = ix * 374761393 + iz * 668265263; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
function rawHeight(x, z) {
  let h = 0, amp = 60, f = 1 / 2500;
  for (let o = 0; o < 5; o++) { h += (vnoise(x * f + 31, z * f + 17) - 0.5) * amp; amp *= 0.5; f *= 2.1; }
  return h;
}
function heightAt(x, z) {
  const r = Math.hypot(x, z);
  const t = THREE.MathUtils.smoothstep(r, FLAT_R, BLEND_R);
  return GROUND_Y + (rawHeight(x, z) - rawHeight(0, 0)) * t;
}
{
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
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  m.receiveShadow = true;
  scene.add(m);
}

// ---- city -------------------------------------------------------------------
let city = null;
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true; orbit.maxPolarAngle = Math.PI * 0.495; orbit.minDistance = 20; orbit.maxDistance = 20000;
const walk = new PointerLockControls(camera, document.body);
let mode = 'orbit';

new STLLoader().load('assets/isidis-city-procyon.stl', geo => {
  geo.computeBoundingBox();
  const bb = geo.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2;
  geo.translate(-cx, -cy, 0);
  geo.rotateX(-Math.PI / 2);               // STL is z-up, scene is y-up
  geo.scale(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
  geo.computeVertexNormals();
  // The STL carries no colours, so tint by height and facing: roofs and slabs light, walls darker, tall stuff sandstone.
  const pos = geo.attributes.position, nor = geo.attributes.normal, col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), up = Math.abs(nor.getY(i));
    if (y < 0.5 && up > 0.9) c.set(0x5f7f3c);            // ground-level slabs: planted ground
    else if (up > 0.9) c.set(y > 25 ? 0xb99a6b : 0xcfc7bd); // roofs and terraces
    else c.set(y > 25 ? 0x9a7f58 : 0xa9a39b);              // walls
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  city = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.05, side: THREE.DoubleSide }));
  city.castShadow = true; city.receiveShadow = true;
  scene.add(city);
  camera.position.set(0, 1500, 3200);
  orbit.target.set(0, 60, 0);
  const en = $('enter'); en.disabled = false; en.textContent = 'Enter the city';
}, undefined, err => { $('enter').textContent = 'Could not load the city model: ' + err.message; });

// ---- sun / sky --------------------------------------------------------------
const skyDay = new THREE.Color(0xd9a07a), skyDusk = new THREE.Color(0x6d5a73), skyNight = new THREE.Color(0x0b0a12);
function updateSun() {
  const hour = +$('hour').value, ls = +$('ls').value;
  const { el, az } = sunPosition(hour, ls);
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
  $('sun-readout').textContent = `Sun ${(el * 180 / Math.PI).toFixed(0)}° above the horizon at 12.9°N` + (el < 0 ? ' (night)' : '');
}
$('hour').addEventListener('input', updateSun); $('ls').addEventListener('input', updateSun);

// ---- walk mode --------------------------------------------------------------
const keys = new Set(); const vel = new THREE.Vector3(); let onGround = true;
addEventListener('keydown', e => keys.add(e.code)); addEventListener('keyup', e => keys.delete(e.code));
const ray = new THREE.Raycaster(); const down = new THREE.Vector3(0, -1, 0);
function floorAt(x, z) {
  let y = heightAt(x, z);
  if (city) { ray.set(new THREE.Vector3(x, camera.position.y + 3, z), down); ray.far = 500; const h = ray.intersectObject(city)[0]; if (h && h.point.y > y) y = h.point.y; }
  return y;
}
function setMode(m) {
  mode = m;
  $('btn-orbit').classList.toggle('on', m === 'orbit'); $('btn-walk').classList.toggle('on', m === 'walk');
  $('walk-help').hidden = m !== 'walk';
  orbit.enabled = m === 'orbit';
  if (m === 'walk') {
    camera.position.set(0, 0, 950); camera.position.y = floorAt(0, 950) + 1.7; camera.lookAt(0, 60, 0);
    vel.set(0, 0, 0); walk.lock();
  } else {
    if (walk.isLocked) walk.unlock();
    camera.position.set(0, 1500, 3200); orbit.target.set(0, 60, 0); camera.lookAt(orbit.target);
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

// ---- intro --------------------------------------------------------------
$('enter').addEventListener('click', () => $('intro').classList.add('gone'));
$('btn-info').addEventListener('click', () => $('intro').classList.remove('gone'));
addEventListener('keydown', e => { if (e.code === 'Escape') $('intro').classList.add('gone'); });

// ---- loop -------------------------------------------------------------------
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize(); updateSun(); updateBudget();
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
window.__mars = { camera, scene, setMode, get city() { return city; }, heightAt };
