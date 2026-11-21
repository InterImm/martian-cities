// The land grant poster (地契): a printable, shareable PNG for one lot, drawn on a canvas in the
// paper-and-ink style of the InterImm kit. It carries the lot's address, Mars coordinates, the
// 2219 grant date, a site plan of the whole city with this lot marked, the holder's motto, the
// Land Office seal and a QR code back to the lot in the 3D city.

import qrcode from '../vendor/qrcode.js';
import { lotAddress, lotCorners, lotLatLon, fmtLatLon, storyDate } from './land-plan.js';

const PAPER = '#f4efe4', INK = '#1f1d1b', MUTED = '#6d665e', RULE = '#cfc6b6', RUST = '#9a3c22';
const SERIF = '"Source Serif 4","Noto Serif SC","Songti SC","SimSun",serif';
const SANS = '"IBM Plex Sans","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
const MONO = '"IBM Plex Mono",ui-monospace,monospace';

export function lotUrl(lotId, lang, base = 'https://cities.interimm.org/') {
  return `${base}${lang === 'cn' ? '?lang=cn' : ''}#city=isidis-procyon&plot=${lotId}`;
}

function wrap(g, text, maxW) {
  // break on spaces for latin text, anywhere for CJK
  const out = []; let line = '';
  const tokens = /[　-鿿]/.test(text) ? [...text] : text.split(/(\s+)/);
  for (const t of tokens) {
    if (g.measureText(line + t).width > maxW && line.trim()) { out.push(line.trim()); line = t.trimStart(); } else line += t;
  }
  if (line.trim()) out.push(line.trim());
  for (let i = 1; i < out.length; i++) if (/^[”。，、！？」』）]+$/.test(out[i]) || /^[”。，、！？」』）]/.test(out[i])) { const m = out[i].match(/^[”。，、！？」』）]+/)[0]; out[i - 1] += m; out[i] = out[i].slice(m.length); }
  return out.filter(Boolean);
}

function sitePlan(g, plan, registry, lot, x, y, size) {
  // fit the outermost ring in the box, centred on the core
  const R = Math.max(...plan.rings.map(r => r.r)) + 90, k = size / 2 / R;
  const cx = x + size / 2, cy = y + size / 2;
  const P = ([X, Y]) => [cx + (X - plan.core[0]) * k, cy - (Y - plan.core[1]) * k];
  g.save();
  g.beginPath(); g.rect(x, y, size, size); g.clip();
  // avenues
  g.strokeStyle = RULE; g.lineWidth = 1.2;
  for (const a of plan.avenues) {
    const b = a.bearing * Math.PI / 180;
    g.beginPath(); g.moveTo(cx + Math.sin(b) * 470 * k, cy - Math.cos(b) * 470 * k); g.lineTo(cx + Math.sin(b) * R * k, cy - Math.cos(b) * R * k); g.stroke();
  }
  // all lots, held ones tinted
  const held = registry?.lots || {};
  for (const l of plan.lots) {
    const pts = lotCorners(plan, l).map(P);
    g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath();
    if (l.id === lot.id) continue;
    if (held[l.id]) { g.fillStyle = 'rgba(154,60,34,.35)'; g.fill(); }
    g.strokeStyle = 'rgba(31,29,27,.22)'; g.lineWidth = 0.6; g.stroke();
  }
  // the core
  g.fillStyle = INK; g.beginPath();
  for (let i = 0; i < 8; i++) { const a = (i + 0.5) * Math.PI / 4, px = cx + Math.sin(a) * 175 * k, py = cy - Math.cos(a) * 175 * k; i ? g.lineTo(px, py) : g.moveTo(px, py); }
  g.closePath(); g.fill();
  // this lot, with a leader line to its number
  const pts = lotCorners(plan, lot, 2).map(P);
  g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath();
  g.fillStyle = RUST; g.fill(); g.strokeStyle = INK; g.lineWidth = 1.5; g.stroke();
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const dx = mx - cx, dy = my - cy, d = Math.hypot(dx, dy) || 1, lx = mx + dx / d * 60, ly = my + dy / d * 60;
  g.strokeStyle = RUST; g.lineWidth = 2; g.beginPath(); g.arc(mx, my, 14, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(mx + dx / d * 14, my + dy / d * 14); g.lineTo(lx, ly); g.stroke();
  g.font = `700 26px ${MONO}`; g.fillStyle = RUST; g.textAlign = dx >= 0 ? 'left' : 'right'; g.textBaseline = 'middle';
  g.fillText(lot.id, lx + (dx >= 0 ? 6 : -6), ly);
  // north arrow
  g.restore();
  g.fillStyle = INK; g.font = `600 18px ${SANS}`; g.textAlign = 'center';
  g.beginPath(); g.moveTo(x + size - 26, y + 18); g.lineTo(x + size - 34, y + 42); g.lineTo(x + size - 18, y + 42); g.closePath(); g.fill();
  g.fillText('N', x + size - 26, y + 58);
}

function seal(g, x, y, r, rot) {
  g.save(); g.translate(x, y); g.rotate(rot); g.globalAlpha = 0.85;
  g.strokeStyle = '#b3261e'; g.fillStyle = '#b3261e';
  g.lineWidth = 5; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2; g.beginPath(); g.arc(0, 0, r - 12, 0, Math.PI * 2); g.stroke();
  // ring text, each character given the angle its own width needs, spread evenly round the circle
  const text = '星际移民中心 · 土地登记处 · LAND OFFICE · ';
  g.font = `700 16px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const chars = [...text], rr = r - 25, widths = chars.map(ch => g.measureText(ch).width + 1.5);
  const total = widths.reduce((a, b) => a + b, 0), k = (Math.PI * 2 * rr) / total;
  let a = 0;
  chars.forEach((ch, i) => { const da = widths[i] * k / rr; g.save(); g.rotate(a + da / 2); g.translate(0, -rr); g.fillText(ch, 0, 0); g.restore(); a += da; });
  // five-point star in the middle
  g.beginPath();
  for (let i = 0; i < 10; i++) { const rr = i % 2 ? 11 : 28, a = i * Math.PI / 5; g.lineTo(Math.sin(a) * rr, -Math.cos(a) * rr); }
  g.closePath(); g.fill();
  g.restore();
}

function qr(g, text, x, y, size) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), cell = size / (n + 2);
  g.fillStyle = '#fff'; g.fillRect(x, y, size, size);
  g.fillStyle = INK;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect(x + (c + 1) * cell, y + (r + 1) * cell, Math.ceil(cell), Math.ceil(cell));
}

// record: the lot's entry in the register ({holder, motto, building, granted, ...})
export async function drawDeed({ plan, registry, lot, record, lang = 'en', typeName }) {
  try { await document.fonts?.ready; } catch {}
  const W = 1080, H = 1560, cn = lang === 'cn';
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  // paper
  g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(120,100,70,${Math.random() * 0.05})`; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
  g.strokeStyle = INK; g.lineWidth = 3; g.strokeRect(36, 36, W - 72, H - 72);
  g.lineWidth = 1; g.strokeRect(48, 48, W - 96, H - 96);

  const L = (en, zh) => (cn ? zh : en);
  const addr = lotAddress(plan, lot, lang), addrOther = lotAddress(plan, lot, cn ? 'en' : 'cn');
  const ring = lot.ringInfo, zone = plan.zones[lot.zone];
  const granted = record?.granted || storyDate();

  // header
  g.fillStyle = MUTED; g.font = `600 20px ${SANS}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText(L('INTERIMM · LAND OFFICE · PROCYON CITY, MARS', '星际移民中心 · 土地登记处 · 火星南河城'), 84, 112);
  g.textAlign = 'right'; g.font = `500 20px ${MONO}`;
  g.fillText(`No. PRC-${granted.slice(0, 4)}-${lot.id}`, W - 84, 112);
  g.textAlign = 'left'; g.fillStyle = INK; g.font = `600 64px ${SERIF}`;
  g.fillText(L('Land Grant', '南河城土地证'), 84, 196);
  g.fillStyle = MUTED; g.font = `400 28px ${SERIF}`;
  g.fillText(L('南河城土地证', 'Procyon City Land Grant'), 84, 240);
  g.fillStyle = RUST; g.fillRect(84, 262, 120, 5);

  // holder
  g.fillStyle = MUTED; g.font = `500 20px ${SANS}`;
  g.fillText(L('GRANTED TO', '土地持有人'), 84, 318);
  g.fillStyle = INK; g.font = `600 52px ${SERIF}`;
  g.fillText(record?.holder || '—', 84, 378);

  // facts, two columns
  const facts = [
    [L('Address', '地址'), addr.line, addr.between],
    [L('Also written', '另写作'), addrOther.line, ''],
    [L('Zone', '用地分区'), cn ? zone.name_cn : zone.name, `${lot.area.toLocaleString()} m²`],
    [L('Coordinates', '坐标'), fmtLatLon(lotLatLon(plan, lot)), L('Isidis Plain, Mars', '火星伊希地平原')],
    [L('Ring', '环路'), `${cn ? ring.name_cn : ring.name} · ${ring.year}`, cn ? ring.note_cn : ring.note],
    [L('Granted', '登记日期'), `${granted} ${L('(story calendar)', '（故事纪年）')}`, record?.granted_earth ? L(`Earth date ${record.granted_earth}`, `地球日期 ${record.granted_earth}`) : ''],
  ];
  if (record?.building) facts.push([L('Building', '建筑'), `${typeName || record.building.type}${record.building.type === 'garden' ? '' : L(` · ${record.building.floors} floors`, ` · ${record.building.floors} 层`)}`, record.building.sign ? `“${record.building.sign}”` : '']);
  let fy = 430;
  facts.forEach(([k, v1, v2], i) => {
    const col = i % 2, x = 84 + col * 470, y = fy + Math.floor(i / 2) * 96;
    g.fillStyle = MUTED; g.font = `500 18px ${SANS}`; g.fillText(k.toUpperCase(), x, y);
    g.fillStyle = INK; g.font = `600 26px ${SERIF}`; g.fillText(v1, x, y + 34);
    g.fillStyle = MUTED; g.font = `400 18px ${SANS}`;
    const lines = wrap(g, v2 || '', 430); lines.slice(0, 2).forEach((ln, j) => g.fillText(ln, x, y + 60 + j * 22));
  });
  fy += Math.ceil(facts.length / 2) * 96 + 6;
  g.strokeStyle = RULE; g.lineWidth = 1; g.beginPath(); g.moveTo(84, fy); g.lineTo(W - 84, fy); g.stroke();

  // site plan
  const ps = 480; sitePlan(g, plan, registry, lot, 84, fy + 28, ps);
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = MUTED; g.font = `500 18px ${SANS}`;
  g.fillText(L('SITE PLAN · the city in its eight rings', '总平面图 · 南河城八环'), 84, fy + ps + 60);

  // motto + qr + seal on the right
  const rx = 84 + ps + 40, rw = W - 84 - rx;
  if (record?.motto) {
    g.fillStyle = INK; g.font = `italic 400 26px ${SERIF}`;
    wrap(g, `“${record.motto}”`, rw).slice(0, 4).forEach((ln, j) => g.fillText(ln, rx, fy + 64 + j * 36));
  }
  seal(g, rx + 110, fy + 270, 96, -0.18);
  const url = lotUrl(lot.id, lang);
  const qs = 170; qr(g, url, rx + rw - qs, fy + ps - qs + 28, qs);
  g.fillStyle = MUTED; g.font = `500 17px ${SANS}`; g.textAlign = 'right';
  g.fillText(L('Scan to visit this lot in 3D', '扫码在 3D 城市中参观这块地'), rx + rw, fy + ps + 60);
  g.textAlign = 'left';

  // fine print
  g.fillStyle = MUTED; g.font = `400 17px ${SANS}`;
  const fine = L('This grant belongs to the InterImm story world, set in the year 2219. Plots are free and the register is public: interimm.org/hub',
    '本证书属于 InterImm 故事世界，故事设定在 2219 年。土地免费登记，登记簿公开：interimm.org/hub');
  wrap(g, fine, W - 168).forEach((ln, j) => g.fillText(ln, 84, H - 110 + j * 24));
  return c;
}
