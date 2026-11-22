// Keys to a lot: the edit code as a downloadable key card (PNG with a transfer QR) or text file,
// the transfer link that moves a lot to another device, and passkeys (WebAuthn).
//
// The transfer link carries the code in the address fragment (#…&key=A17.CODE), which browsers
// never send to a server; the explorer reads it, checks it with the desk and removes it.
// Passkeys: the device keeps the private key and syncs it (iCloud Keychain, Google Password
// Manager, a password manager); the desk keeps only the public key. Each passkey's user handle
// is "<city>:<lot>", so signing in needs no lot number.

import qrcode from '../vendor/qrcode.js';
import { lotAddress } from './land-plan.js';

const PAPER = '#f4efe4', INK = '#1f1d1b', MUTED = '#6d665e', RULE = '#cfc6b6', RUST = '#9a3c22';
const SERIF = '"Source Serif 4","Noto Serif SC","Songti SC","SimSun",serif';
const SANS = '"IBM Plex Sans","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
const MONO = '"IBM Plex Mono",ui-monospace,monospace';

export function transferUrl(city, lotId, code, lang, base = 'https://cities.interimm.org/') {
  return `${base}${lang === 'cn' ? '?lang=cn' : ''}#city=${city}&key=${lotId}.${String(code).replace(/[^0-9A-Za-z]/g, '')}`;
}

// "A17.K7QXM2PA9TRDH4EW" -> { lot: 'A17', code: 'K7QX-M2PA-9TRD-H4EW' }
export function parseKey(s) {
  const m = /^([A-Za-z]\d{1,4})\.([0-9A-Za-z]{16})$/.exec(String(s || '').trim());
  return m ? { lot: m[1].toUpperCase(), code: m[2].toUpperCase().match(/.{4}/g).join('-') } : null;
}

export function keyText({ plan, lot, code, lang }) {
  const a = lotAddress(plan, lot, lang), url = transferUrl(plan.city, lot.id, code, lang);
  return lang === 'cn'
    ? `南河城土地登记处 · 钥匙\n\n地块 ${lot.id}，${a.line}（${a.between}）\n编辑码：${code}\n\n在另一台设备上打开这个链接即可转移：\n${url}\n\n请勿分享：拿到编辑码的人可以修改或放弃这块地。\n`
    : `Procyon City Land Office · key\n\nLot ${lot.id}, ${a.line} (${a.between})\nEdit code: ${code}\n\nOpen this link on another device to move the lot there:\n${url}\n\nKeep it private: anyone with the code can change or give up the lot.\n`;
}

// A 1080 x 1350 key card: address, code, and a QR code with the transfer link.
export async function drawKeyCard({ plan, lot, code, holder, lang }) {
  try { await document.fonts?.ready; } catch {}
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), cn = lang === 'cn', a = lotAddress(plan, lot, lang);
  g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
  g.strokeStyle = INK; g.lineWidth = 3; g.strokeRect(40, 40, W - 80, H - 80);
  g.strokeStyle = RULE; g.lineWidth = 1; g.strokeRect(52, 52, W - 104, H - 104);
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.fillStyle = RUST; g.font = `600 22px ${SANS}`; g.fillText(cn ? '南河城土地登记处 · 钥匙卡' : 'PROCYON CITY LAND OFFICE · KEY CARD', 96, 130);
  g.fillStyle = INK; g.font = `600 64px ${SERIF}`; g.fillText(a.line, 96, 214);
  g.fillStyle = MUTED; g.font = `400 28px ${SERIF}`; g.fillText(`${lot.id} · ${a.between}`, 96, 262);
  if (holder) { g.fillStyle = INK; g.font = `500 28px ${SANS}`; g.fillText((cn ? '持有人 ' : 'Holder ') + holder, 96, 312); }
  // the code
  g.strokeStyle = RUST; g.setLineDash([10, 8]); g.lineWidth = 2; g.strokeRect(96, 350, W - 192, 150); g.setLineDash([]);
  g.fillStyle = MUTED; g.font = `500 22px ${SANS}`; g.fillText(cn ? '编辑码' : 'EDIT CODE', 124, 394);
  g.fillStyle = RUST; g.font = `600 60px ${MONO}`; g.fillText(code, 124, 466);
  // QR with the transfer link
  const qr = qrcode(0, 'M'); qr.addData(transferUrl(plan.city, lot.id, code, lang)); qr.make();
  const n = qr.getModuleCount(), size = 440, cell = Math.floor(size / (n + 8)), qs = cell * (n + 8), qx = (W - qs) / 2, qy = 560;
  g.fillStyle = '#fff'; g.fillRect(qx, qy, qs, qs); g.fillStyle = INK;
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) g.fillRect(qx + (k + 4) * cell, qy + (r + 4) * cell, cell, cell);
  g.textAlign = 'center'; g.fillStyle = INK; g.font = `600 30px ${SANS}`;
  g.fillText(cn ? '用另一台设备扫码，地块就会转移过去' : 'Scan with another device to move the lot there', W / 2, qy + qs + 56);
  g.fillStyle = RUST; g.font = `600 26px ${SANS}`;
  g.fillText(cn ? '请勿分享：拿到这张卡的人可以修改或放弃这块地' : 'Keep private: whoever holds this card can change or give up the lot', W / 2, H - 120);
  return c;
}

export function download(name, blobOrUrl) {
  const a = document.createElement('a');
  a.href = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------------- passkeys ---------------- */

export function passkeySupported() {
  return !!(window.PublicKeyCredential && navigator.credentials?.create && window.isSecureContext);
}

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(t + '==='.slice((t.length + 3) % 4)), ch => ch.charCodeAt(0)); };
const enc = s => new TextEncoder().encode(s);

export async function createPasskey({ challenge, rpId, city, lot, label, holder }) {
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: enc(challenge),
    rp: { id: rpId, name: 'InterImm Land Office' },
    user: { id: enc(`${city}:${lot}`), name: `${lot} · ${label}`, displayName: holder || label },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    attestation: 'none', timeout: 120000,
  } });
  const r = cred.response;
  if (!r.getPublicKey || !r.getPublicKeyAlgorithm) throw new Error('unsupported');
  return { id: cred.id, spki: b64url(r.getPublicKey()), alg: r.getPublicKeyAlgorithm(), clientDataJSON: b64url(r.clientDataJSON), name: deviceName() };
}

// With no lot given, the browser offers every passkey this site has on the device.
export async function getPasskey({ challenge, rpId, ids }) {
  const cred = await navigator.credentials.get({ publicKey: {
    challenge: enc(challenge), rpId, userVerification: 'preferred', timeout: 120000,
    ...(ids?.length ? { allowCredentials: ids.map(id => ({ type: 'public-key', id: unb64url(id) })) } : {}),
  } });
  const r = cred.response, handle = r.userHandle ? new TextDecoder().decode(r.userHandle) : '';
  const [city, lot] = handle.split(':');
  return { city, lot, assertion: { id: cred.id, clientDataJSON: b64url(r.clientDataJSON), authenticatorData: b64url(r.authenticatorData), signature: b64url(r.signature) } };
}

function deviceName() {
  const ua = navigator.userAgent;
  return /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'device';
}
