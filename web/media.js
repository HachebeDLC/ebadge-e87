// Generacion de medios para el eBadge E87: JPEG 368x368 (imagen unica) y
// AVI RIFF MJPEG 368x368 (texto, GIF, varias imagenes, video).
// Formatos CONFIRMED en notes/protocolo-e87.md seccion 4.

export const W = 368, H = 368;

// --- utilidades de escritura binaria little-endian ---
class Buf {
  constructor() { this.a = []; }
  u8(v) { this.a.push(v & 0xff); return this; }
  u16(v) { this.a.push(v & 0xff, (v >> 8) & 0xff); return this; }
  u32(v) { this.a.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff); return this; }
  str(s) { for (let i = 0; i < s.length; i++) this.a.push(s.charCodeAt(i) & 0xff); return this; }
  bytes(u) { for (const x of u) this.a.push(x & 0xff); return this; }
  get u8arr() { return Uint8Array.from(this.a); }
  get len() { return this.a.length; }
}

// Codifica un canvas a JPEG (Uint8Array) con la estructura de marcadores de ffmpeg.
export async function canvasToJpeg(canvas, quality = 0.9) {
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
  return normalizeJpeg(new Uint8Array(await blob.arrayBuffer()));
}

// El E87 solo ha recibido JPEG de ffmpeg: FFD8 APP0 [COM] DQT DHT SOF0 SOS, una sola DQT y una sola DHT
// (scratch/avi/*.avi y *.jpg). Chrome emite APP2 (ICC), 2 DQT, SOF0 antes de DHT y 4 DHT.
// Reordenamos sin recodificar: quitamos APP1..15/COM, fusionamos DQT y DHT y los ponemos delante del SOF.
export function normalizeJpeg(j) {
  if (j[0] !== 0xFF || j[1] !== 0xD8) throw new Error('no es JPEG');
  let app0 = null; const dqt = [], dht = [], other = []; let sof = null, p = 2;
  while (p + 4 <= j.length && j[p] === 0xFF) {
    const m = j[p + 1];
    if (m === 0xDA) break;                                  // SOS: el resto se copia tal cual
    const L = (j[p + 2] << 8) | j[p + 3], seg = j.subarray(p, p + 2 + L), body = j.subarray(p + 4, p + 2 + L);
    if (m === 0xE0) { if (!app0) app0 = seg; }
    else if (m === 0xDB) dqt.push(body);
    else if (m === 0xC4) dht.push(body);
    else if (m === 0xC0) sof = seg;
    else if ((m >= 0xE1 && m <= 0xEF) || m === 0xFE) { /* fuera */ }
    else other.push(seg);                                   // p.ej. DRI
    p += 2 + L;
  }
  if (!sof) throw new Error('JPEG no baseline (sin SOF0)');
  const seg = (m, parts) => { const n = parts.reduce((s, x) => s + x.length, 0) + 2; const o = new Uint8Array(n + 2); o.set([0xFF, m, n >> 8, n & 0xff]); let q = 4; for (const x of parts) { o.set(x, q); q += x.length; } return o; };
  const out = [Uint8Array.of(0xFF, 0xD8)];
  if (app0) out.push(app0);
  out.push(seg(0xDB, dqt), seg(0xC4, dht), sof, ...other, j.subarray(p));
  const n = out.reduce((s, x) => s + x.length, 0), r = new Uint8Array(n); let q = 0;
  for (const x of out) { r.set(x, q); q += x.length; }
  return r;
}

// Construye un AVI MJPEG con la MISMA disposicion que el AVI de ffmpeg (Lavf60.3.100) que manda ZRun.
// Comparando los 4 AVI reales (scratch/avi/) solo cambian: tamano RIFF, usPerFrame, totalFrames,
// strh scale/rate/length/suggestedBufferSize, vprp refresh y tamano de movi; el resto es fijo
// y LIST movi siempre empieza en 0x166e. idx1 cuenta los offsets desde el fourcc 'movi' (1er chunk = 4).
// microSecPerFrame: 83333 para 12 fps; N*1e6 para un pase de N s por imagen.
export function buildAvi(frames, microSecPerFrame) {
  const n = frames.length;
  const maxBytes = frames.reduce((m, f) => Math.max(m, f.length), 0);
  const { scale, rate } = fpsFromUspf(microSecPerFrame);
  const zeros = k => new Uint8Array(k);

  // --- movi + idx1 ---
  const movi = new Buf(); const index = [];
  for (const f of frames) {
    index.push({ off: 4 + movi.len, size: f.length });
    movi.str('00dc').u32(f.length).bytes(f);
    if (f.length & 1) movi.u8(0);
  }
  const idx = new Buf();
  idx.str('idx1').u32(n * 16);
  for (const e of index) idx.str('00dc').u32(0x10).u32(e.off).u32(e.size);   // 0x10 = AVIIF_KEYFRAME

  // --- hdrl (LIST de 4664 B, igual que ffmpeg) ---
  const h = new Buf();
  h.str('LIST').u32(4664).str('hdrl');
  h.str('avih').u32(56)
    .u32(microSecPerFrame).u32(25000).u32(0).u32(0x910)       // HASINDEX|ISINTERLEAVED|TRUSTCKTYPE
    .u32(n).u32(0).u32(1).u32(1048576).u32(W).u32(H).u32(0).u32(0).u32(0).u32(0);
  h.str('LIST').u32(4320).str('strl');
  h.str('strh').u32(56).str('vids').str('MJPG')
    .u32(0).u16(0).u16(0).u32(0).u32(scale).u32(rate).u32(0).u32(n).u32(maxBytes)
    .u32(0xffffffff).u32(0).u16(0).u16(0).u16(W).u16(H);
  h.str('strf').u32(40).u32(40).u32(W).u32(H).u16(1).u16(24).str('MJPG').u32(W * H * 3).u32(0).u32(0).u32(0).u32(0);
  h.str('JUNK').u32(4120).u16(4).u8(0).u8(0).u32(0).str('00dc').bytes(zeros(4120 - 12));  // hueco para indx ODML
  h.str('vprp').u32(68).u32(0).u32(0).u32(Math.floor(rate / scale)).u32(W).u32(H).u32(0x00010001)
    .u32(W).u32(H).u32(1).u32(H).u32(W).u32(H).u32(W).u32(0).u32(0).u32(0).u32(0);
  h.str('JUNK').u32(260).str('odml').str('dmlh').u32(248).bytes(zeros(248));
  h.str('LIST').u32(26).str('INFO').str('ISFT').u32(13).str('Lavf60.3.100').u8(0).u8(0);
  h.str('JUNK').u32(1016).bytes(zeros(1016));
  if (h.len + 12 !== 0x166e) throw new Error('cabecera AVI desalineada: ' + (h.len + 12));

  const riff = new Buf();
  riff.str('RIFF').u32(4 + h.len + 12 + movi.len + idx.len).str('AVI ')
    .bytes(h.u8arr).str('LIST').u32(4 + movi.len).str('movi').bytes(movi.u8arr).bytes(idx.u8arr);
  return riff.u8arr;
}

function fpsFromUspf(us) {
  // devuelve {scale, rate} tal que rate/scale = fps
  if (us >= 1000000 && us % 1000000 === 0) return { scale: us / 1000000, rate: 1 };
  const fps = Math.round(1e6 / us);
  return { scale: 1, rate: fps };
}

// --- helpers de alto nivel para la UI ---

// dibuja texto en un canvas 368x368 (fondo negro, texto blanco centrado, multilinea).
// Interlineado proporcional al tamano de fuente; si el texto no cabe en alto, encoge la fuente.
export function drawText(ctx, text, opts = {}) {
  const { bg = '#000', fg = '#fff', font = 'bold 44px sans-serif' } = opts;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  const tmpl = font.replace(/(\d+(?:\.\d+)?)px/, '\u0000');   // marcador para reinyectar el tamano
  let px = m ? parseFloat(m[1]) : 44, lines, lh;
  for (;;) {
    ctx.font = tmpl.replace('\u0000', px + 'px');
    lines = wrap(ctx, text, W - 24);
    lh = Math.round(px * 1.18);
    if (lines.length * lh <= H - 16 || px <= 14) break;       // cabe, o ya es muy pequena
    px -= 2;
  }
  const y0 = H / 2 - (lines.length - 1) * lh / 2;
  lines.forEach((ln, i) => ctx.fillText(ln, W / 2, y0 + i * lh));
}

function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/); const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

// dibuja una imagen (HTMLImageElement/ImageBitmap) cubriendo 368x368 (cover)
export function drawImageCover(ctx, img) {
  const iw = img.width, ih = img.height;
  const s = Math.max(W / iw, H / ih);
  const dw = iw * s, dh = ih * s;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}
