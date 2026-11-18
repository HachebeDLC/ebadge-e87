// Prueba offline de queryState (0xE9 -> 0xEA) con badge simulado.
import { ByteQueue } from './rcsp.js';
import { queryState, qixFrame01 } from './ota.js';
const qixQ = new ByteQueue();
let sent = false;
const io = { qixQ, otaWrite: u => { if (u[3] === 0xE9) { sent = true; qixQ.push(qixFrame01(0xEA, Uint8Array.of(77, 5))); } return Promise.resolve(); } };
const s = await queryState(io, 2000);
const ok = sent && s && s.battery === 77 && s.key === 5;
console.log(`sent 0xE9=${sent}  recibido=${JSON.stringify(s)}  -> ${ok ? 'OK' : 'FALLO'}`);
process.exit(ok ? 0 : 1);
