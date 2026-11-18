// E1 de Bluetooth (SAFER+) para la autenticacion del eBadge E87.
// Port del modulo validado tools/e1_e87.py. Sin dependencias; apto para Web Bluetooth.
// getEncryptedAuthData(msg17) -> Uint8Array(17) = 0x01 || E1(R), R = msg17[1..16].

const KEY  = Uint8Array.from([0x06,0x77,0x5f,0x87,0x91,0x8d,0xd4,0x23,0x00,0x5d,0xf1,0xd8,0xcf,0x0c,0x14,0x2b]);
const ADDR = Uint8Array.from([0x11,0x22,0x33,0x33,0x22,0x11]);

const EXP = new Uint8Array(256), LOG = new Uint8Array(256);
(() => { let v = 1; for (let i = 0; i < 256; i++) { EXP[i] = v & 0xff; v = (v * 45) % 257; } for (let i = 0; i < 256; i++) LOG[EXP[i]] = i; })();

const XOR_IDX = new Set([0,3,4,7,8,11,12,15]);
const P = [8,11,12,15,2,1,6,5,10,9,14,13,0,7,4,3];
const e257 = x => { let r = 1 % 257; let base = 45 % 257; let e = x; while (e > 0) { if (e & 1) r = (r * base) % 257; base = (base * base) % 257; e >>= 1; } return r & 0xff; };

function keysched(key16) {
  const k = new Array(17); for (let i = 0; i < 16; i++) k[i] = key16[i];
  let par = 0; for (let i = 0; i < 16; i++) par ^= key16[i]; k[16] = par;
  const out = new Uint8Array(272); out.set(key16, 0);
  for (let i = 2; i <= 17; i++) {
    for (let j = 0; j < 17; j++) k[j] = ((k[j] << 3) | (k[j] >> 5)) & 0xff;
    for (let j = 0; j < 16; j++) out[(i - 1) * 16 + j] = (k[(i - 1 + j) % 17] + e257(e257(17 * i + j + 1))) & 0xff;
  }
  return out;
}

function linear(b) {
  for (let it = 0; it < 4; it++) {
    const o = new Array(16);
    for (let j = 0; j < 8; j++) { const x = b[2*j], y = b[2*j+1]; o[2*j] = (2*x + y) & 0xff; o[2*j+1] = (x + y) & 0xff; }
    b = (it < 3) ? P.map(p => o[p]) : o;
  }
  return b;
}

function roundFn(b, sk, off) {
  b = b.slice();
  for (let j = 0; j < 16; j++) b[j] = XOR_IDX.has(j) ? (b[j] ^ sk[off+j]) : (b[j] + sk[off+j]) & 0xff;
  for (let j = 0; j < 16; j++) b[j] = XOR_IDX.has(j) ? EXP[b[j]] : LOG[b[j]];
  for (let j = 0; j < 16; j++) b[j] = XOR_IDX.has(j) ? (b[j] + sk[off+16+j]) & 0xff : (b[j] ^ sk[off+16+j]);
  return linear(b);
}

function encrypt(block16, sk, feedfwd) {
  let b = Array.from(block16); const saved = Array.from(block16);
  for (let r = 0; r < 8; r++) {
    if (feedfwd && r === 2)
      for (let j = 0; j < 16; j++) b[j] = XOR_IDX.has(j) ? (b[j] ^ saved[j]) : (b[j] + saved[j]) & 0xff;
    b = roundFn(b, sk, 32 * r);
  }
  for (let j = 0; j < 16; j++) b[j] = XOR_IDX.has(j) ? (b[j] ^ sk[256+j]) : (b[j] + sk[256+j]) & 0xff;
  return Uint8Array.from(b);
}

function ktilde(k) {
  const off = [[233,0],[229,1],[223,0],[193,1],[179,0],[167,1],[149,0],[131,1],[233,1],[229,0],[223,1],[193,0],[179,1],[167,0],[149,1],[131,0]];
  const o = new Uint8Array(16);
  for (let i = 0; i < 16; i++) o[i] = off[i][1] ? (k[i] ^ off[i][0]) : (k[i] + off[i][0]) & 0xff;
  return o;
}

export function e1(rand16, key = KEY, addr = ADDR) {
  const aexp = new Uint8Array(16); for (let i = 0; i < 16; i++) aexp[i] = addr[i % addr.length];
  const a = encrypt(rand16, keysched(key), false);
  const tmp = new Uint8Array(16); for (let i = 0; i < 16; i++) tmp[i] = (aexp[i] + (a[i] ^ rand16[i])) & 0xff;
  return encrypt(tmp, keysched(ktilde(key)), true);
}

export function getEncryptedAuthData(msg17) {
  const out = new Uint8Array(17); out[0] = 0x01; out.set(e1(msg17.slice(1, 17)), 1);
  return out;
}

// Validacion (vectores reales del dispositivo) en scratch/web/test_upload.mjs y tools/e1_e87.py.
// Sin autotest aqui: este modulo se importa tanto en el navegador como en Node.
