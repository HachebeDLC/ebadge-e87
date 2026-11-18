// Dashboard en vivo para el badge: hora + fecha + mensaje + barra de batería.
// Se renderiza en un canvas 360x360 y se envía SOLO la región que cambia (diff de píxeles) → casi tiempo real.
import { SCREEN, blitRegion, canvasRegionTo565, takeover } from './display.js';

// Dibuja el dashboard completo en un contexto 360x360 a partir del estado.
export function renderDashboard(ctx, st) {
  ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, SCREEN, SCREEN);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 92px sans-serif';
  ctx.fillText(st.time || '', SCREEN / 2, 150);
  ctx.fillStyle = '#9aa1ab'; ctx.font = '26px sans-serif';
  ctx.fillText(st.date || '', SCREEN / 2, 212);
  if (st.message) { ctx.fillStyle = '#5b84ff'; ctx.font = 'bold 30px sans-serif'; ctx.fillText(st.message, SCREEN / 2, 258); }
  // barra batería
  const bx = 60, bw = 240, by = 298, bh = 26;
  ctx.fillStyle = '#222831'; ctx.fillRect(bx, by, bw, bh);
  const bat = Math.max(0, Math.min(100, st.battery || 0));
  ctx.fillStyle = bat > 25 ? '#56c07f' : '#e8706e'; ctx.fillRect(bx, by, Math.round(bw * bat / 100), bh);
  ctx.strokeStyle = '#555'; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  ctx.fillStyle = '#ffffff'; ctx.font = '20px sans-serif'; ctx.fillText(bat + '%', SCREEN / 2, by + bh + 20);
}

// Devuelve el rectángulo que cambió entre dos ImageData (o null). Alineado a 2 px para limpieza.
export function diffRect(a, b, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 &= ~1; y0 &= ~1; x1 |= 1; y1 |= 1;
  return { x: x0, y: y0, w: Math.min(SCREEN, x1 - x0 + 1), h: Math.min(SCREEN, y1 - y0 + 1) };
}

export function makeDashboard(io, { getMessage = () => '', log = () => {} } = {}) {
  const canvas = document.createElement('canvas'); canvas.width = SCREEN; canvas.height = SCREEN;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let prev = null, timer = null, battery = 0, lastBat = 0, firstPaint = true, busy = false;

  function state() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
    const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    return { time: `${hh}:${mm}`, date: `${dias[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`, message: getMessage(), battery };
  }

  async function tick() {
    if (busy || !io) return; busy = true;
    try {
      renderDashboard(ctx, state());
      const cur = ctx.getImageData(0, 0, SCREEN, SCREEN);
      if (firstPaint || !prev) {
        await blitRegion(io, 0, 0, SCREEN, SCREEN, canvasRegionTo565(ctx, 0, 0, SCREEN, SCREEN), { fast: true });
        firstPaint = false;
      } else {
        const r = diffRect(prev.data, cur.data, SCREEN, SCREEN);
        if (r) await blitRegion(io, r.x, r.y, r.w, r.h, canvasRegionTo565(ctx, r.x, r.y, r.w, r.h), { fast: true });
      }
      prev = cur;
    } catch (e) { log('dashboard ERROR: ' + (e.message || e), 'err'); }
    busy = false;
  }

  return {
    canvas, ctx,
    setBattery(b) { battery = b; },
    async start() { await takeover(io, true); firstPaint = true; prev = null; await tick(); timer = setInterval(tick, 1000); log('dashboard iniciado', 'ok'); },
    async stop() { if (timer) { clearInterval(timer); timer = null; } await takeover(io, false); log('dashboard parado (menú devuelto)', 'ok'); },
    refreshNow: tick,
    renderPreviewTo(dstCtx, dstW, dstH) { renderDashboard(ctx, state()); dstCtx.drawImage(canvas, 0, 0, dstW, dstH); },
  };
}
