// Prueba offline del cliente OTA contra un badge SIMULADO. Valida tramas Qix 0xC0-0xC5,
// la validación del wrapper, y que el payload se reconstruye byte a byte. No necesita hardware.
import { readFileSync } from 'node:fs';
import { ByteQueue } from './rcsp.js';
import { OtaUpdater, validateUfw, crc16ccittFalse, QixReader } from './ota.js';

const hex = u => [...u].map(x => x.toString(16).padStart(2, '0')).join('');
let fails = 0;
const ok = (c, m) => { console.log((c ? '  OK  ' : ' FAIL ') + m); if (!c) fails++; };

const UFW = new Uint8Array(readFileSync(process.argv[2] || '../fw697/QX7413_E87_custom.ufw'));

// 1) validación del wrapper
try { validateUfw(UFW); ok(true, 'validateUfw acepta el .ufw real'); }
catch (e) { ok(false, 'validateUfw: ' + e.message); }
// corromper el CRC → debe rechazar
const bad = UFW.slice(); bad[25] ^= 0xff;
let rej = false; try { validateUfw(bad); } catch { rej = true; } ok(rej, 'validateUfw rechaza CRC corrupto');

// 2) construir una trama Qix OTA y comprobarla byte a byte
function buildQix(flags, cmd, payload) {
  const body = [flags, cmd, payload.length & 0xff, (payload.length >> 8) & 0xff, ...payload];
  let chk = 0; for (const x of body) chk = (chk + x) & 0xff;
  return Uint8Array.from([0x9e, chk, ...body]);
}

// 3) badge simulado
function simBadge() {
  const qixQ = new ByteQueue();
  const recon = [];
  let serial = 0;
  const push = (cmd, payload) => {
    const flags = ((serial << 3) | (((payload.length + 6) > 20 ? 1 : 0) << 2) | 0x01) & 0xff;
    serial = (serial + 1) & 0xf;
    qixQ.push(buildQix(flags, cmd, payload));
  };
  const be32 = n => Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  const le32 = n => Uint8Array.of(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
  let total = UFW.length - 27;
  const otaWrite = async (frame) => {
    // parsear la trama que manda el cliente
    const len = frame[4] | (frame[5] << 8);
    const cmd = frame[3], payload = frame.subarray(6, 6 + len);
    if (cmd === 0xC0) {                               // REQ_UPDATE → RET_UPDATE
      // header27 recibido == wrapper
      if (hex(payload) !== hex(UFW.subarray(0, 27))) throw new Error('header27 incorrecto');
      push(0xC1, new Uint8Array([1, ...be32(1024), ...be32(0)]));  // state=1 allow=1024 offset=0
    } else if (cmd === 0xC2) {                        // SEND_UPDATE_DATA → RET_UPDATE_DATA / RESULT
      const dv = new DataView(payload.buffer, payload.byteOffset, payload.length);
      const size = dv.getUint32(0, true), off = dv.getUint32(4, true);
      const data = payload.subarray(8, 8 + size);
      for (let i = 0; i < data.length; i++) recon[off + i] = data[i];
      const next = off + size;
      if (next >= total) push(0xC5, Uint8Array.of(0));          // último → 0xC5 status=0 directo
      else push(0xC3, new Uint8Array([0, ...le32(next)]));       // 0xC3 state=0 next(LE32)
    }
  };
  return { io: { qixWrite: () => {}, otaWrite, qixQ }, recon: () => Uint8Array.from(recon) };
}

// 4) probe
const b1 = simBadge();
const pr = await new OtaUpdater(b1.io).probe(UFW);
ok(pr.state === 1 && pr.offset === 0 && pr.accepted && pr.allow === 1024, `probe: accepted allow=${pr.allow}`);

// 5) flash completo + reconstrucción byte a byte
const b2 = simBadge();
let lastFrac = 0;
await new OtaUpdater(b2.io).flash(UFW, f => { lastFrac = f; });
const recon = b2.recon(), payload = UFW.subarray(27);
const identical = recon.length === payload.length && recon.every((x, i) => x === payload[i]);
ok(identical, `flash: payload reconstruido byte a byte (${recon.length}/${payload.length} B)`);
ok(lastFrac === 1, 'flash: progreso llega a 100%');

// 6) crc del wrapper coincide con el byte 25
const want = crc16ccittFalse(UFW.subarray(27));
const got = UFW[25] | (UFW[26] << 8);
ok(want === got, `crc wrapper 0x${want.toString(16)} == byte25 0x${got.toString(16)}`);

console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
process.exit(fails ? 1 : 0);
