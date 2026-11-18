// Protocolo del eBadge E87: framing Jieli RCSP (ae01/ae02) + canal QIX (fd02/fd01/fd03),
// autenticacion E1 y subida de archivo "grande". CONFIRMED en notes/protocolo-e87.md.
import { getEncryptedAuthData } from './e1.js';

// ---------- utilidades ----------
export function crc16(data) {           // CRC-16/XMODEM (poly 0x1021, init 0)
  let c = 0;
  for (const x of data) {
    c ^= x << 8;
    for (let i = 0; i < 8; i++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c & 0xffff;
}
const hex = u => [...u].map(x => x.toString(16).padStart(2, '0')).join('');
const cat = arrs => { const n = arrs.reduce((s, a) => s + a.length, 0); const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };

// Cola asincrona de notificaciones (Uint8Array). app.js hace push; el protocolo hace get().
export class ByteQueue {
  constructor() { this.items = []; this.waiters = []; }
  push(u) { const w = this.waiters.shift(); if (w) w(u); else this.items.push(u); }
  get(timeout = 8000) {
    if (this.items.length) return Promise.resolve(this.items.shift());
    return new Promise((res, rej) => {
      const t = setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) this.waiters.splice(i, 1); rej(new Error('timeout esperando notificacion')); }, timeout);
      const w = u => { clearTimeout(t); res(u); };
      this.waiters.push(w);
    });
  }
}

// ---------- framing RCSP ----------
export function rcspFrame(flag, op, payload) {
  const len = payload.length;
  return Uint8Array.from([0xFE, 0xDC, 0xBA, flag, op, (len >> 8) & 0xff, len & 0xff, ...payload, 0xEF]);
}

// Lee tramas RCSP de un flujo de notificaciones (pueden venir fragmentadas o varias por notificacion).
export class RcspReader {
  constructor(queue) { this.q = queue; this.buf = new Uint8Array(0); this.frames = []; }
  async next(timeout = 8000) {
    while (!this.frames.length) {
      const chunk = await this.q.get(timeout);
      this.buf = cat([this.buf, chunk]);
      this._parse();
    }
    return this.frames.shift();
  }
  _parse() {
    let b = this.buf, i = 0;
    while (true) {
      const j = indexOf(b, [0xFE, 0xDC, 0xBA], i);
      if (j < 0 || j + 7 > b.length) break;
      const flag = b[j + 3], op = b[j + 4], len = (b[j + 5] << 8) | b[j + 6];
      if (j + 7 + len + 1 > b.length) { i = j; break; }     // trama incompleta: esperar mas
      const payload = b.slice(j + 7, j + 7 + len);
      this.frames.push({ flag, op, payload });
      i = j + 8 + len;
    }
    this.buf = b.slice(i);
  }
}
function indexOf(hay, needle, from) {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let k = 0; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer;
    return i;
  }
  return -1;
}

// ---------- framing QIX ----------
export function qixFrame(cmd, payload, seq) {
  const len = payload.length;
  const multi = (len + 6 > 20) ? 1 : 0;
  const flags = ((seq & 0xf) << 3) | (multi << 2) | 0x02;   // b1b0=10 observado; resp=0
  const body = [flags, cmd, len & 0xff, (len >> 8) & 0xff, ...payload];
  let chk = 0; for (const x of body) chk = (chk + x) & 0xff;
  return Uint8Array.from([0x9E, chk, ...body]);
}

// ---------- sesion de alto nivel ----------
export class BadgeSession {
  // io: { rcspWrite(u8), qixWrite(u8), rcspQ: ByteQueue, qixQ: ByteQueue }
  constructor(io, log = () => {}) {
    this.io = io; this.log = log;
    this.sn = 1; this.qseq = 0;
    this.reader = new RcspReader(io.rcspQ);
  }
  _sn() { const s = this.sn; this.sn = (this.sn + 1) & 0xff; return s; }
  _tx(flag, op, payload) { const f = rcspFrame(flag, op, payload); this.io.rcspWrite(f); return f; }
  _qix(cmd, payload) { const f = qixFrame(cmd, payload, this.qseq); this.qseq = (this.qseq + 1) & 0xf; this.io.qixWrite(f); return f; }

  // Autenticacion E1 (cruda, sin framing RCSP, por ae01/ae02).
  // Paso 1 nos dice si nuestro cifrado (SAFER+/E1, validado en el E87 AC697N) es el del badge.
  // Si NO cuadra (otra variante, p.ej. el cifrado propio del AC707N), respondemos a su reto por
  // "reflexion": se lo devolvemos como reto nuestro y el badge mismo calcula la respuesta que espera
  // (tecnica documentada para el ZNP Z01, otro badge JieLi: github.com/devniz/znp-re PROTOCOL.md §4).
  async authenticate() {
    const rand = crypto.getRandomValues(new Uint8Array(16));
    this.io.rcspWrite(cat([Uint8Array.of(0x00), rand]));          // 00 + reto
    const resp = await this.io.rcspQ.get();                        // 01 + E1(reto)
    const exp = getEncryptedAuthData(cat([Uint8Array.of(0x00), rand]));
    const ok = resp.length >= 17 && hex(resp.slice(0, 17)) === hex(exp);
    this.authMode = ok ? 'safer+' : 'reflexion';
    this.log(`reto app -> badge: ${ok ? 'VERIFICADO (SAFER+)' : 'no es SAFER+ (' + hex(resp) + ') -> se usara reflexion'}`);
    this.io.rcspWrite(Uint8Array.of(0x02, 0x70, 0x61, 0x73, 0x73)); // 02 "pass"
    const chal = await this.io.rcspQ.get();                         // 00 + reto del badge
    if (chal[0] !== 0x00) throw new Error('reto del badge inesperado: ' + hex(chal));
    let answer;
    if (ok) {
      answer = getEncryptedAuthData(chal.slice(0, 17));             // 01 + E1(reto), camino validado
    } else {
      this.io.rcspWrite(chal.slice(0, 17));                         // le devolvemos su reto: 00 + C
      const refl = await this.io.rcspQ.get();                       // 01 + E(C) calculado por el badge
      if (refl[0] !== 0x01 || refl.length < 17) throw new Error('reflexion rechazada: ' + hex(refl));
      answer = refl.slice(0, 17);
    }
    this.io.rcspWrite(answer);
    const pass = await this.io.rcspQ.get();                         // 02 "pass"
    if (pass[0] !== 0x02) throw new Error('el badge no acepto la auth: ' + hex(pass));
    this.log(`autenticacion OK (${this.authMode})`);
    return true;
  }

  // Espera una trama RCSP-respuesta (flag 0x00) con el opcode dado.
  async _waitResp(op, timeout = 8000) {
    while (true) {
      const f = await this.reader.next(timeout);
      if (f.op === op && (f.flag & 0x80) === 0) return f;
      // ignora otras tramas intermedias
    }
  }

  // Handshake minimo tras auth (replica lo observado; best-effort).
  async boot() {
    try {
      this._tx(0xC0, 0x03, Uint8Array.of(this._sn(), 0xFF, 0xFF, 0xFF, 0xFF, 0x00)); // GetTargetInfo
      await this._waitResp(0x03, 4000).catch(() => {});
      const d = new Date(), y = d.getFullYear();
      this._tx(0xC0, 0x08, Uint8Array.of(this._sn(), 0x02, 0x08, 0x00, (y >> 8) & 0xff, y & 0xff,
        d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()));           // hora
      await this._waitResp(0x08, 4000).catch(() => {});
      this.log('boot RCSP OK');
    } catch (e) { this.log('boot (ignorado): ' + e.message); }
  }

  // Avisa por QIX de que va un archivo de tipo BADGE (DC 0C). CONFIRMED: 9E 0B 22 DC 01 00 0C.
  setFileTypeBadge() { this._qix(0xDC, Uint8Array.of(0x0C)); this.log('QIX DC 0C (BADGE) enviado'); }

  // Sube un archivo con la transferencia "grande". finalName p.ej. "f_<ts>.jpg".
  async uploadFile(data, finalName, onProgress = () => {}) {
    const crcFile = crc16(data);
    const tmp = randTmp();
    this.log(`subiendo ${data.length} B, crc=0x${crcFile.toString(16)}, tmp=${tmp}, nombre=${finalName}`);

    this._tx(0xC0, 0x21, Uint8Array.of(this._sn(), 0x00));
    await this._waitResp(0x21);
    this._tx(0xC0, 0x27, Uint8Array.of(this._sn(), 0, 0, 0, 0, 0x02, 0x01));
    await this._waitResp(0x27);

    const len = data.length;
    const nameBytes = [...tmp].map(c => c.charCodeAt(0));
    this._tx(0xC0, 0x1B, Uint8Array.of(this._sn(),
      (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff,
      (crcFile >> 8) & 0xff, crcFile & 0xff, ...nameBytes, 0x00));
    const r1b = await this._waitResp(0x1B);
    const mtu = (r1b.payload[2] << 8) | r1b.payload[3];   // 490
    this.log(`mtu de datos = ${mtu} B/paquete`);

    let sent = 0;
    while (true) {
      const f = await this.reader.next();
      if (f.op === 0x1D && (f.flag & 0x80)) {
        const reqLen = (f.payload[2] << 8) | f.payload[3];
        const off = (f.payload[4] << 24) | (f.payload[5] << 16) | (f.payload[6] << 8) | f.payload[7];
        const real = Math.min(reqLen, len - off);
        let idx = 0, pos = 0;
        while (pos < real) {
          const chunk = data.subarray(off + pos, off + pos + Math.min(mtu, real - pos));
          const c = crc16(chunk);
          this._tx(0x80, 0x01, Uint8Array.of(this._sn(), 0x1D, idx, (c >> 8) & 0xff, c & 0xff, ...chunk));
          pos += chunk.length; idx++; sent += chunk.length;
          onProgress(Math.min(sent, len), len);
        }
      } else if (f.op === 0x20 && (f.flag & 0x80)) {       // el badge pide el nombre final
        const sn = f.payload[0];
        const utf16 = []; for (const ch of finalName) { const c = ch.charCodeAt(0); utf16.push(c & 0xff, (c >> 8) & 0xff); }
        this._tx(0x00, 0x20, Uint8Array.of(0x00, sn, 0x5C, 0x55, ...utf16, 0x00, 0x00)); // "\U"+UTF16LE
      } else if (f.op === 0x1C) {                          // fin
        const sn = f.payload[0];
        this._tx(0x00, 0x1C, Uint8Array.of(0x00, sn));
        this.log('subida COMPLETA');
        return true;
      }
    }
  }
}

function randTmp() {
  const h = [...crypto.getRandomValues(new Uint8Array(4))].map(x => x.toString(16).padStart(2, '0')).join('');
  return h + '.tmp';
}
