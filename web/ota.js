// Cliente OTA de firmware para el E87 por BLE: protocolo Qix 0xC0-0xC5.
// Reimplementado a partir de com.qix.library.sdk.UpdateManager (vía qix-ble de ElectronicCats),
// NO ejecuta su código. Usa el MISMO canal Qix (FD00/FD02) que ya abre app.js tras autenticar.
//
// Trama Qix (igual que rcsp.js qixFrame): 9E · chk=sum(body)&0xFF · flags · cmd · len(LE16) · payload.
// OTA usa flags con bit final |0x01 (el resto de Qix usa |0x02) + serial rotatorio 0..15 + bit "largo".
//
// SEGURIDAD: probe() solo manda REQ_UPDATE (0xC0) y NO escribe NADA en la flash. flash() SÍ reescribe
// el firmware — irreversible sin la imagen OEM de recuperación. app.js pide confirmación para flash().

// --- CRC-CCITT-FALSE (binascii.crc_hqx con init 0xFFFF): valida el wrapper Qix del .ufw ---
export function crc16ccittFalse(data, crc = 0xFFFF) {
  for (const b of data) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc & 0xffff;
}

const JLUFW = [0x4a, 0x4c, 0x55, 0x46, 0x57];   // "JLUFW"

// Valida localmente el .ufw ANTES de tocar BLE (mismo check que validate_qix_wrapper).
export function validateUfw(u) {
  if (u.length < 27 + 16) throw new Error('ufw demasiado corto (' + u.length + ' B)');
  if (u[0] !== 0xbc || u[1] !== 0xaf) throw new Error('magic Qix inválido (no bc af) — ¿es un .ufw con wrapper?');
  if (u[2] !== 0x01) throw new Error('type del wrapper != 0x01 (0x' + u[2].toString(16) + ')');
  const dv = new DataView(u.buffer, u.byteOffset, u.length);
  const declared = dv.getUint32(13, true);
  if (declared !== u.length - 27) throw new Error('size: cabecera dice ' + declared + ', real ' + (u.length - 27));
  const payload = u.subarray(27);
  const want = crc16ccittFalse(payload), got = dv.getUint16(25, true);
  if (want !== got) throw new Error('CRC del wrapper: cabecera 0x' + got.toString(16) + ' vs calculado 0x' + want.toString(16));
  // JLUFW en el payload
  let found = false;
  for (let i = 0; i + 5 <= payload.length && !found; i++) {
    found = JLUFW.every((b, k) => payload[i + k] === b);
  }
  if (!found) throw new Error('magic JLUFW no encontrado en el payload');
  return true;
}

// Lector de tramas Qix desde la cola de notificaciones (pueden venir fragmentadas o varias juntas).
export class QixReader {
  constructor(queue) { this.q = queue; this.buf = new Uint8Array(0); }
  async next(timeout = 8000) {
    for (;;) {
      const f = this._parse();
      if (f) return f;
      const chunk = await this.q.get(timeout);
      const n = new Uint8Array(this.buf.length + chunk.length);
      n.set(this.buf, 0); n.set(chunk, this.buf.length); this.buf = n;
    }
  }
  _parse() {
    let b = this.buf;
    for (;;) {
      const i = b.indexOf(0x9e);
      if (i < 0) { this.buf = new Uint8Array(0); return null; }
      if (i > 0) b = b.subarray(i);
      if (b.length < 6) { this.buf = b.slice(); return null; }
      const len = b[4] | (b[5] << 8);
      const total = 6 + len;
      if (b.length < total) { this.buf = b.slice(); return null; }
      const chk = (b.subarray(2, total).reduce((s, x) => (s + x) & 0xff, 0));
      if (chk !== b[1]) { b = b.subarray(1); continue; }   // 0x9e espurio: saltar 1
      const frame = { flags: b[2], cmd: b[3], payload: b.subarray(6, total).slice() };
      this.buf = b.subarray(total).slice();
      return frame;
    }
  }
}

// --- secuencia de arranque (bootstrap) que el firmware OEM exige antes del OTA ---
// Port byte a byte de qix_ble/bootstrap.py (Phase 1-5). El badge AC707N OEM ignora
// REQ_UPDATE si no se le manda esto primero (set time, screen info, sys info, "ready").
const _sleep = ms => new Promise(r => setTimeout(r, ms));
function _qixRaw(flags, cmd, payload) {
  const body = [flags & 0xff, cmd & 0xff, payload.length & 0xff, (payload.length >> 8) & 0xff, ...payload];
  let chk = 0; for (const x of body) chk = (chk + x) & 0xff;
  return Uint8Array.from([0x9e, chk, ...body]);
}
function _rcspRaw(flag, op, payload) {
  const len = payload.length;
  return Uint8Array.from([0xFE, 0xDC, 0xBA, flag, op, (len >> 8) & 0xff, len & 0xff, ...payload, 0xEF]);
}
export async function runBootstrap(io, log = () => {}) {
  const now = new Date(), U = (...b) => Uint8Array.from(b);
  log('OTA bootstrap: preparando el badge (secuencia Qix previa)…');
  // Phase 1: RCSP 0x06 reset_auth + trigger Qix verbatim
  io.rcspWrite(_rcspRaw(0xC0, 0x06, U(0x02, 0x00, 0x01)));
  try { io.otaWrite(U(0x9E, 0xBD, 0x0B, 0x60, 0x0D, 0x00, 0x03)); } catch {}
  await _sleep(300);
  // Phase 2: set time + display + init
  io.otaWrite(_qixRaw(0x08, 0x02, U(now.getFullYear() & 0xff, (now.getFullYear() >> 8) & 0xff,
    now.getMonth() + 1, now.getDate(), 0x00, now.getHours(), now.getMinutes()))); await _sleep(30);
  io.otaWrite(_qixRaw(0x08, 0x16, U(0x01))); await _sleep(30);
  io.otaWrite(_qixRaw(0x0B, 0x29, U(0x80))); await _sleep(200);
  // Phase 3: getTargetInfo + screen info + 0x20
  io.rcspWrite(_rcspRaw(0xC0, 0x03, U(1, 0xFF, 0xFF, 0xFF, 0xFF, 0x01)));
  io.otaWrite(_qixRaw(0x0B, 0xC6, U(0x01))); await _sleep(30);
  io.otaWrite(_qixRaw(0x08, 0x20, U(0xFF, 0x07))); await _sleep(200);
  // Phase 4: getSysInfo + 0xFF x2
  io.rcspWrite(_rcspRaw(0xC0, 0x07, U(2, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF)));
  io.otaWrite(_qixRaw(0x08, 0xFF, U(0x22, 0x00))); await _sleep(40);
  io.otaWrite(_qixRaw(0x08, 0xFF, U(0x24, 0x00))); await _sleep(200);
  // Phase 5: ready-signal dance
  io.otaWrite(_qixRaw(0x0B, 0x29, U(0x80))); await _sleep(400);
  io.otaWrite(_qixRaw(0x0B, 0xC6, U(0x01))); await _sleep(400);
  io.otaWrite(_qixRaw(0x0B, 0xDC, U(0x0C))); await _sleep(500);
  if (io.rcspQ) io.rcspQ.items.length = 0;
  io.qixQ.items.length = 0;                       // limpiar ecos del bootstrap
  log('OTA bootstrap: completado');
}

// Sonda de throughput: manda tramas Qix (opcode 0xEE, ignorado por el firmware) y mide KB/s reales de FD02.
// No cambia nada en el badge; solo mide la velocidad de escritura BLE para estimar fps.
export async function measureThroughput(io, totalBytes = 64 * 1024, log = () => {}) {
  const CHUNK = 480;
  const filler = new Uint8Array(CHUNK);
  let serial = 0;
  const frame = () => {
    const flags = ((serial << 3) | (1 << 2) | 0x01) & 0xff; serial = (serial + 1) & 0xf;
    const body = [flags, 0xEE, CHUNK & 0xff, (CHUNK >> 8) & 0xff, ...filler];
    let chk = 0; for (const x of body) chk = (chk + x) & 0xff;
    return Uint8Array.from([0x9e, chk, ...body]);
  };
  if (io.qixQ) io.qixQ.items.length = 0;
  const n = Math.ceil(totalBytes / CHUNK);
  const t0 = performance.now();
  for (let i = 0; i < n; i++) await io.otaWrite(frame());
  const dt = (performance.now() - t0) / 1000;
  const bytes = n * (CHUNK + 6);
  const kbps = (bytes / 1024) / dt;
  log(`throughput: ${(bytes / 1024).toFixed(0)} KB en ${dt.toFixed(2)} s → ${kbps.toFixed(1)} KB/s`);
  log(`estimación: imagen JPEG ~12 KB → ${(kbps / 12).toFixed(1)} fps a pantalla completa`);
  return { kbps, seconds: dt, bytes };
}

export class OtaUpdater {
  // io: { otaWrite(u8)->Promise, qixQ, rcspWrite(u8), rcspQ }
  constructor(io, log = () => {}) {
    this.io = io; this.log = log; this.serial = 0; this._boot = false;
    this.reader = new QixReader(io.qixQ);
  }
  async _bootstrap() {
    if (this._boot || !this.io.rcspWrite) return;
    await runBootstrap(this.io, this.log);
    this._boot = true;
    this.reader.buf = new Uint8Array(0);           // descartar lo acumulado antes del OTA
  }
  _flag(isLong) { const s = this.serial; this.serial = (s + 1) & 0xf; return ((s << 3) | ((isLong ? 1 : 0) << 2) | 0x01) & 0xff; }
  _frame(cmd, payload) {
    const isLong = (payload.length + 6) > 20;
    const body = [this._flag(isLong), cmd, payload.length & 0xff, (payload.length >> 8) & 0xff, ...payload];
    let chk = 0; for (const x of body) chk = (chk + x) & 0xff;
    return Uint8Array.from([0x9e, chk, ...body]);
  }
  async _send(cmd, payload, expect, timeout) {
    await this.io.otaWrite(this._frame(cmd, payload));
    const want = [].concat(expect);
    for (;;) { const f = await this.reader.next(timeout); if (want.includes(f.cmd)) return f; }
  }

  // REQ_UPDATE y lee RET_UPDATE. NO escribe flash. Devuelve {state, allow, offset, accepted}.
  async probe(ufw, timeout = 15000) {
    validateUfw(ufw);
    await this._bootstrap();
    const header = ufw.subarray(0, 27);
    this.log('OTA probe → REQ_UPDATE (0xC0), sin escribir');
    const r = await this._send(0xC0, header, 0xC1, timeout);
    if (r.payload.length < 9) throw new Error('RET_UPDATE corto (' + r.payload.length + ' B)');
    const dv = new DataView(r.payload.buffer, r.payload.byteOffset, r.payload.length);
    const state = dv.getUint8(0), allow = dv.getUint32(1, false), offset = dv.getUint32(5, false); // BE32
    const accepted = state === 1 && offset === 0;
    this.log(`OTA RET_UPDATE: state=${state} allow=${allow} offset=${offset} → ${accepted ? 'ACEPTA (limpio)' : 'no limpio'}`);
    return { state, allow, offset, accepted };
  }

  // Flasheo completo. ⚠️ reescribe el firmware. onProgress(frac 0..1).
  async flash(ufw, onProgress = () => {}, { timeoutReq = 20000, timeoutChunk = 8000, timeoutFinal = 40000 } = {}) {
    validateUfw(ufw);
    await this._bootstrap();
    const header = ufw.subarray(0, 27), payload = ufw.subarray(27);
    this.log('OTA flash → REQ_UPDATE…');
    let r = await this._send(0xC0, header, 0xC1, timeoutReq);
    if (r.payload.length < 9) throw new Error('RET_UPDATE corto');
    let dv = new DataView(r.payload.buffer, r.payload.byteOffset, r.payload.length);
    const state = dv.getUint8(0), allow = dv.getUint32(1, false); let offset = dv.getUint32(5, false);
    if (state !== 1) throw new Error('REQ_UPDATE rechazado, state=' + state);
    if (allow === 0) throw new Error('allow_len=0 (el badge no acepta datos)');
    this.log(`OTA aceptado: allow=${allow} offset=${offset}; enviando ${payload.length} B`);

    // Web Bluetooth limita writeValue a 512 B (no hace GATT long-write como bleak). La trama Qix
    // completa = 6 (cabecera) + 8 (size+offset) + datos, así que datos<=498. Usamos 480 (= config
    // WriteWithResponse de EC) → trama 494 B, una sola escritura por chunk.
    const MAX = 480, total = payload.length; let final = null;
    while (offset < total) {
      const cs = Math.min(allow, MAX, total - offset);
      const chunk = new Uint8Array(8 + cs);
      const cdv = new DataView(chunk.buffer);
      cdv.setUint32(0, cs, true); cdv.setUint32(4, offset, true);      // size + offset LE32
      chunk.set(payload.subarray(offset, offset + cs), 8);
      const isLast = (offset + cs) >= total;
      const rr = await this._send(0xC2, chunk, isLast ? [0xC3, 0xC5] : 0xC3, timeoutChunk);
      if (rr.cmd === 0xC5) { final = rr; onProgress(1); break; }
      if (rr.payload.length < 5) throw new Error('RET_UPDATE_DATA corto');
      const cstate = rr.payload[0];
      const next = new DataView(rr.payload.buffer, rr.payload.byteOffset, rr.payload.length).getUint32(1, true); // LE32
      if (cstate !== 0) throw new Error('chunk falló @ offset ' + offset + ', state=' + cstate);
      offset = next; onProgress(offset / total);
    }
    if (!final) { this.log('esperando RET_UPDATE_RESULT…'); final = await this._waitResult(timeoutFinal); }
    if (!final.payload.length) throw new Error('RET_UPDATE_RESULT vacío');
    const status = final.payload[0];
    this.log('OTA RET_UPDATE_RESULT: status=' + status);
    if (status !== 0) throw new Error('resultado final status=' + status);
    return true;
  }
  async _waitResult(timeout) { for (;;) { const f = await this.reader.next(timeout); if (f.cmd === 0xC5) return f; } }
}

// --- Consulta de estado del badge (opcode propio 0xE9 -> 0xEA [batería%, tecla]) ---
let _qser = 0;
function qixFrame01(cmd, payload) {
  const isLong = (payload.length + 6) > 20;
  const flags = ((_qser & 0xf) << 3) | ((isLong ? 1 : 0) << 2) | 0x01; _qser = (_qser + 1) & 0xf;
  const body = [flags, cmd, payload.length & 0xff, (payload.length >> 8) & 0xff, ...payload];
  let chk = 0; for (const x of body) chk = (chk + x) & 0xff;
  return Uint8Array.from([0x9e, chk, ...body]);
}
// Pide el estado y espera 0xEA. Devuelve {battery (0..100), key (valor de tecla; NO_KEY = en reposo)}.
export async function queryState(io, timeout = 3000) {
  io.qixQ.items.length = 0;
  const reader = new QixReader(io.qixQ);
  await io.otaWrite(qixFrame01(0xE9, new Uint8Array(0)));
  const deadline = Date.now() + timeout;
  for (;;) {
    const f = await reader.next(Math.max(50, deadline - Date.now()));
    if (f.cmd === 0xEA && f.payload.length >= 2) return { battery: f.payload[0], key: f.payload[1] };
  }
}
export { qixFrame01 };
