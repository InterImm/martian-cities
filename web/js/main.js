import * as THREE from 'three';
import { STLLoader } from '../vendor/STLLoader.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { PointerLockControls } from '../vendor/PointerLockControls.js';
import { sunPosition, budget, fmt, DEFAULTS, MARS } from './sim.js';
import { marsState } from './marstime.js';

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
const hemi = new THREE.HemisphereLight(0xf5c9a8, 0xb07a5a, 0.6);
scene.add(hemi);

const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true; orbit.maxPolarAngle = Math.PI * 0.495; orbit.minDistance = 20; orbit.maxDistance = 9000;
const walk = new PointerLockControls(camera, document.body);
let mode = 'orbit';
const isTouch = matchMedia('(pointer: coarse)').matches;
let touchWalk = false, yaw = 0, pitch = 0;
const joyVec = { x: 0, y: 0 };
const stage0 = document.getElementById('explorer');
if (isTouch) stage0.classList.add('touch');

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
  buildRocks();
}


// ---- procedural textures (no image downloads) ------------------------------
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
function speckle(g, w, h, n, base, spread, size) {
  for (let i = 0; i < n; i++) { const v = base + (Math.random() - 0.5) * spread, s = 1 + Math.random() * size; g.fillStyle = `rgba(${v},${v},${v},${0.25 + Math.random() * 0.5})`; g.fillRect(Math.random() * w, Math.random() * h, s, s); }
}
const groundTex = canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#e4e4e4'; g.fillRect(0, 0, w, h); speckle(g, w, h, 9000, 200, 90, 3); speckle(g, w, h, 500, 170, 70, 9); });
groundTex.repeat.set(TERRAIN_SIZE / 30, TERRAIN_SIZE / 30);
const grassTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#e9e9e9'; g.fillRect(0, 0, w, h); speckle(g, w, h, 6000, 215, 70, 2); });
const roofTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#e2ddd5'; g.fillRect(0, 0, w, h); speckle(g, w, h, 3000, 210, 40, 3);
  g.strokeStyle = 'rgba(70,64,58,.55)'; g.lineWidth = 2; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke(); }
});
// wall tile covers 16 m x 14.4 m: 4 floors of 4 windows. Emissive twin has random lit windows for night.
const WIN = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) WIN.push([c * 128 + 28, r * 128 + 40, 72, 44, Math.random() < 0.4]);
const wallTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#e8e3dc'; g.fillRect(0, 0, w, h); speckle(g, w, h, 5000, 205, 50, 3);
  g.fillStyle = 'rgba(80,72,64,.35)'; for (let r = 0; r < 4; r++) g.fillRect(0, r * 128 + 120, w, 4);
  for (const [x, y, ww, hh] of WIN) { const gr = g.createLinearGradient(0, y, 0, y + hh); gr.addColorStop(0, '#8fa0b8'); gr.addColorStop(1, '#46536a'); g.fillStyle = gr; g.fillRect(x, y, ww, hh); g.strokeStyle = '#4a4540'; g.lineWidth = 3; g.strokeRect(x, y, ww, hh); }
});
const wallGlow = canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); for (const [x, y, ww, hh, lit] of WIN) if (lit) { g.fillStyle = Math.random() < 0.5 ? '#ffd9a0' : '#fff1d0'; g.fillRect(x + 3, y + 3, ww - 6, hh - 6); } });
const streakTex = canvasTex(64, 256, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); for (let i = 0; i < 160; i++) { const v = 90 + Math.random() * 165; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 8 + Math.random() * 40); } }, false);
const wallMats = [];

// ---- sky dome, stars, Phobos, dust devils -----------------------------------
const skyGroup = new THREE.Group(); scene.add(skyGroup);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { sunDir: { value: new THREE.Vector3(0, 1, 0) }, horizon: { value: new THREE.Color() }, zenith: { value: new THREE.Color() }, glowCol: { value: new THREE.Color() }, glowAmt: { value: 1 } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `varying vec3 vDir; uniform vec3 sunDir, horizon, zenith, glowCol; uniform float glowAmt;
    void main(){ vec3 d = normalize(vDir); float h = clamp(d.y, 0.0, 1.0);
      vec3 col = d.y < 0.0 ? horizon : mix(horizon, zenith, pow(h, 0.45));
      float mu = max(dot(d, sunDir), 0.0);
      col += glowCol * glowAmt * (pow(mu, 6.0) * 0.35 + pow(mu, 60.0) * 0.6);
      float disc = smoothstep(0.99980, 0.99987, mu) * glowAmt * step(-0.02, sunDir.y);
      col = mix(col, vec3(2.0, 1.9, 1.75), disc);
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`,
});
const dome = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 16), skyMat); dome.renderOrder = -2; skyGroup.add(dome);
const starPos = new Float32Array(2400 * 3);
for (let i = 0; i < 2400; i++) { const u = Math.random() * 2 - 1, a = Math.random() * 6.2832, r = Math.sqrt(1 - u * u); starPos.set([28000 * r * Math.cos(a), 28000 * Math.abs(u), 28000 * r * Math.sin(a)], i * 3); }
const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
stars.renderOrder = -1; skyGroup.add(stars);
const phobos = new THREE.Mesh(new THREE.SphereGeometry(220, 16, 12), new THREE.MeshBasicMaterial({ color: 0x9a948c, fog: false })); phobos.renderOrder = -1; skyGroup.add(phobos);

const devils = [];
for (let i = 0; i < 4; i++) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(30 + i * 6, 5, 190 + i * 40, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xc89c78, transparent: true, opacity: 0.35, alphaMap: streakTex, side: THREE.DoubleSide, depthWrite: false }));
  m.userData = { a: Math.random() * 6.28, r: 3600 + Math.random() * 2600, w: (Math.random() - 0.5) * 0.02, i };
  devils.push(m); scene.add(m);
}
let rocksMesh = null;
function buildRocks() {
  if (rocksMesh) { scene.remove(rocksMesh); rocksMesh.geometry.dispose(); rocksMesh.material.dispose(); }
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 0.7 + vnoise(p.getX(i) * 3 + 9, p.getZ(i) * 3 + p.getY(i) * 2) * 0.6; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k); }
  g.computeVertexNormals();
  const N = 7000, m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ roughness: 1, color: 0xffffff }), N);
  const o = new THREE.Object3D(), col = new THREE.Color(), r0 = cfg.terrain.flatRadius + 150;
  for (let i = 0; i < N; i++) {
    const a = Math.random() * 6.2832, r = r0 + Math.pow(Math.random(), 1.6) * (TERRAIN_SIZE / 2 - r0), x = Math.cos(a) * r, z = Math.sin(a) * r;
    const s = 0.25 + Math.pow(Math.random(), 3) * 3.2;
    o.position.set(x, heightAt(x, z) + s * 0.2, z); o.rotation.set(Math.random(), Math.random() * 6.28, Math.random()); o.scale.set(s * (0.8 + Math.random() * 0.6), s, s * (0.8 + Math.random() * 0.6)); o.updateMatrix();
    m.setMatrixAt(i, o.matrix); const v = 0.28 + Math.random() * 0.2; col.setRGB(v * 1.15, v * 0.8, v * 0.62); m.setColorAt(i, col);
  }
  m.receiveShadow = true; rocksMesh = m; scene.add(m);
}

// ---- model loading ----------------------------------------------------------
// The STL carries no colours or UVs: classify triangles (ground slab / roof / wall), tint them and box-project UVs
// so each class can use its own procedural texture.
function splitStl(geo) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, n = pos.count / 3;
  const parts = { grass: [], roof: [], wall: [] }, c = new THREE.Color();
  for (let t = 0; t < n; t++) {
    const i = t * 3, y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3, up = Math.abs(nor.getY(i));
    (up > 0.9 ? (y < 0.5 ? parts.grass : parts.roof) : parts.wall).push(t);
  }
  const make = (tris, kind, mat) => {
    const P = new Float32Array(tris.length * 9), N = new Float32Array(tris.length * 9), C = new Float32Array(tris.length * 9), U = new Float32Array(tris.length * 6);
    tris.forEach((t, k) => {
      for (let v = 0; v < 3; v++) {
        const i = t * 3 + v, x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), nx = nor.getX(i), nz = nor.getZ(i), j = k * 3 + v;
        P.set([x, y, z], j * 3); N.set([nor.getX(i), nor.getY(i), nor.getZ(i)], j * 3);
        if (kind === 'grass') { c.set(0x5f7f3c); U.set([x / 12, z / 12], j * 2); }
        else if (kind === 'roof') { c.set(y > 25 ? 0xb99a6b : 0xcfc7bd); U.set([x / 5, z / 5], j * 2); }
        else { c.set(y > 25 ? 0xd2b384 : 0xdad4ca); U.set([(Math.abs(nx) > Math.abs(nz) ? z : x) / 16, y / 14.4], j * 2); }
        C.set([c.r, c.g, c.b], j * 3);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return m;
  };
  const wall = new THREE.MeshStandardMaterial({ vertexColors: true, map: wallTex, emissiveMap: wallGlow, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide });
  wallMats.push(wall);
  const grp = new THREE.Group();
  grp.add(make(parts.grass, 'grass', new THREE.MeshStandardMaterial({ vertexColors: true, map: grassTex, roughness: 1, side: THREE.DoubleSide })),
          make(parts.roof, 'roof', new THREE.MeshStandardMaterial({ vertexColors: true, map: roofTex, roughness: 0.7, metalness: 0.15, side: THREE.DoubleSide })),
          make(parts.wall, 'wall', wall));
  return grp;
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
        resolve(splitStl(geo));
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
  if (cityGroup) { scene.remove(cityGroup); cityGroup.traverse(o => { o.geometry?.dispose(); }); wallMats.length = 0; cityGroup = null; }
  try {
    const group = new THREE.Group();
    group.add(await loadObject(cfg.model));
    for (const ex of cfg.extras || []) { const o = await loadObject(ex); o.position.x += ex.position?.[0] ?? 0; o.position.z += ex.position?.[1] ?? 0; group.add(o); }
    if (token !== loadToken) return;          // another city was picked meanwhile
    cityGroup = group; scene.add(group);
    camera.position.set(...cfg.camera.orbit); orbit.target.set(...cfg.camera.target); camera.lookAt(orbit.target);
    $('pop').value = cfg.population ?? 1000;
    live ? applyLive() : updateSun(); updateBudget();
    en.disabled = false; en.textContent = 'Enter the city';
  } catch (err) { if (token === loadToken) en.textContent = 'Could not load the city model: ' + err.message; }
}

// ---- sun / sky --------------------------------------------------------------
const skyDay = new THREE.Color(0xd9a07a), skyDusk = new THREE.Color(0x6d5a73), skyNight = new THREE.Color(0x0b0a12);
const zenDay = new THREE.Color(0x9c6a52), glowWarm = new THREE.Color(1, 0.72, 0.45), glowBlue = new THREE.Color(0.35, 0.55, 1);
const sunDirV = new THREE.Vector3();
function placePhobos(hour) {
  const p = ((hour / 24) * 3.2) % 1, el = Math.sin(p * Math.PI) * 1.2, az = (270 - 180 * p) * Math.PI / 180;
  phobos.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(25000);
  phobos.visible = el > 0.03;
}
function updateSun() {
  const hour = +$('hour').value, ls = +$('ls').value;
  const { el, az } = sunPosition(hour, ls, cfg?.lat ?? 12.9);
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  sun.position.copy(dir).multiplyScalar(6000);
  sun.target.position.set(0, 0, 0);
  const up = Math.max(0, Math.sin(el));
  sun.intensity = 3.2 * Math.min(1, up * 4);
  hemi.intensity = 0.08 + 1.7 * Math.min(1, Math.max(0, (Math.sin(el) + 0.15) * 3));
  const k = THREE.MathUtils.clamp((Math.sin(el) + 0.1) / 0.45, 0, 1);
  const sky = skyNight.clone().lerp(skyDusk, Math.min(1, k * 2)).lerp(skyDay, Math.max(0, k * 2 - 1));
  scene.background = sky; scene.fog = new THREE.Fog(sky, 5000, 11000);
  // sky dome: Mars sunsets glow blue around the Sun, daytime sky is butterscotch
  const s = Math.sin(el), low = 1 - THREE.MathUtils.clamp(s / 0.35, 0, 1);
  skyMat.uniforms.sunDir.value.copy(dir);
  skyMat.uniforms.horizon.value.copy(sky);
  skyMat.uniforms.zenith.value.copy(skyNight).lerp(zenDay, k * 0.9);
  skyMat.uniforms.glowCol.value.copy(glowWarm).lerp(glowBlue, low);
  skyMat.uniforms.glowAmt.value = THREE.MathUtils.clamp((s + 0.08) * 5, 0, 1);
  const night = 1 - THREE.MathUtils.clamp((s + 0.12) / 0.22, 0, 1);
  stars.material.opacity = night;
  for (const m of wallMats) m.emissiveIntensity = night * 1.1;
  placePhobos(hour);
  $('o-hour').textContent = hour.toFixed(1) + ' h';
  $('o-ls').textContent = 'Ls ' + ls + '°';
  $('sun-readout').textContent = `Sun ${(el * 180 / Math.PI).toFixed(0)}° above the horizon at ${(cfg?.lat ?? 12.9).toFixed(1)}°N` + (el < 0 ? ' (night)' : '') + (liveInfo ? ` · local solar time ${hm(liveInfo.ltst)} · Ls ${liveInfo.ls.toFixed(1)}° · sol ${Math.floor(liveInfo.msd).toLocaleString()}` : '');
}
// Live mode: drive the sliders from the real clock at the city's longitude. Touching a slider switches it off.
let live = true, liveInfo = null;
const hm = h => { const t = Math.round(h * 60) % 1440; return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
function applyLive() {
  if (!live || !cfg) return;
  const st = marsState(new Date(), cfg.lon ?? 0);
  liveInfo = st;
  $('hour').value = st.ltst / 24 * MARS.solHours; $('ls').value = st.ls.toFixed(1);
  updateSun();
}
function setLive(on) {
  live = on; $('live').classList.toggle('on', on); $('live').setAttribute('aria-pressed', on);
  if (on) applyLive(); else { liveInfo = null; updateSun(); }
}
$('live').addEventListener('click', () => setLive(!live));
const manual = () => { if (live) { live = false; $('live').classList.remove('on'); $('live').setAttribute('aria-pressed', 'false'); liveInfo = null; } updateSun(); };
$('hour').addEventListener('input', manual); $('ls').addEventListener('input', manual);
setInterval(applyLive, 5000);

// ---- walk mode --------------------------------------------------------------
let jumpQueued = false;
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
  stage0.classList.toggle('walking', m === 'walk');
  $('walk-help').hidden = m !== 'walk';
  $('walk-help').innerHTML = isTouch
    ? 'Left thumb to move, drag anywhere else to look.'
    : 'Click the scene, then <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to move, <kbd>Space</kbd> to jump, <kbd>Shift</kbd> to run, <kbd>Esc</kbd> to release.';
  orbit.enabled = m === 'orbit';
  touchWalk = false;
  if (m === 'walk') {
    const [wx, wz] = cfg.camera.walkStart;
    camera.position.set(wx, 0, wz); camera.position.y = floorAt(wx, wz) + 1.7; camera.lookAt(...cfg.camera.target);
    vel.set(0, 0, 0);
    if (isTouch) {
      touchWalk = true; camera.rotation.order = 'YXZ'; yaw = camera.rotation.y; pitch = 0; camera.rotation.set(pitch, yaw, 0);
      closeSheets();
    } else walk.lock();
  } else {
    if (walk.isLocked) walk.unlock();
    camera.rotation.order = 'XYZ';
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

// ---- touch controls and phone tabs ------------------------------------------
function closeSheets() { stage0.classList.remove('show-dock', 'show-panel'); document.querySelectorAll('#tabs [aria-pressed]').forEach(b => b.setAttribute('aria-pressed', 'false')); }
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.tab === 'info') { closeSheets(); $('intro').classList.remove('gone'); return; }
  const was = stage0.classList.contains('show-' + b.dataset.tab);
  closeSheets();
  if (!was) { stage0.classList.add('show-' + b.dataset.tab); b.setAttribute('aria-pressed', 'true'); }
});
canvas.addEventListener('pointerdown', () => { if (!touchWalk) closeSheets(); });
setTimeout(() => $('orbit-hint').classList.add('gone'), 8000);
$('enter').addEventListener('click', () => $('orbit-hint').classList.remove('gone'));

// virtual joystick (left thumb) and drag-to-look (anywhere else on the scene)
{
  const joy = $('joy'), knob = $('knob'); let joyId = null, lookId = null, lx = 0, ly = 0;
  const R = 48;
  const setKnob = (dx, dy) => { const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / R); joyVec.x = dx / d * k; joyVec.y = dy / d * k; knob.style.transform = `translate(${joyVec.x * R}px, ${joyVec.y * R}px)`; };
  joy.addEventListener('pointerdown', e => { joyId = e.pointerId; joy.setPointerCapture(joyId); const r = joy.getBoundingClientRect(); setKnob(e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2); });
  joy.addEventListener('pointermove', e => { if (e.pointerId !== joyId) return; const r = joy.getBoundingClientRect(); setKnob(e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2); });
  const joyEnd = e => { if (e.pointerId !== joyId) return; joyId = null; joyVec.x = joyVec.y = 0; knob.style.transform = ''; };
  joy.addEventListener('pointerup', joyEnd); joy.addEventListener('pointercancel', joyEnd);
  canvas.addEventListener('pointerdown', e => { if (!touchWalk || lookId !== null) return; lookId = e.pointerId; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(lookId); });
  canvas.addEventListener('pointermove', e => {
    if (!touchWalk || e.pointerId !== lookId) return;
    yaw -= (e.clientX - lx) * 0.005; pitch = Math.max(-1.3, Math.min(1.3, pitch - (e.clientY - ly) * 0.005)); lx = e.clientX; ly = e.clientY;
    camera.rotation.set(pitch, yaw, 0);
  });
  const lookEnd = e => { if (e.pointerId === lookId) lookId = null; };
  canvas.addEventListener('pointerup', lookEnd); canvas.addEventListener('pointercancel', lookEnd);
  $('jump').addEventListener('pointerdown', e => { e.preventDefault(); jumpQueued = true; });
}

// ---- intro ------------------------------------------------------------------
$('enter').addEventListener('click', () => $('intro').classList.add('gone'));
$('btn-info').addEventListener('click', () => $('intro').classList.remove('gone'));
addEventListener('keydown', e => { if (e.code === 'Escape') $('intro').classList.add('gone'); });
$('city').addEventListener('change', e => { $('intro').classList.remove('gone'); showCity(e.target.value); });

// ---- loop -------------------------------------------------------------------
const stage = $('explorer');
function resize() { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); new ResizeObserver(resize).observe(stage); resize();
{ const y = $('year'); if (y) y.textContent = new Date().getFullYear(); } // only in the fallback footer; the kit footer has its own year
let last = performance.now();
renderer.setAnimationLoop(now => {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (mode === 'walk' && (walk.isLocked || touchWalk)) {
    const run = keys.has('ShiftLeft') ? 4 : 1, speed = 12 * run; // the city is ~4 km across
    if (touchWalk) {
      const f = -joyVec.y, s = joyVec.x, sp = (Math.hypot(joyVec.x, joyVec.y) > 0.9 ? 40 : 14) * dt; // push the stick to the rim to run
      camera.position.x += (-Math.sin(yaw) * f + Math.cos(yaw) * s) * sp;
      camera.position.z += (-Math.cos(yaw) * f - Math.sin(yaw) * s) * sp;
    } else {
      const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      walk.moveForward(f * speed * dt); walk.moveRight(s * speed * dt);
    }
    const fl = floorAt(camera.position.x, camera.position.z) + 1.7;
    vel.y -= MARS_G * dt;
    if ((keys.has('Space') || jumpQueued) && onGround) { jumpQueued = false; vel.y = 4.2; onGround = false; }
    camera.position.y += vel.y * dt;
    if (camera.position.y <= fl) { camera.position.y = fl; vel.y = 0; onGround = true; } else if (camera.position.y > fl + 0.05) onGround = false;
  } else if (mode === 'orbit') orbit.update();
  skyGroup.position.copy(camera.position);
  for (const d of devils) { const u = d.userData; u.a += u.w * dt * 4; const x = Math.cos(u.a) * u.r + Math.sin(now / 2500 + u.i) * 120, z = Math.sin(u.a) * u.r; d.position.set(x, heightAt(x, z) + d.geometry.parameters.height / 2, z); d.rotation.y += dt * 2.5; }
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
