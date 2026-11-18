// Prueba offline de la capa de display/widgets: construcción de tramas FILL_RECT/BLIT, sin hardware.
import { fillRect, blitRegion } from './display.js';
import { busyBar } from './widgets.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? '  OK  ' : ' FAIL ') + m); if (!c) fails++; };

function fakeIo() {
  const writes = []; const all = [];
  const w = u => { writes.push(u.length); for (const b of u) all.push(b); return Promise.resolve(); };
  return { otaWrite: w, otaWriteFast: w, writes, bytes: () => Uint8Array.from(all) };
}
function parseFrames(buf) {
  const f = []; let i = 0;
  while (i + 6 <= buf.length) {
    if (buf[i] !== 0x9e) { i++; continue; }
    const len = buf[i + 4] | (buf[i + 5] << 8), total = 6 + len;
    if (i + total > buf.length) break;
    f.push({ cmd: buf[i + 3], payload: buf.slice(i + 6, i + 6 + len) });
    i += total;
  }
  return f;
}
const u16 = (p, o) => p[o] | (p[o + 1] << 8);
const u32 = (p, o) => (p[o] | (p[o + 1] << 8) | (p[o + 2] << 16) | (p[o + 3] * 0x1000000)) >>> 0;

// 1) FILL_RECT
let io = fakeIo();
await fillRect(io, 10, 20, 30, 40, 0x112233);
let fr = parseFrames(io.bytes());
ok(fr.length === 1 && fr[0].cmd === 0xE1, 'fillRect: 1 trama 0xE1');
let p = fr[0].payload;
ok(u16(p, 0) === 10 && u16(p, 2) === 20 && u16(p, 4) === 30 && u16(p, 6) === 40 && u32(p, 8) === 0x112233,
   'fillRect: x/y/w/h/color correctos');

// 2) busy-bar (dos rects: fondo w=320, relleno w=round(320*0.5)=160)
io = fakeIo();
await busyBar(io, 20, 160, 320, 40, 0.5, { fg: 0x3b6cf6, bg: 0x222831 });
fr = parseFrames(io.bytes());
ok(fr.length === 2 && fr.every(f => f.cmd === 0xE1), 'busyBar: 2 tramas FILL_RECT');
ok(u16(fr[0].payload, 4) === 320 && u32(fr[0].payload, 8) === 0x222831, 'busyBar: fondo w=320 color bg');
ok(u16(fr[1].payload, 4) === 160 && u32(fr[1].payload, 8) === 0x3b6cf6, 'busyBar: relleno w=160 color fg');

// 3) BLIT con troceo multi-línea: 360x10 → linesPerFrame=floor((4000-14)/720)=5 → 2 tramas de 5 líneas
io = fakeIo();
const px = new Uint16Array(360 * 10); for (let i = 0; i < px.length; i++) px[i] = i & 0xffff;
await blitRegion(io, 0, 0, 360, 10, px, { fast: true });
fr = parseFrames(io.bytes());
ok(fr.length === 2 && fr.every(f => f.cmd === 0xE0), `BLIT: 2 tramas 0xE0 (fueron ${fr.length})`);
ok(u16(fr[0].payload, 2) === 0 && u16(fr[0].payload, 6) === 5 && u16(fr[1].payload, 2) === 5 && u16(fr[1].payload, 6) === 5,
   'BLIT: y/h de las dos bandas correctos (0/5 y 5/5)');
let totalPx = fr.reduce((s, f) => s + (f.payload.length - 8) / 2, 0);
ok(totalPx === 360 * 10, `BLIT: píxeles totales = 3600 (fueron ${totalPx})`);

// 4) ninguna ESCRITURA supera 512 B (límite Web Bluetooth)
ok(io.writes.every(n => n <= 512), `ninguna escritura > 512 B (máx ${Math.max(...io.writes)})`);

console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
process.exit(fails ? 0 : 1);
