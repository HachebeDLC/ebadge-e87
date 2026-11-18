// Pantallas-preset listas para el badge: notificación y mensaje grande.
// Toman la pantalla (suspenden el menú) y pintan a pantalla completa.
import { SCREEN, blitRegion, canvasRegionTo565, takeover } from './display.js';

function newCanvas() { const c = document.createElement('canvas'); c.width = SCREEN; c.height = SCREEN; return c; }
export function wrapText(ctx, text, maxW) {
  const words = (text || '').split(/\s+/).filter(Boolean), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}

// Dibuja una notificación en un ctx 360x360 (exportado para test/preview).
export function renderNotify(ctx, { icon = '🔔', title = '', text = '', bg = '#0b0e14', accent = '#5b84ff' } = {}) {
  ctx.fillStyle = bg; ctx.fillRect(0, 0, SCREEN, SCREEN);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (icon) { ctx.font = '96px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(icon, SCREEN / 2, 112); }
  ctx.fillStyle = accent; ctx.font = 'bold 34px sans-serif'; ctx.fillText(title || '', SCREEN / 2, 192);
  ctx.fillStyle = '#ffffff'; ctx.font = '26px sans-serif';
  wrapText(ctx, text, 300).slice(0, 4).forEach((ln, i) => ctx.fillText(ln, SCREEN / 2, 240 + i * 34));
}
export function renderBigMessage(ctx, text, { color = '#ffffff', bg = '#000000', max = 72 } = {}) {
  ctx.fillStyle = bg; ctx.fillRect(0, 0, SCREEN, SCREEN);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
  let px = max, lines;
  for (;;) { ctx.font = `bold ${px}px sans-serif`; lines = wrapText(ctx, text, 324); if (lines.length * px * 1.15 <= 324 || px <= 20) break; px -= 4; }
  const lh = px * 1.15, y0 = SCREEN / 2 - (lines.length - 1) * lh / 2;
  lines.forEach((ln, i) => ctx.fillText(ln, SCREEN / 2, y0 + i * lh));
}

async function pushFull(io, ctx) {
  await takeover(io, true);
  await blitRegion(io, 0, 0, SCREEN, SCREEN, canvasRegionTo565(ctx, 0, 0, SCREEN, SCREEN), { fast: true });
}
export async function notify(io, opts) {
  const ctx = newCanvas().getContext('2d', { willReadFrequently: true });
  renderNotify(ctx, opts); await pushFull(io, ctx);
}
export async function bigMessage(io, text, opts) {
  const ctx = newCanvas().getContext('2d', { willReadFrequently: true });
  renderBigMessage(ctx, text, opts); await pushFull(io, ctx);
}
