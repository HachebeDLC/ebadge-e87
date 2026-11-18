// Capa de widgets sobre el display server: busy-bar, texto por región, estado.
// La busy-bar usa FILL_RECT (rectángulos sólidos) → datos mínimos → ACTUALIZACIÓN INSTANTÁNEA (tiempo real).
// El texto/gráfico usa BLIT de una región pequeña → más datos, algo más lento.
import { SCREEN, fillRect, blitRegion, canvasRegionTo565 } from './display.js';

// Barra de progreso tipo "busy bar" de Flipper. frac 0..1. Colores RGB888 (0xRRGGBB).
// Dos rectángulos sólidos: fondo + relleno. Instantáneo.
export async function busyBar(io, x, y, w, h, frac, { fg = 0x3b6cf6, bg = 0x222831 } = {}) {
  frac = Math.max(0, Math.min(1, frac));
  const fw = Math.round(w * frac);
  await fillRect(io, x, y, w, h, bg);                 // fondo (toda la barra)
  if (fw > 0) await fillRect(io, x, y, fw, h, fg);    // relleno
}

// Renderiza texto (y lo que quieras) en una región y la vuelca por BLIT. w*h px.
// draw(ctx) pinta sobre un canvas temporal del tamaño de la región (origen 0,0).
export async function drawRegion(io, x, y, w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  draw(ctx, w, h);
  const px = canvasRegionTo565(ctx, 0, 0, w, h);
  await blitRegion(io, x, y, w, h, px, opts);
}

// Texto en una banda (fondo + texto). size en px. color/bg RGB CSS.
export async function textRegion(io, x, y, w, h, str, { size = 28, color = '#ffffff', bg = '#000000', align = 'center' } = {}) {
  await drawRegion(io, x, y, w, h, (ctx) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = color; ctx.font = `bold ${size}px sans-serif`;
    ctx.textBaseline = 'middle'; ctx.textAlign = align;
    ctx.fillText(str, align === 'center' ? w / 2 : 6, h / 2);
  });
}

// Un "modelo de pantalla" 360x360 para dashboards: dibuja con canvas 2D y vuelca regiones.
export function makeScreen() {
  const canvas = document.createElement('canvas'); canvas.width = SCREEN; canvas.height = SCREEN;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, SCREEN, SCREEN);
  return {
    canvas, ctx,
    clear(color = '#000') { ctx.fillStyle = color; ctx.fillRect(0, 0, SCREEN, SCREEN); },
    async push(io, x = 0, y = 0, w = SCREEN, h = SCREEN, opts = {}) {
      const px = canvasRegionTo565(ctx, x, y, w, h);
      await blitRegion(io, x, y, w, h, px, opts);
    },
  };
}
