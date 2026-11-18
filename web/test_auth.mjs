// Prueba offline de la auth: SAFER+ (camino validado) y respaldo por reflexion.
// Simula 3 badges: (a) SAFER+ como el E87 AC697N, (b) otro cifrado que acepta un reto
// reflejado (como hace el ZNP Z01), (c) otro cifrado que rechaza la reflexion.
import { BadgeSession, ByteQueue } from './rcsp.js';
import { getEncryptedAuthData } from './e1.js';

const hex = u => [...u].map(x => x.toString(16).padStart(2, '0')).join('');
const PASS = Uint8Array.of(0x02, 0x70, 0x61, 0x73, 0x73);

// "Otro cifrado": funcion determinista cualquiera distinta de SAFER+ (00+C -> 01+E'(C)).
function otherCipher(m17) {
  const o = new Uint8Array(17); o[0] = 0x01;
  for (let i = 0; i < 16; i++) o[i + 1] = (m17[i + 1] * 29 + i * 13 + 0x5a) & 0xff;
  return o;
}

function simBadge(kind) {
  const toSess = new ByteQueue(), fromSess = new ByteQueue();
  const io = { rcspQ: toSess, rcspWrite: u => fromSess.push(u), qixWrite: () => {} };
  const E = kind === 'safer' ? getEncryptedAuthData : otherCipher;
  const trace = [];
  const done = (async () => {
    const m1 = await fromSess.get(); trace.push('rx ' + hex(m1.slice(0, 1)));
    toSess.push(E(m1.slice(0, 17)));                                   // 01 + E(reto app)
    if ((await fromSess.get())[0] !== 0x02) throw new Error('esperaba 02 pass');
    const C = Uint8Array.of(0x00, ...Array.from({ length: 16 }, (_, i) => (i * 7 + 3) & 0xff));
    toSess.push(C);                                                    // reto del badge
    let m = await fromSess.get();
    if (m[0] === 0x00) {                                               // nos reflejan un reto
      trace.push('reflexion');
      if (kind === 'reject') { toSess.push(Uint8Array.of(0xEE)); return 'rechazado'; }
      toSess.push(E(m.slice(0, 17)));                                  // el badge calcula E(C)
      m = await fromSess.get();
    }
    if (hex(m.slice(0, 17)) !== hex(E(C))) { toSess.push(Uint8Array.of(0xEE)); return 'respuesta mala'; }
    toSess.push(PASS);
    return 'pass';
  })();
  return { io, done, trace };
}

async function run(kind) {
  const b = simBadge(kind);
  const s = new BadgeSession(b.io, () => {});
  let err = null;
  try { await s.authenticate(); } catch (e) { err = e.message; }
  const res = await b.done;
  return { kind, mode: s.authMode, badge: res, reflected: b.trace.includes('reflexion'), err };
}

const results = [await run('safer'), await run('other'), await run('reject')];
for (const r of results) console.log(JSON.stringify(r));
const [a, o, rj] = results;
const ok =
  a.mode === 'safer+' && a.badge === 'pass' && !a.reflected && !a.err &&          // validado, sin reflejar
  o.mode === 'reflexion' && o.badge === 'pass' && o.reflected && !o.err &&        // respaldo funciona
  rj.mode === 'reflexion' && rj.badge === 'rechazado' && /reflexion rechazada/.test(rj.err || '');
console.log('auth SAFER+ / reflexion / rechazo:', ok ? 'OK' : 'FALLO');
process.exit(ok ? 0 : 1);
