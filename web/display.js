// Cliente "display server": pinta en el LCD del badge por BLE, casi en tiempo real.
// Opcodes Qix del firmware custom (qix_ota_server.c):
//   0xE1 FILL_RECT : [x y w h (u16 LE)][color (u32 LE, 0x00RRGGBB)]  -> lcd->clear_screen
//   0xE0 BLIT      : [x y w h (u16 LE)][píxeles RGB565 LE]            -> lcd->draw
// Panel 360x360. Buffer de reensamblado del firmware = 4096 B → una trama BLIT puede llevar varias líneas.
// Web Bluetooth limita cada escritura a 512 B; el firmware reensambla, así que troceamos a <=512.

export const SCREEN = 360;
const FRAME_BUDGET = 4000;          // < rx_buf 4096 del firmware (margen)
let _ser = 0;

function buildFrame(cmd, payload) {
  const isLong = (payload.length + 6) > 20;
  const flags = ((_ser & 0xf) << 3) | ((isLong ? 1 : 0) << 2) | 0x01; _ser = (_ser + 1) & 0xf;
  const body = [flags, cmd, payload.length & 0xff, (payload.length >> 8) & 0xff, ...payload];
  let chk = 0; for (const x of body) chk = (chk + x) & 0xff;
  return Uint8Array.from([0x9e, chk, ...body]);
}
async function writeFrames(io, frame, fast) {        // trocea a <=512; fast = sin respuesta (rápido)
  const w = (fast && io.otaWriteFast) ? io.otaWriteFast : io.otaWrite;
  for (let o = 0; o < frame.length; o += 512) await w(frame.subarray(o, Math.min(o + 512, frame.length)));
}
const to565 = (r, g, b) => (((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3)) & 0xffff;

// Rellena un rectángulo con color sólido RGB888 (0xRRGGBB). Instantáneo (datos mínimos).
export async function fillRect(io, x, y, w, h, color) {
  const p = new Uint8Array(12), dv = new DataView(p.buffer);
  dv.setUint16(0, x, true); dv.setUint16(2, y, true); dv.setUint16(4, w, true); dv.setUint16(6, h, true);
  dv.setUint32(8, color >>> 0, true);
  await writeFrames(io, buildFrame(0xE1, p), false);
}
export const fillScreen = (io, color) => fillRect(io, 0, 0, SCREEN, SCREEN, color);

// Vuelca una región de píxeles RGB565 (Uint16Array de w*h), en grupos de líneas que caben en una trama.
export async function blitRegion(io, x, y, w, h, px565, { fast = true, onProgress } = {}) {
  const linesPerFrame = Math.max(1, Math.floor((FRAME_BUDGET - 14) / (w * 2)));
  for (let gy = 0; gy < h; gy += linesPerFrame) {
    const gh = Math.min(linesPerFrame, h - gy);
    const p = new Uint8Array(8 + w * gh * 2), dv = new DataView(p.buffer);
    dv.setUint16(0, x, true); dv.setUint16(2, y + gy, true); dv.setUint16(4, w, true); dv.setUint16(6, gh, true);
    for (let i = 0; i < w * gh; i++) dv.setUint16(8 + i * 2, px565[gy * w + i], true);
    await writeFrames(io, buildFrame(0xE0, p), fast);
    if (onProgress) onProgress((gy + gh) / h);
  }
}

// Convierte una región de un canvas a RGB565 (Uint16Array).
export function canvasRegionTo565(ctx, x, y, w, h) {
  const d = ctx.getImageData(x, y, w, h).data;
  const out = new Uint16Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = to565(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  return out;
}

// Pone a negro los píxeles fuera del círculo inscrito (pantalla redonda).
export function circularMask(ctx, w, h) {
  const cx = w / 2, cy = h / 2, r = w / 2, img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r * r) { const p = (y * w + x) * 4; d[p] = d[p + 1] = d[p + 2] = 0; }
  }
  ctx.putImageData(img, 0, 0);
}

// Convierte una región a RGB565 con difuminado Floyd–Steinberg (suaviza el banding de 16 bits).
export function canvasRegionTo565Dither(ctx, x, y, w, h) {
  const d = ctx.getImageData(x, y, w, h).data, out = new Uint16Array(w * h);
  const er = new Float32Array(w * h), eg = new Float32Array(w * h), eb = new Float32Array(w * h);
  const cl = v => v < 0 ? 0 : v > 255 ? 255 : v;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, p = k * 4;
    const r = cl(d[p] + er[k]), g = cl(d[p + 1] + eg[k]), b = cl(d[p + 2] + eb[k]);
    const r5 = r & 0xf8, g6 = g & 0xfc, b5 = b & 0xf8;
    out[k] = (((r5 << 8) | (g6 << 3) | (b5 >> 3)) & 0xffff);
    const re = r - r5, ge = g - g6, be = b - b5;
    if (i + 1 < w) { const t = k + 1; er[t] += re * 7 / 16; eg[t] += ge * 7 / 16; eb[t] += be * 7 / 16; }
    if (j + 1 < h) {
      if (i > 0) { const t = k + w - 1; er[t] += re * 3 / 16; eg[t] += ge * 3 / 16; eb[t] += be * 3 / 16; }
      const t = k + w; er[t] += re * 5 / 16; eg[t] += ge * 5 / 16; eb[t] += be * 5 / 16;
      if (i + 1 < w) { const u = k + w + 1; er[u] += re / 16; eg[u] += ge / 16; eb[u] += be / 16; }
    }
  }
  return out;
}

// Envía una imagen a toda la pantalla (cover 360x360). opts: {onProgress, log, dither, circular}.
export async function showImage(io, src, { onProgress = () => {}, log = () => {}, dither = false, circular = false } = {}) {
  const c = document.createElement('canvas'); c.width = SCREEN; c.height = SCREEN;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const iw = src.width || src.videoWidth || SCREEN, ih = src.height || src.videoHeight || SCREEN;
  const s = Math.max(SCREEN / iw, SCREEN / ih), dw = iw * s, dh = ih * s;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, SCREEN, SCREEN);
  ctx.drawImage(src, (SCREEN - dw) / 2, (SCREEN - dh) / 2, dw, dh);
  if (circular) circularMask(ctx, SCREEN, SCREEN);
  const px = dither ? canvasRegionTo565Dither(ctx, 0, 0, SCREEN, SCREEN) : canvasRegionTo565(ctx, 0, 0, SCREEN, SCREEN);
  const t0 = performance.now();
  await blitRegion(io, 0, 0, SCREEN, SCREEN, px, { fast: true, onProgress });
  log(`imagen enviada en ${((performance.now() - t0) / 1000).toFixed(1)} s${dither ? ' (difuminada)' : ''}`);
}

export function hexToRgb888(hex) { return parseInt(hex.replace('#', ''), 16) & 0xffffff; }
export { to565 };

// Suspende(1)/reanuda(0) LVGL en el badge para que el host sea dueño de la pantalla (opcode 0xE7).
export async function takeover(io, on) {
  await writeFrames(io, buildFrame(0xE7, Uint8Array.of(on ? 1 : 0)), false);
}
