// Genera con buildAvi() (el mismo codigo que usa la web) un AVI de 1 frame
// usando un JPEG existente, para comparar su estructura con los AVI reales de ZRun.
// Uso: node gen_test_avi.mjs <frame.jpg> <salida.avi>
import { readFileSync, writeFileSync } from 'node:fs';
import { buildAvi } from './media.js';
const [, , src, dst] = process.argv;
writeFileSync(dst, buildAvi([new Uint8Array(readFileSync(src))], 83333));
console.log('escrito', dst);
