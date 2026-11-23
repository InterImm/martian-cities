// Land mode: Procyon City's land register in the 3D explorer.
//
// - the street plan (ring streets and avenues) drawn into the city
// - every lot as a map you can hover, search and click
// - the buildings people designed on the lots they hold, merged into a few meshes
// - a claim flow: design a building on the lot, name yourself, get an edit code and a deed poster
//
// The register itself is public data in the hub (InterImm/hub, _data/land/<lot>.json, served
// as https://interimm.org/hub/api/land.json). The only thing that writes to it is the hub's
// front desk Worker (desk.interimm.org), behind Cloudflare Turnstile. Ownership is an edit code
// shown once; the register keeps only its hash. Holders can also download a key card, move the
// lot to another device with its transfer QR, or add passkeys (keys.js).

import * as THREE from 'three';
import { L, lang } from './i18n.js';
import { readPlan, lotCorners, lotFrame, lotAddress, lotLatLon, fmtLatLon, ringStatus, storyDate, cleanBuilding, hashSeed } from './land-plan.js';
import { makeMaterials, buildLayer, signMesh } from './buildings.js';
import { drawDeed, lotUrl } from './deed.js';
import { drawKeyCard, keyText, download, passkeySupported, createPasskey, getPasskey } from './keys.js';

const MINE_KEY = 'interimm-land-v1';
const PENDING_MS = 15 * 60 * 1000;        // show our own fresh claim until the public register catches up
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = id => document.getElementById(id);
const COL = { free: new THREE.Color('#f3eadb'), locked: new THREE.Color('#8f8a84'), held: new THREE.Color('#b0472a'), mine: new THREE.Color('#e3a51f'), hover: new THREE.Color('#fff4d6'), pick: new THREE.Color('#ffffff'), match: new THREE.Color('#3d7bff') };

function loadMine() { try { return JSON.parse(localStorage.getItem(MINE_KEY) || '{}') || {}; } catch { return {}; } }
function saveMine(m) { try { localStorage.setItem(MINE_KEY, JSON.stringify(m)); } catch {} }

export function createLand(ctx) {
  const { scene, camera, orbit, canvas, cfg } = ctx;
  const spec = cfg.land;
  const root = new THREE.Group(); root.name = 'land'; scene.add(root);
  const mats = makeMaterials(ctx.wallTex, ctx.wallGlow);
  const panel = $('land'), dlg = $('claim');
  let plan = null, reg = { lots: {} }, status = [], mine = loadMine();
  let streets = null, overlay = null, outline = null, labels = null, buildings = null, signs = null, preview = null, marker = null;
  let active = false, hover = -1, selected = null, matches = new Set(), tween = null, disposed = false;

  // ---------------------------------------------------------------- data
  const isFrontier = l => l.ringInfo.frontier;
  const groundY = l => (isFrontier(l) ? -0.36 : 0.06);
  function record(id) {
    const r = reg.lots[id];
    if (r) return r;
    const m = mine[id];
    if (m?.record && Date.now() - m.at < PENDING_MS) return { ...m.record, pending: true };
    return null;
  }
  function ringOpen(l) { return status[l.ring]?.open; }
  async function fetchRegistry() {
    try {
      const res = await fetch(spec.registry + (spec.registry.includes('?') ? '&' : '?') + 't=' + Math.floor(Date.now() / 30000), { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const d = await res.json();
      reg = { generated: d.generated, lots: Object.fromEntries(Object.entries(d.cities?.[plan.city] || d.lots || {}).filter(([, v]) => v && (!v.city || v.city === plan.city))) };
    } catch (e) { console.warn('land register not loaded', e); }
    // a lot we released stays gone locally even if the public copy lags
    for (const [id, m] of Object.entries(mine)) if (m.released && Date.now() - m.released < PENDING_MS) delete reg.lots[id];
    status = ringStatus(plan, { lots: Object.fromEntries(plan.lots.map(l => [l.id, record(l.id)]).filter(([, r]) => r)) });
  }

  // ---------------------------------------------------------------- scene layers
  function ringArc(r1, r2, b1, b2, y, color, list) {
    const g = new THREE.RingGeometry(r1, r2, Math.max(4, Math.ceil((b2 - b1) / 1.5)), 1, (90 - b2) * Math.PI / 180, (b2 - b1) * Math.PI / 180);
    g.rotateX(-Math.PI / 2); g.translate(plan.core[0], y, -plan.core[1]);
    paint(g, color); list.push(g);
  }
  function strip(bearing, ra, rb, width, y, color, list) {
    const g = new THREE.PlaneGeometry(width, rb - ra); g.rotateX(-Math.PI / 2);
    g.translate(0, y, -(ra + rb) / 2); g.rotateY(-bearing * Math.PI / 180);
    g.translate(plan.core[0], 0, -plan.core[1]);
    paint(g, color); list.push(g);
  }
  function paint(g, color) {
    if (g.index) { const n = g.toNonIndexed(); g.copy(n); }
    const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  async function buildStreets() {
    const { mergeGeometries } = await import('../vendor/BufferGeometryUtils.js');
    if (streets) { root.remove(streets); streets.geometry.dispose(); }
    const list = [], W = plan.widths;
    plan.rings.forEach((ring, ri) => {
      const open = status[ri]?.open, y = ring.frontier ? -0.37 : 0.05, col = open ? '#5f5953' : '#cdb491';
      const outer = ring.r + W.street / 2 + ring.depth, inner = ri === 0 ? 470 : plan.rings[ri - 1].r + W.street / 2 + plan.rings[ri - 1].depth;
      plan.avenues.forEach((av, ai) => {
        const seg = plan.lots.filter(l => l.ring === ri && l.segment === ai);
        if (seg.length) ringArc(ring.r - W.street / 2, ring.r + W.street / 2, Math.min(...seg.map(l => l.b1)) - 0.3, Math.max(...seg.map(l => l.b2)) + 0.3, y, col, list);
        const near = plan.lots.some(l => l.ring === ri && (l.segment === ai || l.segment === (ai + plan.avenues.length - 1) % plan.avenues.length));
        if (near) strip(av.bearing, inner, outer, W.avenue, y + 0.01, col, list);
      });
    });
    streets = new THREE.Mesh(mergeGeometries(list, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2 }));
    streets.receiveShadow = true; streets.name = 'streets';
    list.forEach(g => g.dispose());
    root.add(streets);
  }

  function buildOverlay() {
    for (const o of [overlay, outline]) if (o) { root.remove(o); o.geometry.dispose(); }
    const n = plan.lots.length, P = new Float32Array(n * 12 * 3), C = new Float32Array(n * 12 * 3), E = [];
    plan.lots.forEach((l, i) => {
      const y = groundY(l) + 0.12, pts = lotCorners(plan, l, 2).map(([X, Y]) => [X, y, -Y]);
      // pts: inner arc p0 p1 p2, outer arc q2 q1 q0
      const [p0, p1, p2, q2, q1, q0] = pts, tris = [p0, q0, p1, p1, q0, q1, p1, q1, p2, p2, q1, q2];
      tris.forEach((v, k) => P.set(v, (i * 12 + k) * 3));
      for (let k = 0; k < 6; k++) E.push(...pts[k], ...pts[(k + 1) % 6]);
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    overlay = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 }));
    overlay.renderOrder = 2; overlay.visible = active;
    const og = new THREE.BufferGeometry(); og.setAttribute('position', new THREE.Float32BufferAttribute(E, 3));
    outline = new THREE.LineSegments(og, new THREE.LineBasicMaterial({ color: 0x2b2724, transparent: true, opacity: 0.45, depthWrite: false }));
    outline.renderOrder = 3; outline.visible = active;
    root.add(overlay, outline);
    recolor();
  }
  function lotColor(l, i) {
    if (selected && l.id === selected.id) return COL.pick;
    if (i === hover) return COL.hover;
    if (matches.has(l.id)) return COL.match;
    if (mine[l.id] && record(l.id)) return COL.mine;
    if (record(l.id)) return COL.held;
    return ringOpen(l) ? COL.free : COL.locked;
  }
  function recolor() {
    if (!overlay) return;
    const C = overlay.geometry.attributes.color;
    plan.lots.forEach((l, i) => { const c = lotColor(l, i); for (let k = 0; k < 12; k++) C.setXYZ(i * 12 + k, c.r, c.g, c.b); });
    C.needsUpdate = true;
  }

  function label(text, sub, x, y, z, scale = 1) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 112;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(246,241,231,.92)'; g.fillRect(0, 0, 512, 112);
    g.strokeStyle = '#2b2724'; g.lineWidth = 3; g.strokeRect(2, 2, 508, 108);
    g.fillStyle = '#1f1d1b'; g.textAlign = 'center'; g.font = '600 46px "Noto Serif SC","Source Serif 4",serif'; g.fillText(text, 256, 56);
    g.fillStyle = '#6d665e'; g.font = '500 26px "IBM Plex Mono",monospace'; g.fillText(sub, 256, 94);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.scale.set(150 * scale, 33 * scale, 1); s.position.set(x, y, z); s.renderOrder = 5;
    return s;
  }
  function buildLabels() {
    if (labels) { root.remove(labels); labels.traverse(o => { o.material?.map?.dispose(); o.material?.dispose(); }); }
    labels = new THREE.Group(); labels.visible = active;
    plan.rings.forEach((r, i) => {
      const b = 22 + i * 4, [X, Y] = [plan.core[0] + Math.sin(b * Math.PI / 180) * r.r, plan.core[1] + Math.cos(b * Math.PI / 180) * r.r];
      labels.add(label(L(r.name, r.name_cn), `${r.id} · ${r.year}${status[i]?.open ? '' : L(' · locked', ' · 未开放')}`, X, 40, -Y, r.frontier ? 1.15 : 0.9));
    });
    plan.avenues.forEach(a => {
      const b = a.bearing * Math.PI / 180, R = 1000;
      labels.add(label(L(a.name, a.name_cn), L('→ ', '→ ') + L(a.toward, a.toward_cn).split(/[,，]/)[0], plan.core[0] + Math.sin(b) * R, 55, -(plan.core[1] + Math.cos(b) * R), 0.85));
    });
    root.add(labels);
  }

  function buildBuildings() {
    if (buildings) { root.remove(buildings); buildings.traverse(o => o.geometry?.dispose()); }
    if (signs) { root.remove(signs); signs.traverse(o => { o.material?.map?.dispose(); o.material?.dispose(); o.geometry?.dispose(); }); }
    const items = [];
    for (const l of plan.lots) {
      const r = record(l.id);
      if (!r || (preview && preview.lot === l.id)) continue;
      items.push({ id: l.id, frame: lotFrame(plan, l), building: cleanBuilding(plan, l.zone, r.building), seed: hashSeed(l.id + (r.holder || '')), pad: isFrontier(l) });
    }
    buildings = buildLayer(items, mats, plan.building.colors);
    root.add(buildings);
    signs = new THREE.Group();
    const tops = new Map(buildings.userData.tops.map(t => [t.id, t]));
    for (const it of items.slice(0, 400)) {
      if (!it.building.sign) continue;
      signs.add(signMesh(it.building.sign, plan.building.colors[it.building.accent], it.frame, tops.get(it.id)));
    }
    root.add(signs);
  }

  function showPreview(lot, building) {
    clearPreview(false);
    const l = plan.byId.get(lot);
    const item = { id: lot, frame: lotFrame(plan, l), building: cleanBuilding(plan, l.zone, building), seed: hashSeed(lot), pad: isFrontier(l) };
    const grp = buildLayer([item], mats, plan.building.colors);
    if (item.building.sign) grp.add(signMesh(item.building.sign, plan.building.colors[item.building.accent], item.frame, grp.userData.tops[0]));
    preview = { lot, grp };
    root.add(grp);
    if (record(lot)) buildBuildings();     // hide the old version of an edited building
  }
  function clearPreview(rebuild = true) {
    if (!preview) return;
    root.remove(preview.grp); preview.grp.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); });
    const had = record(preview.lot); preview = null;
    if (rebuild && had) buildBuildings();
  }

  // the selected lot: a gold fill and a tall beam of light, so it can be found from anywhere
  function placeMarker(l) {
    if (marker) { root.remove(marker); marker.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); }
    if (!l) { marker = null; return; }
    marker = new THREE.Group();
    const y = groundY(l) + 0.3, pts = lotCorners(plan, l, 6);
    const shape = new THREE.Shape(pts.map(([X, Y]) => new THREE.Vector2(X, Y)));
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xe3a51f, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6 }));
    fill.rotation.x = -Math.PI / 2; fill.position.y = y; fill.renderOrder = 6;   // shape is in (X, Y); rotating maps Y to -z
    const edge = pts.map(([X, Y]) => new THREE.Vector3(X, y + 0.1, -Y)); edge.push(edge[0].clone());
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(edge), new THREE.LineBasicMaterial({ color: 0x8a5a00 }));
    line.renderOrder = 7;
    const f = lotFrame(plan, l);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.4, 90, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffc94a, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.set(f.x, y + 45, f.z); beam.name = 'beam';
    marker.add(fill, line, beam); root.add(marker);
  }

  // ---------------------------------------------------------------- camera
  function flyTo(target, pos, secs = 1.4) {
    tween = { start: performance.now(), secs, p0: camera.position.clone(), t0: orbit.target.clone(), p1: pos, t1: target };
  }
  function flyToLot(l, close = false) {
    const f = lotFrame(plan, l), t = new THREE.Vector3(f.x, groundY(l) + 6, f.z);
    const front = new THREE.Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw));
    const dist = close ? 70 : 170, up = close ? 38 : 120;
    flyTo(t, t.clone().addScaledVector(front, dist).add(new THREE.Vector3(0, up, 0)));
  }
  function overview() { const t = new THREE.Vector3(plan.core[0], 0, -plan.core[1]); flyTo(t, t.clone().add(new THREE.Vector3(0, 2300, 1500))); }

  // ---------------------------------------------------------------- picking
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pickAt(ev) {
    if (!overlay) return -1;
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(overlay, false)[0];
    return hit ? Math.floor(hit.faceIndex / 4) : -1;
  }
  let down = null;
  const onDown = e => { if (active) down = { x: e.clientX, y: e.clientY }; };
  const onUp = e => {
    if (!active || !down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
    if (moved > 6) return;
    const i = pickAt(e); if (i >= 0) select(plan.lots[i], true);
  };
  const onMove = e => {
    if (!active || e.pointerType === 'touch') return;
    const i = pickAt(e); if (i !== hover) { hover = i; canvas.style.cursor = i >= 0 ? 'pointer' : ''; recolor(); }
  };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointermove', onMove);

  // ---------------------------------------------------------------- panel
  const typeName = t => L(plan.building.types[t]?.name, plan.building.types[t]?.name_cn);
  function statsLine() {
    const held = Object.keys(reg.lots).length, open = status.filter(s => s.open), free = open.reduce((s, r) => s + r.total - r.claimed, 0);
    const holders = new Set(Object.values(reg.lots).map(r => r.holder)).size;
    return L(`${held.toLocaleString()} lots held by ${holders.toLocaleString()} settlers · ${free.toLocaleString()} free in ${open.length} open rings`,
      `已登记 ${held.toLocaleString()} 块，持有人 ${holders.toLocaleString()} 位 · ${open.length} 条开放环路上还有 ${free.toLocaleString()} 块空地`);
  }
  function ringsHtml() {
    return status.map((s, i) => {
      const r = s.ring, pct = s.total ? Math.round(100 * s.claimed / s.total) : 0;
      const lock = s.open ? '' : `<small class="lock">${esc(L(`Opens when ${plan.rings[i - 1].name} is ${Math.round(r.opens.share * 100)}% held (${Math.max(0, s.needs - status[i - 1].claimed)} more)`, `${plan.rings[i - 1].name_cn}登记满 ${Math.round(r.opens.share * 100)}% 后开放（还差 ${Math.max(0, s.needs - status[i - 1].claimed)} 块）`))}</small>`;
      return `<li><button type="button" class="ring-row" data-ring="${i}"><span class="rid">${r.id}</span><span class="rname">${esc(L(r.name, r.name_cn))} <small>${r.year} · ${esc(L(plan.zones[r.zone].name, plan.zones[r.zone].name_cn))}</small></span><span class="rcount">${s.claimed}/${s.total}</span></button>` +
        `<span class="bar"><i style="width:${pct}%"></i></span>${lock}</li>`;
    }).join('');
  }
  function lotsList(ids) {
    return ids.map(id => {
      const l = plan.byId.get(id), r = record(id); if (!l) return '';
      const a = lotAddress(plan, l, lang);
      return `<li><button type="button" class="lot-link" data-lot="${id}"><b>${id}</b> ${esc(r ? r.holder : a.line)} <small>${esc(r ? `${typeName(cleanBuilding(plan, l.zone, r.building).type)} · ${r.granted || ''}` : a.between)}</small></button></li>`;
    }).join('');
  }
  function renderPanel() {
    const myIds = Object.keys(mine).filter(id => record(id));
    const latest = Object.entries(reg.lots).sort((a, b) => String(b[1].granted_earth || b[1].granted || '').localeCompare(String(a[1].granted_earth || a[1].granted || ''))).slice(0, 8).map(([id]) => id);
    panel.querySelector('.land-stats').textContent = statsLine();
    // arriving from the hub's registration desk: claim on behalf of that company
    let co = panel.querySelector('.land-for-co');
    if (forCompany && !co) { co = document.createElement('p'); co.className = 'land-for-co note'; panel.querySelector('.land-stats').after(co); }
    if (co) { co.hidden = !forCompany; if (forCompany) co.innerHTML = esc(L(`Choosing a lot for ${forCompany.name || forCompany.key}. Pick any free lot and claim it: the company's key and code are already filled in.`, `正在为「${forCompany.name || forCompany.key}」选地。点任意空地登记即可，公司的登记号和编辑码已经填好。`)); }
    panel.querySelector('.land-rings').innerHTML = ringsHtml();
    panel.querySelector('.land-mine').innerHTML = (myIds.length ? lotsList(myIds) : `<li class="note">${esc(L('Lots you claim on this device show up here.', '你在这台设备上登记的地块会显示在这里。'))}</li>`) +
      `<li class="mine-acts">${myIds.length ? `<button type="button" class="btn" data-manage>${esc(myIds.length > 1 ? L(`Manage my ${myIds.length} lots`, `管理我的 ${myIds.length} 块地`) : L('Manage my lot', '管理我的地'))}</button>` : ''}` +
      (passkeySupported() ? `<button type="button" class="btn subtle" data-pk-signin>${esc(L('Sign in with a passkey', '用通行密钥登录'))}</button>` : '') + '</li>';
    panel.querySelector('[data-pk-signin]')?.addEventListener('click', () => openPasskeySignIn(null));
    panel.querySelector('[data-manage]')?.addEventListener('click', openManage);
    panel.querySelector('.land-latest').innerHTML = latest.length ? lotsList(latest) : `<li class="note">${esc(L('No grants yet. The first settler gets the pick of Pioneer Ring.', '还没有人登记。第一位定居者可以在开拓者环任意挑选。'))}</li>`;
    renderCard();
  }
  function renderCard() {
    const box = panel.querySelector('.land-card');
    if (!selected) { box.innerHTML = `<p class="note">${esc(L('Click any lot on the map, or search for a lot number or a holder.', '点击地图上的任意地块，或搜索地块号、持有人。'))}</p>`; return; }
    const l = selected, r = record(l.id), a = lotAddress(plan, l, lang), ring = l.ringInfo, zone = plan.zones[l.zone], s = status[l.ring];
    const facts = `<dl class="facts">
      <dt>${esc(L('Zone', '分区'))}</dt><dd>${esc(L(zone.name, zone.name_cn))} · ${l.area.toLocaleString()} m²</dd>
      <dt>${esc(L('Ring', '环路'))}</dt><dd>${esc(L(ring.name, ring.name_cn))}, ${ring.year}: ${esc(L(ring.note, ring.note_cn))}</dd>
      <dt>${esc(L('Mars', '坐标'))}</dt><dd>${fmtLatLon(lotLatLon(plan, l))}</dd>
      <dt>${esc(L('May build', '可建'))}</dt><dd>${zone.types.map(typeName).map(esc).join(L(', ', '、'))}${esc(L(`, up to ${zone.maxFloors} floors`, `，最高 ${zone.maxFloors} 层`))}</dd></dl>`;
    let body = '';
    if (r) {
      const b = cleanBuilding(plan, l.zone, r.building);
      body = `<p class="holder"><span class="chip st-operating">${esc(r.pending ? L('Just granted', '刚刚登记') : L('Held', '已登记'))}</span> <b>${esc(r.holder)}</b></p>` +
        (r.motto ? `<blockquote>${esc(r.motto)}</blockquote>` : '') +
        `<p class="note">${esc(typeName(b.type))}${b.type === 'garden' ? '' : esc(L(` · ${b.floors} floors`, ` · ${b.floors} 层`))}${b.sign ? ` · “${esc(b.sign)}”` : ''} · ${esc(L('granted', '登记于'))} ${esc(r.granted || '')}${r.company?.key ? ` · <a href="https://interimm.org/hub/companies/${encodeURIComponent(r.company.key)}/" target="_blank" rel="noopener">${esc(r.company.name || L('company page', '公司主页'))}</a>` : ''}</p>` +
        `<div class="actions"><button class="btn" data-act="deed">${esc(L('Deed poster', '地契海报'))}</button><button class="btn" data-act="share">${esc(L('Copy link', '复制链接'))}</button><button class="btn" data-act="look">${esc(L('Look closer', '走近看看'))}</button></div>` +
        `<div class="actions">${mine[l.id] ? `<button class="btn" data-act="keys">${esc(L('Keys', '钥匙'))}</button><button class="btn" data-act="edit">${esc(L('Change my building', '修改我的建筑'))}</button><button class="btn subtle" data-act="release">${esc(L('Give up this lot', '放弃这块地'))}</button>` : `<button class="btn subtle" data-act="mycode">${esc(L('I hold this lot', '这块地是我的'))}</button>`}</div>`;
    } else if (s.open) {
      body = `<p class="holder"><span class="chip">${esc(L('Free', '空地'))}</span></p><div class="actions"><button class="btn btn-primary" data-act="claim">${esc(L('Claim this lot', '登记这块地'))}</button><button class="btn" data-act="look">${esc(L('Look closer', '走近看看'))}</button></div>` +
        `<p class="note">${esc(L('Free, takes a minute, no account. You design the building; it appears in the city for everyone.', '免费，一分钟，无需账号。你来设计建筑，它会出现在所有人看到的城市里。'))}</p>`;
    } else {
      body = `<p class="holder"><span class="chip">${esc(L('Surveyed, not open yet', '已测绘，尚未开放'))}</span></p><p class="note">${esc(L(`${ring.name} opens when ${plan.rings[l.ring - 1].name} is ${Math.round(ring.opens.share * 100)}% held: ${Math.max(0, s.needs - status[l.ring - 1].claimed)} more lots to go. The city grows outwards as people move in.`, `${plan.rings[l.ring - 1].name_cn}登记满 ${Math.round(ring.opens.share * 100)}% 后，${ring.name_cn}开放：还差 ${Math.max(0, s.needs - status[l.ring - 1].claimed)} 块。城市随着居民入住向外生长。`))}</p>`;
    }
    box.innerHTML = `<p class="eyebrow">${esc(L('Lot', '地块'))} ${l.id}</p><h3>${esc(a.line)}</h3><p class="note">${esc(a.between)} · ${esc(a.side)}</p>${body}${facts}`;
  }
  panel.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.lot) { select(plan.byId.get(b.dataset.lot), true); return; }
    if (b.dataset.ring) { const i = +b.dataset.ring, r = plan.rings[i]; const lot = plan.lots.find(l => l.ring === i && l.segment === 0) || plan.lots.find(l => l.ring === i); if (lot) { const f = lotFrame(plan, lot); const t = new THREE.Vector3(f.x, 0, f.z); flyTo(t, t.clone().add(new THREE.Vector3(0, 700 + r.r * 0.3, 500))); } return; }
    const act = b.dataset.act; if (!act || !selected) return;
    if (act === 'claim') openClaim(selected.id);
    else if (act === 'look') flyToLot(selected, true);
    else if (act === 'share') copyLink(selected.id, b);
    else if (act === 'deed') saveDeed(selected.id, b);
    else if (act === 'edit') openClaim(selected.id, { edit: true });
    else if (act === 'release') openRelease(selected.id);
    else if (act === 'mycode') openCode(selected.id);
    else if (act === 'keys') openKeys(selected.id);
  });
  panel.querySelector('.land-q').addEventListener('input', e => search(e.target.value));
  panel.querySelector('[data-act=overview]')?.addEventListener('click', overview);

  function search(q) {
    q = q.trim().toLowerCase(); matches = new Set();
    const out = panel.querySelector('.land-results');
    if (!q) { out.innerHTML = ''; recolor(); return; }
    const ids = [];
    const byId = plan.byId.get(q.toUpperCase());
    if (byId) ids.push(byId.id);
    for (const [id, r] of Object.entries(reg.lots)) if (String(r.holder || '').toLowerCase().includes(q) || String(r.building?.sign || '').toLowerCase().includes(q)) ids.push(id);
    ids.slice(0, 50).forEach(id => matches.add(id));
    out.innerHTML = ids.length ? `<ul class="lots">${lotsList(ids.slice(0, 12))}</ul>` : `<p class="note">${esc(L('Nothing found.', '没有找到。'))}</p>`;
    recolor();
  }

  function select(l, fly) {
    if (!l) return;
    selected = l; placeMarker(l); recolor(); renderCard();
    if (fly) flyToLot(l);
    history.replaceState(null, '', `#city=${cfg.id}&plot=${l.id}`);
    ctx.onOpenPanel?.();
  }

  async function copyLink(id, btn) {
    const url = lotUrl(id, lang, location.origin + location.pathname.replace(/index\.html$/, ''));
    try { await navigator.clipboard.writeText(url); btn.textContent = L('Copied', '已复制'); } catch { prompt(L('Copy this link', '复制这个链接'), url); }
  }
  async function saveDeed(id, btn) {
    const l = plan.byId.get(id), r = record(id); if (!l || !r) return;
    btn && (btn.disabled = true);
    try {
      const c = await drawDeed({ plan, registry: reg, lot: l, record: r, lang, typeName: typeName(cleanBuilding(plan, l.zone, r.building).type) });
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      const url = URL.createObjectURL(blob);
      showDeed(url, `procyon-${id}.png`);
    } finally { btn && (btn.disabled = false); }
  }
  function showDeed(url, name) {
    dlg.hidden = false; dlg.className = 'claim deed-view';
    dlg.innerHTML = `<div class="claim-card"><button class="x" data-x aria-label="${esc(L('Close', '关闭'))}">×</button><h2>${esc(L('Your deed poster', '你的地契海报'))}</h2>` +
      `<img class="deed-img" src="${url}" alt=""><p class="note">${esc(L('Long-press the image to save it on a phone, or download it.', '手机上长按图片保存，或点击下载。'))}</p>` +
      `<div class="actions"><a class="btn btn-primary" href="${url}" download="${esc(name)}">${esc(L('Download PNG', '下载 PNG'))}</a></div></div>`;
  }

  // ---------------------------------------------------------------- desk
  let tsReady = null;
  function loadTurnstile() {
    if (tsReady) return tsReady;
    tsReady = new Promise((res, rej) => {
      if (window.turnstile) return res(window.turnstile);
      const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
      s.onload = () => res(window.turnstile); s.onerror = () => { tsReady = null; rej(new Error('turnstile')); };
      document.head.appendChild(s);
    });
    return tsReady;
  }
  async function token(box) {
    if (spec.dev) return 'dev';
    const ts = await loadTurnstile();
    box.innerHTML = '';
    return new Promise((res, rej) => {
      ts.render(box, { sitekey: spec.turnstile, language: lang === 'cn' ? 'zh-cn' : 'en', callback: res, 'error-callback': () => rej(new Error('turnstile')), 'expired-callback': () => rej(new Error('expired')) });
    });
  }
  async function desk(path, body) {
    let res;
    try { res = await fetch(spec.desk.replace(/\/$/, '') + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { throw new Error(L('Could not reach the Land Office. Check your connection and try again.', '无法连接土地登记处，请检查网络后再试。')); }
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) {
      const msg = { taken: L('Someone claimed this lot a moment ago. Pick another one.', '这块地刚刚被别人登记了，请换一块。'), locked: L('This ring is not open yet.', '这条环路尚未开放。'), code: L('That edit code does not match this lot.', '编辑码与这块地不符。'), words: L('Some words are not allowed on the register. Please change them.', '有些用词不能登记，请修改。'), rate: L('Too many claims from your network today. Try again tomorrow.', '你的网络今天登记次数过多，请明天再试。'), turnstile: L('The check did not pass. Please try again.', '人机验证未通过，请再试一次。'), passkey: L('The passkey sign-in could not be checked. Please try again.', '通行密钥验证失败，请再试一次。'), passkey_unknown: L('That passkey is not on this lot.', '这个通行密钥不属于这块地。'), caps: L('This lot already has five passkeys.', '这块地已有五个通行密钥。') }[out.error];
      throw new Error(msg || out.message || L('The Land Office could not finish this. Please try again later.', '土地登记处暂时无法完成，请稍后再试。'));
    }
    return out;
  }

  // How this device proves it holds a lot: the edit code it remembers, or a passkey.
  async function credFor(id) {
    const m = mine[id] || {};
    if (m.code) return { code: m.code };
    if (m.passkey && passkeySupported()) {
      const { challenge, rpId } = await desk('/land/challenge', { city: plan.city });
      const { assertion } = await getPasskey({ challenge, rpId, ids: [m.passkey] });
      return { passkey: assertion };
    }
    return { code: '' };
  }
  function remember(id, patch) { mine[id] = { ...(mine[id] || {}), ...patch }; delete mine[id].released; saveMine(mine); }

  // ---------------------------------------------------------------- keys: card, transfer, passkeys
  const myHeld = () => Object.keys(mine).filter(id => record(id) && plan.byId.get(id)).sort();
  const keysFor = ids => ids.filter(id => mine[id]?.code).map(id => ({ lot: plan.byId.get(id), code: mine[id].code, holder: record(id)?.holder }));
  // The passkey this device uses for most of its lots: new lots join it rather than getting their own.
  function keyring() {
    const n = {};
    for (const id of myHeld()) { const p = mine[id].passkey; if (p) n[p] = (n[p] || 0) + 1; }
    return Object.entries(n).sort((x, y) => y[1] - x[1])[0]?.[0] || null;
  }
  async function saveKeyCard(ids, btn) {
    const keys = keysFor(ids); if (!keys.length) return;
    const c = await drawKeyCard({ plan, keys, lang });
    c.toBlob(b => download(`interimm-key-${keys.length > 1 ? `${keys.length}-lots` : keys[0].lot.id}.png`, b), 'image/png');
    if (btn) btn.textContent = L('Downloaded', '已下载');
  }
  function saveKeyText(ids, btn) {
    const keys = keysFor(ids); if (!keys.length) return;
    download(`interimm-key-${keys.length > 1 ? `${keys.length}-lots` : keys[0].lot.id}.txt`, new Blob([keyText({ plan, keys, lang })], { type: 'text/plain;charset=utf-8' }));
    if (btn) btn.textContent = L('Downloaded', '已下载');
  }
  // Put these lots on one passkey: the device's existing one if it has one (a sign-in links it),
  // else a new one. Lots prove themselves with their codes, or with the passkey they already hold.
  async function passkeyFor(ids, box, btn, note, { fresh = false } = {}) {
    btn.disabled = true; note.textContent = '';
    try {
      const ring = fresh ? null : keyring();
      const todo = ids.filter(id => !(ring && mine[id]?.passkey === ring));
      if (!todo.length) { note.textContent = L('These lots are already on your passkey.', '这些地已经在你的通行密钥里了。'); return; }
      const withCode = todo.filter(id => mine[id]?.code);
      const viaKey = todo.filter(id => !mine[id]?.code && mine[id]?.passkey);
      const oldKey = viaKey.length ? mine[viaKey[0]].passkey : null;
      const ok = [...withCode, ...viaKey.filter(id => mine[id].passkey === oldKey)];
      if (!ok.length) throw new Error(L('This device has no code or passkey for these lots.', '这台设备上没有这些地的编辑码或通行密钥。'));
      const body = { city: plan.city, lots: ok.map(id => ({ lot: id, ...(mine[id]?.code ? { code: mine[id].code } : {}) })) };
      if (oldKey && !(ring && oldKey === ring)) {
        const c0 = await desk('/land/challenge', { city: plan.city });
        body.passkey = (await getPasskey({ challenge: c0.challenge, rpId: c0.rpId, ids: [oldKey] })).assertion;
      }
      const { challenge, rpId } = await desk('/land/challenge', { city: plan.city });
      let pid;
      if (ring) {
        const got = await getPasskey({ challenge, rpId, ids: [ring] });
        body.linkPasskey = got.assertion; pid = got.assertion.id;
      } else {
        const l = plan.byId.get(ok[0]);
        const label = ok.length > 1 || myHeld().length > 1 ? L(`Procyon City · my lots`, '南河城 · 我的地') : `${ok[0]} · ${lotAddress(plan, l, lang).line}`;
        const np = await createPasskey({ challenge, rpId, city: plan.city, lot: ok[0], label, holder: record(ok[0])?.holder });
        body.newPasskey = np; pid = np.id;
      }
      body.turnstile = await token(box);
      const out = await desk('/land/passkey/add', body);
      for (const id of ok) remember(id, { passkey: pid, passkeys: out.lots?.[id] || out.passkeys });
      box.innerHTML = '';
      btn.textContent = ring ? L('Added to your passkey', '已加入你的通行密钥') : L('Passkey saved', '通行密钥已保存');
      const left = todo.length - ok.length;
      note.textContent = L(`${ok.length} lot${ok.length > 1 ? 's' : ''} on one passkey. Sign in with it on any device where your passkeys sync (the same Apple, Google or password-manager account) and every lot comes back.`, `${ok.length} 块地在同一个通行密钥里。在同步了通行密钥的设备上（同一个 Apple、Google 或密码管理器账号）登录，所有地块都会回来。`) +
        (left ? L(` ${left} lot(s) were left out: add them again from this screen.`, ` 有 ${left} 块没加上，请再点一次。`) : '');
      renderPanel();
    } catch (ex) {
      btn.disabled = false;
      note.textContent = ex?.name === 'NotAllowedError' ? L('Cancelled.', '已取消。') : ex?.message === 'unsupported' ? L('This browser cannot save a passkey for the Land Office.', '这个浏览器无法为土地登记处保存通行密钥。') : (ex?.message || String(ex));
    }
  }
  function passkeyLabel(ids) {
    const ring = keyring();
    if (ring && ids.every(id => mine[id]?.passkey === ring)) return L('Add another passkey', '再添加一个通行密钥');
    return ring ? L('Add to my passkey', '加入我的通行密钥') : L('Save as passkey', '存为通行密钥');
  }
  function keyButtons(ids) {
    const codes = ids.some(id => mine[id]?.code), many = ids.length > 1;
    return `${codes ? `<button class="btn" data-keycard>${esc(many ? L('One key card for all', '下载全部钥匙卡') : L('Download key card', '下载钥匙卡'))}</button><button class="btn" data-keytext>${esc(L('Download as text', '下载文本'))}</button>` : ''}` +
      `${passkeySupported() && ids.some(id => mine[id]?.code || mine[id]?.passkey) ? `<button class="btn" data-passkey>${esc(passkeyLabel(ids))}</button>` : ''}`;
  }
  function wireKeys(ids, root) {
    root.querySelector('[data-keycard]')?.addEventListener('click', e => saveKeyCard(ids, e.target));
    root.querySelector('[data-keytext]')?.addEventListener('click', e => saveKeyText(ids, e.target));
    root.querySelector('[data-passkey]')?.addEventListener('click', e => {
      const ring = keyring(), fresh = !!ring && ids.every(id => mine[id]?.passkey === ring);
      passkeyFor(ids, root.querySelector('.ts'), e.target, root.querySelector('.key-note'), { fresh });
    });
  }
  async function openKeys(id) {
    const l = plan.byId.get(id), a = lotAddress(plan, l, lang), code = mine[id]?.code;
    dlg.hidden = false; dlg.className = 'claim';
    dlg.innerHTML = `<div class="claim-card"><button class="x" data-x aria-label="${esc(L('Close', '关闭'))}">×</button>
      <p class="eyebrow">${esc(L('Keys', '钥匙'))} · ${id}</p><h2>${esc(a.line)}</h2>
      ${code ? `<div class="code-box"><span class="lab">${esc(L('Edit code', '编辑码'))}</span><code>${esc(code)}</code>
        <p class="note">${esc(L('To move this lot to another device, scan the QR code on the key card there, or open the link in the text file.', '要转移到另一台设备，在那台设备上扫钥匙卡上的二维码，或打开文本文件里的链接。'))}</p></div>
        <img class="key-preview" alt="${esc(L('Key card', '钥匙卡'))}">`
      : `<p class="note">${esc(L('This device signs in to the lot with a passkey. On another device, sign in with the same passkey (it syncs with your Apple, Google or password-manager account).', '这台设备用通行密钥登录这块地。在另一台设备上用同一个通行密钥登录即可（它会随 Apple、Google 或密码管理器账号同步）。'))}</p>`}
      <div class="actions">${keyButtons([id])}</div><div class="ts"></div><p class="note key-note" role="status"></p>
      ${myHeld().length > 1 ? `<p class="note"><button type="button" class="linkish" data-manage>${esc(L(`You hold ${myHeld().length} lots: manage them together`, `你持有 ${myHeld().length} 块地：一起管理`))}</button></p>` : ''}
      <p class="note">${esc(L('Keep keys private: whoever has the code or the card can change or give up the lot.', '请妥善保管：拿到编辑码或钥匙卡的人可以修改或放弃这块地。'))}</p></div>`;
    wireKeys([id], dlg);
    dlg.querySelector('[data-manage]')?.addEventListener('click', openManage);
    if (code) { const c = await drawKeyCard({ plan, keys: keysFor([id]), lang }); const img = dlg.querySelector('.key-preview'); if (img) img.src = c.toDataURL('image/png'); }
  }

  // ---------------------------------------------------------------- my lots, together
  function openManage() {
    const ids = myHeld();
    if (!ids.length) return;
    const ring = keyring();
    const rows = ids.map(id => {
      const l = plan.byId.get(id), r = record(id), a = lotAddress(plan, l, lang), m = mine[id];
      const how = [m.code ? L('code', '编辑码') : '', m.passkey ? (m.passkey === ring ? L('passkey', '通行密钥') : L('other passkey', '另一个通行密钥')) : ''].filter(Boolean).join(' · ');
      return `<tr data-lot="${id}"><td><b>${id}</b><br><small>${esc(a.line)}</small></td><td>${esc(r?.holder || '')}<br><small>${esc(typeName(cleanBuilding(plan, l.zone, r?.building).type))}${r?.pending ? ' · ' + esc(L('publishing…', '发布中…')) : ''}</small></td>
        <td><small>${esc(how || L('none on this device', '本机无钥匙'))}</small></td>
        <td class="row-acts"><button class="btn subtle" data-go="look">${esc(L('Go', '前往'))}</button><button class="btn subtle" data-go="edit">${esc(L('Edit', '改建'))}</button><button class="btn subtle" data-go="keys">${esc(L('Keys', '钥匙'))}</button></td></tr>`;
    }).join('');
    const onRing = ring ? ids.filter(id => mine[id].passkey === ring).length : 0;
    dlg.hidden = false; dlg.className = 'claim wide';
    dlg.innerHTML = `<div class="claim-card"><button class="x" data-x aria-label="${esc(L('Close', '关闭'))}">×</button>
      <p class="eyebrow">${esc(L('Land Office · my lots', '土地登记处 · 我的地'))}</p><h2>${esc(L(`You hold ${ids.length} lot${ids.length > 1 ? 's' : ''}`, `你持有 ${ids.length} 块地`))}</h2>
      <table class="my-lots"><tbody>${rows}</tbody></table>
      <h3>${esc(L('One key for all of them', '一把钥匙管所有地'))}</h3>
      <p class="note">${esc(ring
        ? L(`${onRing} of ${ids.length} lots are on your passkey. Signing in with it on a new device brings back every lot on it.`, `${ids.length} 块地中有 ${onRing} 块在你的通行密钥里。在新设备上用它登录，里面的地块都会回来。`)
        : L('Save every lot to one passkey, or download one key card with a QR code that moves them all to another device.', '把所有地存进一个通行密钥，或者下载一张钥匙卡，扫码即可把它们全部转移到另一台设备。'))}</p>
      <div class="actions">${keyButtons(ids)}${passkeySupported() ? `<button class="btn subtle" data-pk-signin>${esc(L('Sign in with a passkey', '用通行密钥登录'))}</button>` : ''}</div>
      <div class="ts"></div><p class="note key-note" role="status"></p>
      <p class="note">${esc(L('Keep keys private: whoever has a code or the card can change or give up those lots.', '请妥善保管：拿到编辑码或钥匙卡的人可以修改或放弃这些地。'))}</p></div>`;
    wireKeys(ids, dlg);
    dlg.querySelector('[data-pk-signin]')?.addEventListener('click', () => openPasskeySignIn(null));
    dlg.querySelector('tbody').addEventListener('click', e => {
      const b = e.target.closest('[data-go]'); if (!b) return;
      const id = b.closest('tr').dataset.lot, l = plan.byId.get(id);
      if (b.dataset.go === 'keys') return openKeys(id);
      closeDialog(); select(l, true);
      if (b.dataset.go === 'edit') openClaim(id, { edit: true });
    });
  }

  function openPasskeySignIn(id) {
    dlg.hidden = false; dlg.className = 'claim';
    dlg.innerHTML = `<div class="claim-card"><button class="x" data-x aria-label="${esc(L('Close', '关闭'))}">×</button><p class="eyebrow">${esc(L('Land Office', '土地登记处'))}${id ? ' · ' + id : ''}</p>
      <h2>${esc(L('Sign in with a passkey', '用通行密钥登录'))}</h2><p class="note">${esc(L('Your device shows the passkeys it holds for the Land Office. Every lot on the passkey you pick comes back to this device.', '设备会列出你为土地登记处保存的通行密钥。选一个，它里面的所有地块都会回到这台设备。'))}</p>
      <div class="ts"></div><p class="err" role="alert"></p><div class="actions"><button class="btn btn-primary" data-go>${esc(L('Use passkey', '使用通行密钥'))}</button></div></div>`;
    const err = dlg.querySelector('.err');
    let tp = token(dlg.querySelector('.ts')); tp.catch(() => {});
    dlg.querySelector('[data-go]').addEventListener('click', async e => {
      e.target.disabled = true; err.textContent = '';
      try {
        const { challenge, rpId } = await desk('/land/challenge', { city: plan.city });
        const got = await getPasskey({ challenge, rpId, ids: id && mine[id]?.passkey ? [mine[id].passkey] : undefined });
        if (got.city && got.city !== plan.city) throw new Error(L('That passkey belongs to another city.', '这个通行密钥属于另一座城市。'));
        const out = await desk('/land/passkey/signin', { city: plan.city, lot: got.lot || id || '', passkey: got.assertion, turnstile: await tp });
        const ids = Object.keys(out.lots || {});
        for (const lid of ids) remember(lid, { passkey: got.assertion.id, record: out.lots[lid].record, passkeys: out.lots[lid].passkeys, at: 0 });
        dlg.hidden = true; renderPanel(); recolor();
        if (ids.length === 1 || (id && ids.includes(id))) api.selectId(id && ids.includes(id) ? id : ids[0]);
        else if (ids.length > 1) openManage();
      } catch (ex) {
        e.target.disabled = false; err.textContent = ex?.name === 'NotAllowedError' ? L('Cancelled.', '已取消。') : (ex?.message || String(ex));
        tp = token(dlg.querySelector('.ts')); tp.catch(() => {});
      }
    });
  }

  // A key card for several lots: one human check, then every lot with a matching code comes here.
  function openImport(keys) {
    dlg.hidden = false; dlg.className = 'claim';
    dlg.innerHTML = `<div class="claim-card"><button class="x" data-x aria-label="${esc(L('Close', '关闭'))}">×</button><p class="eyebrow">${esc(L('Land Office · key card', '土地登记处 · 钥匙卡'))}</p>
      <h2>${esc(L(`Move ${keys.length} lots to this device`, `把 ${keys.length} 块地转移到这台设备`))}</h2>
      <ul class="lots">${keys.map(k => `<li><b>${k.lot}</b> ${esc(lotAddress(plan, plan.byId.get(k.lot), lang).line)}</li>`).join('')}</ul>
      <div class="ts"></div><p class="err" role="alert"></p></div>`;
    const err = dlg.querySelector('.err');
    (async () => {
      try {
        const out = await desk('/land/verify', { city: plan.city, lots: keys.map(k => ({ lot: k.lot, code: k.code })), turnstile: await token(dlg.querySelector('.ts')) });
        for (const k of keys) if (out.lots[k.lot]) remember(k.lot, { code: k.code, record: out.lots[k.lot].record, passkeys: out.lots[k.lot].passkeys, at: 0 });
        renderPanel(); recolor();
        if (out.failed?.length) { err.textContent = L(`These codes no longer match: ${out.failed.join(', ')}. The other lots are on this device now.`, `这些编辑码已失效：${out.failed.join('、')}。其余地块已转移到这台设备。`); return; }
        openManage();
      } catch (ex) { err.textContent = ex?.message || String(ex); }
    })();
  }

  // ---------------------------------------------------------------- claim / edit dialog
  function openClaim(id, { edit = false } = {}) {
    const l = plan.byId.get(id), zone = plan.zones[l.zone], kit = plan.building, existing = record(id);
    let b = cleanBuilding(plan, l.zone, edit && existing ? existing.building : { type: zone.types[0], floors: Math.min(3, zone.maxFloors), color: 'chalk', accent: 'rust', roof: 'solar' });
    let step = 1;
    const who = { holder: edit && existing ? existing.holder : (forCompany?.name || ''), motto: edit && existing ? existing.motto || '' : '', ckey: forCompany?.key || '', ccode: forCompany?.code || '', contact: '' };
    const code = edit ? mine[id]?.code || '' : '';
    flyToLot(l, true); showPreview(id, b);
    const beam = marker?.getObjectByName('beam'); if (beam) beam.visible = false;
    dlg.hidden = false; dlg.className = 'claim';
    const a = lotAddress(plan, l, lang);
    const draw = () => {
      const t = kit.types[b.type], [lo, hi] = t.floors, maxF = Math.min(hi, zone.maxFloors);
      const roofs = ['tower', 'office', 'shop'].includes(b.type) || (b.type === 'dome');
      const swatches = (name, cur) => Object.entries(kit.colors).map(([k, v]) => `<label class="sw" title="${k}"><input type="radio" name="${name}" value="${k}" ${k === cur ? 'checked' : ''}><i style="background:${v}"></i></label>`).join('');
      const steps = [L('Design', '设计'), L('Holder', '持有人'), L('Confirm', '确认')].map((s, i) => `<li class="${i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}">${i + 1}. ${esc(s)}</li>`).join('');
      let inner = '';
      if (step === 1) inner = `
        <fieldset class="types">${zone.types.map(k => `<label class="type ${k === b.type ? 'on' : ''}"><input type="radio" name="type" value="${k}" ${k === b.type ? 'checked' : ''}><b>${esc(typeName(k))}</b><small>${esc(L(kit.types[k].note, kit.types[k].note_cn))}</small></label>`).join('')}</fieldset>
        ${maxF > lo ? `<label>${esc(b.type === 'vault' || b.type === 'greenhouse' ? L('Vaults', '拱数') : b.type === 'monument' ? L('Height', '高度') : L('Floors', '层数'))} <output>${b.floors}</output><input type="range" name="floors" min="${lo}" max="${maxF}" value="${b.floors}"></label>` : ''}
        <div class="field"><span class="lab">${esc(L('Colour', '主色'))}</span><div class="sws">${swatches('color', b.color)}</div></div>
        <div class="field"><span class="lab">${esc(L('Accent', '点缀色'))}</span><div class="sws">${swatches('accent', b.accent)}</div></div>
        ${roofs ? `<div class="field"><span class="lab">${esc(L('Roof', '屋顶'))}</span><div class="seg">${kit.roofs.map(r => `<label><input type="radio" name="roof" value="${r}" ${r === b.roof ? 'checked' : ''}><span>${esc({ flat: L('Flat', '平顶'), solar: L('Solar', '太阳能'), garden: L('Garden', '屋顶花园'), antenna: L('Antenna', '天线') }[r])}</span></label>`).join('')}</div></div>` : ''}
        <label>${esc(L('Sign on the building', '建筑招牌'))} <small>${esc(L(`optional, up to ${kit.signMax} characters`, `可选，最多 ${kit.signMax} 个字`))}</small><input type="text" name="sign" maxlength="${kit.signMax}" value="${esc(b.sign)}" placeholder="${esc(L('e.g. Red Dust Café', '例如：红尘咖啡'))}"></label>`;
      else if (step === 2) inner = `
        <label>${esc(L('Holder name, shown on the register', '持有人名称，公开显示'))} *<input type="text" name="holder" maxlength="24" required value="${esc(who.holder)}" placeholder="${esc(L('Your name or a pen name', '你的名字或笔名'))}"></label>
        <label>${esc(L('A line for future settlers', '写给未来定居者的一句话'))} <small>${esc(L('optional, up to 80 characters', '可选，最多 80 字'))}</small><textarea name="motto" maxlength="80" rows="2">${esc(who.motto)}</textarea></label>
        ${edit ? '' : `<details ${who.ckey ? 'open' : ''}><summary>${esc(L('Claiming for a company on the hub?', '为星际企业中心的公司登记？'))}</summary>
          <p class="note">${esc(L('Enter its register key and edit code: the lot is linked to the company page and the building carries its name.', '填写公司的登记号和编辑码：地块会关联到公司主页。'))}</p>
          <label>${esc(L('Register key', '登记号'))}<input type="text" name="ckey" value="${esc(who.ckey)}" placeholder="company-…"></label>
          <label>${esc(L('Edit code', '编辑码'))}<input type="text" name="ccode" value="${esc(who.ccode)}" placeholder="XXXX-XXXX-XXXX-XXXX"></label></details>
        <label>${esc(L('Private contact, only for the Land Office', '私人联系方式，仅土地登记处可见'))} <small>${esc(L('optional: helps if you lose your edit code', '可选：丢失编辑码时用于核实'))}</small><input type="text" name="contact" maxlength="100" value="${esc(who.contact)}"></label>`}`;
      else inner = `
        <div class="summary"><p><b>${esc(a.line)}</b> · ${l.id}<br><small>${esc(a.between)}</small></p>
        <p>${esc(typeName(b.type))}${b.type === 'garden' ? '' : esc(L(` · ${b.floors} floors`, ` · ${b.floors} 层`))}${b.sign ? ` · “${esc(b.sign)}”` : ''}<br>${esc(L('Holder', '持有人'))}: <b>${esc(who.holder)}</b>${who.motto ? `<br><i>${esc(who.motto)}</i>` : ''}</p></div>
        <ul class="rules note"><li>${esc(L('One lot per person, please. Lots are free and stay yours until you give them up.', '每人请登记一块。土地免费，在你放弃之前一直归你。'))}</li>
        <li>${esc(L('Names, lines and signs are public. Keep them friendly; the Land Office removes anything that is not.', '名称、留言和招牌都会公开，请保持友善；不当内容会被土地登记处移除。'))}</li>
        <li>${esc(L('You get an edit code once. Keep it: it is the only way to change your building or give up the lot.', '编辑码只显示一次，请保存：这是修改建筑或放弃地块的唯一凭证。'))}</li></ul>
        <div class="ts"></div>`;
      dlg.innerHTML = `<div class="claim-card"><button class="x" data-x aria-label="${esc(L('Close', '关闭'))}">×</button>
        <p class="eyebrow">${esc(edit ? L('Change building', '修改建筑') : L('Land claim', '土地登记'))} · ${l.id}</p><h2>${esc(a.line)}</h2>
        <ol class="steps">${steps}</ol><form class="claim-form" novalidate>${inner}<p class="err" role="alert"></p>
        <div class="actions">${step > 1 ? `<button type="button" class="btn" data-back>${esc(L('Back', '上一步'))}</button>` : ''}<button type="submit" class="btn btn-primary">${esc(step < 3 ? L('Next', '下一步') : edit ? L('Save changes', '保存修改') : L('Claim the lot', '登记这块地'))}</button></div></form></div>`;
      const form = dlg.querySelector('form');
      form.addEventListener('input', e => {
        const f = new FormData(form);
        if (step === 1) {
          b = cleanBuilding(plan, l.zone, { type: f.get('type') || b.type, floors: f.get('floors') ?? b.floors, color: f.get('color') || b.color, accent: f.get('accent') || b.accent, roof: f.get('roof') || b.roof, sign: f.get('sign') ?? b.sign });
          showPreview(id, b);
          if (e.target.name === 'type') draw(); else { const o = form.querySelector('output'); if (o) o.textContent = b.floors; }
        } else if (step === 2) for (const k of Object.keys(who)) if (f.has(k)) who[k] = String(f.get(k));
      });
      dlg.querySelector('[data-back]')?.addEventListener('click', () => { step--; draw(); });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const err = form.querySelector('.err'); err.textContent = '';
        if (step === 2 && !who.holder.trim()) { err.textContent = L('Please give a holder name.', '请填写持有人名称。'); return; }
        if (step < 3) { step++; draw(); if (step === 3) prefetchToken(); return; }
        const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = L('Filing…', '正在登记…');
        try {
          const tok = await tokenPromise;
          const body = { city: plan.city, lot: id, holder: who.holder.trim(), motto: who.motto.trim(), building: b, turnstile: tok };
          let out;
          if (edit) out = await desk('/land/update', { ...body, ...(await credFor(id)) });
          else out = await desk('/land/claim', { ...body, contact: who.contact.trim() || undefined, company: who.ckey.trim() ? { key: who.ckey.trim(), code: who.ccode.trim() } : undefined });
          remember(id, { code: out.code || code || mine[id]?.code, record: out.record, at: Date.now() });
          reg.lots[id] = { ...out.record };
          await afterChange(id);
          showDone(id, out.code, edit);
        } catch (ex) {
          err.textContent = ex.message; btn.disabled = false; btn.textContent = edit ? L('Save changes', '保存修改') : L('Claim the lot', '登记这块地');
          prefetchToken();
        }
      });
    };
    let tokenPromise = null;
    const prefetchToken = () => { const box = dlg.querySelector('.ts'); tokenPromise = token(box || document.createElement('div')); tokenPromise.catch(() => {}); };
    draw();
  }
  function showDone(id, code, edit) {
    const l = plan.byId.get(id), a = lotAddress(plan, l, lang);
    dlg.className = 'claim done';
    dlg.innerHTML = `<div class="claim-card"><button class="x" data-x aria-label="${esc(L('Close', '关闭'))}">×</button>
      <p class="eyebrow">${esc(L('Land Office', '土地登记处'))} · ${id}</p><h2>${esc(edit ? L('Saved', '已保存') : L('Welcome to Procyon City', '欢迎来到南河城'))}</h2>
      <p>${esc(edit ? L('Your building is updated. Others see it within a minute or two.', '建筑已更新，其他人一两分钟内就能看到。') : L(`${a.line} is yours. Everyone sees your building in the city within a minute or two.`, `${a.line} 归你了。一两分钟内所有人都能在城市里看到你的建筑。`))}</p>
      ${code ? `<div class="code-box"><span class="lab">${esc(L('Your edit code: keep it safe', '你的编辑码：请妥善保存'))}</span><code>${esc(code)}</code><button class="btn" data-copy>${esc(L('Copy', '复制'))}</button>
      <p class="note">${esc(L('This browser remembers it too, but it is the only way to change or give up the lot from anywhere else. It is on your deed poster as well.', '这个浏览器也会记住它，但在其他地方修改或放弃地块只能靠它。'))}</p></div>` : ''}
      ${code ? `<div class="actions">${keyButtons([id])}</div><div class="ts"></div><p class="note key-note" role="status"></p>` : ''}
      <div class="actions"><button class="btn btn-primary" data-deed>${esc(L('Get the deed poster', '获取地契海报'))}</button><button class="btn" data-share>${esc(L('Copy link to share', '复制分享链接'))}</button></div></div>`;
    wireKeys([id], dlg);
    dlg.querySelector('[data-copy]')?.addEventListener('click', async e => { try { await navigator.clipboard.writeText(code); e.target.textContent = L('Copied', '已复制'); } catch {} });
    dlg.querySelector('[data-deed]').addEventListener('click', e => saveDeed(id, e.target));
    dlg.querySelector('[data-share]').addEventListener('click', e => copyLink(id, e.target));
  }
  function openCode(id, prefill = '') {
    dlg.hidden = false; dlg.className = 'claim';
    dlg.innerHTML = `<div class="claim-card"><button class="x" data-x aria-label="${esc(L('Close', '关闭'))}">×</button><p class="eyebrow">${id}</p><h2>${esc(L('Enter your edit code', '输入编辑码'))}</h2>
      <form class="claim-form"><label>${esc(L('Edit code', '编辑码'))}<input type="text" name="code" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" value="${esc(prefill)}"></label><div class="ts"></div><p class="err" role="alert"></p>
      <div class="actions"><button class="btn btn-primary" type="submit">${esc(L('Check', '核对'))}</button>${passkeySupported() ? `<button class="btn" type="button" data-pk>${esc(L('Use a passkey instead', '改用通行密钥'))}</button>` : ''}</div></form></div>`;
    dlg.querySelector('[data-pk]')?.addEventListener('click', () => openPasskeySignIn(id));
    const form = dlg.querySelector('form');
    let tp = token(dlg.querySelector('.ts')); tp.catch(() => {});
    // arriving from a transfer link: check the code as soon as the human check is done
    if (prefill) tp.then(() => form.requestSubmit()).catch(() => {});
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const code = String(new FormData(form).get('code') || '').trim();
      try {
        const out = await desk('/land/verify', { city: plan.city, lot: id, code, turnstile: await tp });
        remember(id, { code, record: out.record, passkeys: out.passkeys, at: 0 });
        dlg.hidden = true; renderPanel(); recolor();
        if (prefill) api.selectId(id);
      } catch (ex) { form.querySelector('.err').textContent = ex.message; tp = token(dlg.querySelector('.ts')); tp.catch(() => {}); }
    });
  }
  function openRelease(id) {
    dlg.hidden = false; dlg.className = 'claim';
    dlg.innerHTML = `<div class="claim-card"><button class="x" data-x aria-label="${esc(L('Close', '关闭'))}">×</button><p class="eyebrow">${id}</p><h2>${esc(L('Give up this lot?', '放弃这块地？'))}</h2>
      <p>${esc(L('Your building is taken down and the lot becomes free for someone else. This cannot be undone.', '你的建筑会被拆除，地块将空出给别人。此操作无法撤销。'))}</p>
      <form class="claim-form"><label>${esc(L(`Type ${id} to confirm`, `输入 ${id} 以确认`))}<input type="text" name="confirm" autocomplete="off"></label><div class="ts"></div><p class="err" role="alert"></p>
      <div class="actions"><button class="btn" type="button" data-x>${esc(L('Keep it', '保留'))}</button><button class="btn btn-primary" type="submit">${esc(L('Give it up', '放弃'))}</button></div></form></div>`;
    const form = dlg.querySelector('form');
    let tp = token(dlg.querySelector('.ts')); tp.catch(() => {});
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (String(new FormData(form).get('confirm')).trim().toUpperCase() !== id) { form.querySelector('.err').textContent = L('That is not the lot number.', '地块号不对。'); return; }
      try {
        await desk('/land/release', { city: plan.city, lot: id, ...(await credFor(id)), turnstile: await tp });
        delete reg.lots[id]; mine[id] = { released: Date.now() }; saveMine(mine);
        dlg.hidden = true; await afterChange(id);
      } catch (ex) { form.querySelector('.err').textContent = ex.message; tp = token(dlg.querySelector('.ts')); tp.catch(() => {}); }
    });
  }
  dlg.addEventListener('click', e => { if (e.target.closest('[data-x]')) closeDialog(); });
  function closeDialog() { dlg.hidden = true; dlg.innerHTML = ''; clearPreview(); const beam = marker?.getObjectByName('beam'); if (beam) beam.visible = true; }

  async function afterChange() {
    status = ringStatus(plan, { lots: Object.fromEntries(plan.lots.map(l => [l.id, record(l.id)]).filter(([, r]) => r)) });
    clearPreview(false); buildBuildings(); buildOverlay(); await buildStreets(); buildLabels(); renderPanel();
  }

  // ---------------------------------------------------------------- lifecycle
  const api = {
    get active() { return active; },
    enter() {
      active = true; for (const o of [overlay, outline, labels]) if (o) o.visible = true;
      if (!selected) overview();
      renderPanel();
    },
    exit() { active = false; for (const o of [overlay, outline, labels]) if (o) o.visible = false; hover = -1; canvas.style.cursor = ''; },
    update() {
      if (!tween) return;
      // wall-clock based, so a slow device still arrives on time
      const t = Math.min(1, (performance.now() - tween.start) / 1000 / tween.secs);
      const k = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      camera.position.lerpVectors(tween.p0, tween.p1, k); orbit.target.lerpVectors(tween.t0, tween.t1, k);
      if (t >= 1) tween = null;
    },
    setNight(n) { mats.wall.emissiveIntensity = n * 1.1; mats.glass.emissiveIntensity = n * 0.9; mats.plant.emissiveIntensity = n * 0.5; },
    // a transfer link (#…&key=A17.CODE): open that lot and check the code
    importKey(k) { const l = plan?.byId.get(k.lot); if (!l) return; select(l, true); openCode(l.id, k.code); },
    importKeys(ks) { ks = (ks || []).filter(k => plan?.byId.get(k.lot)); if (ks.length === 1) api.importKey(ks[0]); else if (ks.length) openImport(ks); },
    manage: () => openManage(),
    setCompany(c) { forCompany = c && c.key ? { key: String(c.key), code: String(c.code || ''), name: String(c.name || '') } : null; if (plan) renderPanel(); },
    selectId(id) { const l = plan?.byId.get(String(id).toUpperCase()); if (l) select(l, true); },
    dispose() {
      disposed = true; scene.remove(root);
      root.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); });
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointermove', onMove);
      clearInterval(timer);
    },
    ready: null,
  };
  let timer = null, forCompany = null;
  api.ready = (async () => {
    const res = await fetch(new URL('../' + spec.plan, import.meta.url));
    plan = readPlan(await res.json());
    await fetchRegistry();
    if (disposed) return;
    await buildStreets(); buildOverlay(); buildLabels(); buildBuildings(); renderPanel();
    // the register changes as others claim: refresh every two minutes
    timer = setInterval(async () => { if (dlg.hidden) { await fetchRegistry(); await afterChange(); } }, 120000);
  })();
  return api;
}
