// Test offline del diff del dashboard (diffRect encuentra el rectángulo cambiado).
import { diffRect } from './dashboard.js';
const W = 360, H = 360;
const a = new Uint8ClampedArray(W * H * 4).fill(0);
const b = a.slice();
// cambia un bloque (101,103)-(120,130)
for (let y = 103; y <= 130; y++) for (let x = 101; x <= 120; x++) { const i = (y * W + x) * 4; b[i] = 255; }
let fails = 0; const ok = (c, m) => { console.log((c ? '  OK  ' : ' FAIL ') + m); if (!c) fails++; };
const r = diffRect(a, b, W, H);
ok(r && r.x <= 101 && r.x >= 100 && r.y <= 103 && r.y >= 102, `diff: origen cerca de (100,102) -> ${JSON.stringify(r)}`);
ok(r && r.x + r.w - 1 >= 120 && r.y + r.h - 1 >= 130, 'diff: cubre hasta (120,130)');
ok(diffRect(a, a.slice(), W, H) === null, 'diff: sin cambios -> null');
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
process.exit(fails ? 1 : 0);
