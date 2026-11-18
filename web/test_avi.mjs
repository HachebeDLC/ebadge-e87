// Valida buildAvi() contra los AVI reales de ZRun: extrae sus frames, vuelve a empaquetarlos
// y exige que el resultado sea byte a byte identico al original.
// Uso: node test_avi.mjs ../avi/danmaku_....avi:83333 ../avi/slideshow_....avi:2000000 ...
import { readFileSync } from 'node:fs';
import { buildAvi } from './media.js';

const u32 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 2 ** 24);
let fail = 0;
for (const arg of process.argv.slice(2)) {
  const [path, us] = arg.split(/:(?=\d+$)/);
  const b = new Uint8Array(readFileSync(path));
  const moviSize = u32(b, 0x166e + 4);
  const frames = []; let p = 0x166e + 12;
  while (p < 0x166e + 8 + moviSize) { const s = u32(b, p + 4); frames.push(b.slice(p + 8, p + 8 + s)); p += 8 + s + (s & 1); }
  const out = buildAvi(frames, +us);
  let first = -1; const n = Math.max(out.length, b.length);
  for (let i = 0; i < n; i++) if (out[i] !== b[i]) { first = i; break; }
  console.log(`${path.split('/').pop()}: ${frames.length} frames, ${b.length} B -> ${out.length} B, ` +
    (first < 0 ? 'IDENTICO' : `DIFIERE en 0x${first.toString(16)}`));
  if (first >= 0) fail++;
}
process.exit(fail ? 1 : 0);
