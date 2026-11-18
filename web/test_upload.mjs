// Prueba offline: BadgeSession contra un badge SIMULADO. Valida auth, framing, CRC,
// manejo de bloques 0x1D y reconstruccion byte a byte. No necesita el dispositivo.
import { BadgeSession, RcspReader, ByteQueue, crc16, qixFrame, rcspFrame } from './rcsp.js';
import { getEncryptedAuthData } from './e1.js';

const hex = u => [...u].map(x => x.toString(16).padStart(2, '0')).join('');
const SIZE = 11600, MTU = 490, BLK = 3920;

function simBadge(fileSize) {
  const toSession = new ByteQueue();       // badge -> sesion
  const fromSession = new ByteQueue();     // sesion -> badge
  const reader = new RcspReader(fromSession);
  const recon = new Uint8Array(fileSize);
  const covered = new Set();
  const io = {
    rcspQ: toSession,
    rcspWrite: u => fromSession.push(u),
    qixWrite: u => { if (u[0] !== 0x9e) throw new Error('frame QIX invalido'); },
  };
  const rsp = (op, extra = []) => toSession.push(rcspFrame(0x00, op, [0x00, 0x00, ...extra]));
  const req = (flag, op, pl) => toSession.push(rcspFrame(flag, op, pl));

  // lista de bloques que pedira el badge: offsets 490,4410,... y la "cabecera" (0) al final
  const blocks = [];
  for (let off = MTU; off < fileSize; off += BLK) blocks.push(off);
  blocks.push(0);

  const done = (async () => {
    // --- AUTH (crudo) ---
    const m1 = await fromSession.get();                       // 00 + rand
    toSession.push(getEncryptedAuthData(m1.slice(0, 17)));    // 01 + E1(rand)
    if ((await fromSession.get())[0] !== 0x02) throw new Error('esperaba 02 pass');
    const bRand = Uint8Array.from({ length: 16 }, (_, i) => (i * 7 + 3) & 0xff);
    toSession.push(Uint8Array.of(0x00, ...bRand));            // reto del badge
    const m3 = await fromSession.get();                       // 01 + E1(reto)
    if (hex(m3.slice(0, 17)) !== hex(getEncryptedAuthData(Uint8Array.of(0x00, ...bRand))))
      throw new Error('respuesta de la sesion incorrecta');
    toSession.push(Uint8Array.of(0x02, 0x70, 0x61, 0x73, 0x73)); // pass

    // --- bucle de tramas ---
    let bi = -1, cur = null;
    const askNext = () => {
      bi++;
      if (bi >= blocks.length) { req(0xC0, 0x20, [0xAB]); return; }  // pedir nombre
      const off = blocks[bi], real = Math.min(BLK, fileSize - off);
      cur = { off, real, pos: 0 };
      req(0x80, 0x1D, [0x00, 0x00, (BLK >> 8) & 0xff, BLK & 0xff,
        (off >>> 24) & 0xff, (off >>> 16) & 0xff, (off >>> 8) & 0xff, off & 0xff]);
    };

    while (true) {
      const f = await reader.next(20000);
      if (f.op === 0x03) rsp(0x03, [1, 2, 3]);
      else if (f.op === 0x08) rsp(0x08);
      else if (f.op === 0x21) rsp(0x21);
      else if (f.op === 0x27) rsp(0x27, [0x00, 0x01]);
      else if (f.op === 0x1B) { rsp(0x1B, [(MTU >> 8) & 0xff, MTU & 0xff]); askNext(); }
      else if (f.op === 0x01) {
        const idx = f.payload[2], crc = (f.payload[3] << 8) | f.payload[4], data = f.payload.slice(5);
        if (crc16(data) !== crc) throw new Error(`CRC de paquete malo idx=${idx}`);
        const off = cur.off + cur.pos;
        recon.set(data, off);
        for (let k = 0; k < data.length; k++) covered.add(off + k);
        cur.pos += data.length;
        if (cur.pos >= cur.real) askNext();
      }
      else if (f.op === 0x20 && f.flag === 0x00) req(0xC0, 0x1C, [0xAC]);  // nombre recibido -> fin
      else if (f.op === 0x1C && f.flag === 0x00) return true;             // terminado
    }
  })();

  return { io, recon, covered, done };
}

const file = Uint8Array.from({ length: SIZE }, (_, i) => (i * 131 + 7) & 0xff);
const b = simBadge(SIZE);
const sess = new BadgeSession(b.io, m => console.log('  [sess]', m));

(async () => {
  await sess.authenticate();
  await sess.boot();
  sess.setFileTypeBadge();
  await sess.uploadFile(file, 'f_test.jpg', (s, t) => { if (s === t) console.log(`  progreso ${s}/${t}`); });
  await b.done;
  const ok = Buffer.compare(Buffer.from(file), Buffer.from(b.recon)) === 0;
  console.log('cobertura:', b.covered.size, '/', SIZE, '| reconstruccion identica:', ok ? 'OK' : 'FALLO');
  // DC 0C bien formado (chk correcto)
  const dc = qixFrame(0xDC, Uint8Array.of(0x0C), 4);
  console.log('DC0C:', hex(dc));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERROR:', e.stack || e); process.exit(1); });
