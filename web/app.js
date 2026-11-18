// App web para el eBadge E87 (Web Bluetooth). Conecta, autentica (E1) y sube medios.
import { BadgeSession, ByteQueue } from './rcsp.js';
import { W, H, canvasToJpeg, buildAvi, drawText, drawImageCover } from './media.js';
import { OtaUpdater, validateUfw, measureThroughput, queryState } from './ota.js';
import { fillScreen, showImage, hexToRgb888, takeover } from './display.js';
import { busyBar, textRegion } from './widgets.js';
import { makeDashboard } from './dashboard.js';
import { notify, bigMessage, renderNotify, renderBigMessage } from './presets.js';

// --- UUIDs ---
const QIX_SVC = 'c2e6fd00-e966-1000-8000-bef9c223df6a';
const uuid16 = n => `0000${n}-0000-1000-8000-00805f9b34fb`;
const qix = n => `c2e6fd0${n}-e966-1000-8000-bef9c223df6a`;
const AE00 = uuid16('ae00'), AE01 = uuid16('ae01'), AE02 = uuid16('ae02');
const BATT = uuid16('180f'), BATT_LVL = uuid16('2a19');

// --- estado ---
let device, server, session, chars = {}, otaIo = null;
const rcspQ = new ByteQueue(), qixQ = new ByteQueue();

const $ = id => document.getElementById(id);
const log = (m, cls = '') => {
  const d = $('log'); const l = document.createElement('div');
  l.textContent = `${new Date().toLocaleTimeString()}  ${m}`; if (cls) l.className = cls;
  d.appendChild(l); d.scrollTop = d.scrollHeight;
};
const setStatus = (t, ok) => {
  const s = $('status'); s.textContent = t; s.className = ok ? 'ok' : 'bad';
  $('face').dataset.state = ok ? 'on' : 'off';
};
const setBattery = b => { $('faceBat').textContent = (b == null) ? '' : `${b}% de batería`; };

// ---------- espejo: la cara redonda refleja lo que se manda a la pantalla ----------
const FACE = 368, K = FACE / 360;               // canvas 368, panel 360
const faceCtx = () => $('preview').getContext('2d');
const hex6 = c => '#' + (c >>> 0).toString(16).padStart(6, '0').slice(-6);
function faceRect(x, y, w, h, c888) { const c = faceCtx(); c.fillStyle = hex6(c888); c.fillRect(x * K, y * K, w * K, h * K); }
function faceDraw(src) { const c = faceCtx(); c.clearRect(0, 0, FACE, FACE); c.drawImage(src, 0, 0, FACE, FACE); }
function faceCover(img) {
  const c = faceCtx(), iw = img.width, ih = img.height, s = Math.max(FACE / iw, FACE / ih);
  c.fillStyle = '#000'; c.fillRect(0, 0, FACE, FACE);
  c.drawImage(img, (FACE - iw * s) / 2, (FACE - ih * s) / 2, iw * s, ih * s);
}
function faceRender(fn) {                        // dibuja con un renderer de 360x360 y lo refleja
  const t = document.createElement('canvas'); t.width = 360; t.height = 360;
  fn(t.getContext('2d')); faceDraw(t);
}

// ---------- conexion ----------
async function connect() {
  if (!navigator.bluetooth) { log('Web Bluetooth no disponible (usa Chrome o Edge en HTTPS/localhost)', 'err'); return; }
  try {
    const recoveryPick = $('norauth') && $('norauth').checked;
    log(recoveryPick ? 'seleccionando dispositivo (recuperación: muestra TODOS)…' : 'seleccionando dispositivo…');
    device = await navigator.bluetooth.requestDevice(recoveryPick
      ? { acceptAllDevices: true, optionalServices: [AE00, QIX_SVC, BATT, 0x1800] }   // el CFW puede anunciarse con otro nombre
      : { filters: [{ namePrefix: 'E87' }, { namePrefix: 'E8' }, { services: [AE00] }], optionalServices: [AE00, QIX_SVC, BATT, 0x1800] });
    device.addEventListener('gattserverdisconnected', () => { setStatus('desconectado', false); setBattery(null); log('GATT desconectado', 'err'); });
    log(`conectando a ${device.name || device.id}…`);
    server = await device.gatt.connect();

    const svcAe = await server.getPrimaryService(AE00);
    chars.ae01 = await svcAe.getCharacteristic(AE01);
    chars.ae02 = await svcAe.getCharacteristic(AE02);
    await startNotify(chars.ae02, v => rcspQ.push(new Uint8Array(v.buffer)));

    try {
      const svcQ = await server.getPrimaryService(QIX_SVC);
      chars.fd02 = await svcQ.getCharacteristic(qix(2));
      for (const n of [1, 3]) {
        try { const c = await svcQ.getCharacteristic(qix(n)); await startNotify(c, v => qixQ.push(new Uint8Array(v.buffer))); } catch {}
      }
      log('canal QIX listo');
    } catch (e) { log('QIX no disponible (' + e.message + '), se seguira solo con RCSP', 'warn'); }

    try {
      const sb = await server.getPrimaryService(BATT);
      const bc = await sb.getCharacteristic(BATT_LVL);
      const bv = await bc.readValue(); log(`bateria: ${bv.getUint8(0)}%`); setBattery(bv.getUint8(0));
    } catch {}

    session = new BadgeSession({
      rcspQ, qixQ,
      rcspWrite: u => writeChar(chars.ae01, u),
      qixWrite: u => writeChar(chars.fd02, u),
    }, m => log(m));

    setStatus(`conectado a ${device.name || 'E87'}`, true);
    const recovery = $('norauth') && $('norauth').checked;
    if (recovery) {
      log('MODO RECUPERACIÓN: conectando sin autenticar (solo para regrabar firmware)', 'warn');
    } else {
      log('autenticando…');
      await session.authenticate();
      await session.boot();
    }
    setStatus(recovery ? `recuperación (${device.name || 'E87'})` : `listo (${device.name || 'E87'})`, true);
    $('send').disabled = recovery;      // sin auth la subida de medios no va; solo OTA
    if (chars.fd02) {
      otaIo = { otaWrite: u => writeCharResp(chars.fd02, u), otaWriteFast: u => writeChar(chars.fd02, u), qixQ, rcspWrite: u => writeChar(chars.ae01, u), rcspQ };
      $('otaprobe').disabled = false; $('otaflash').disabled = false; $('otaspeed').disabled = false;
      for (const id of ['scrRed','scrGreen','scrBlue','scrBlack','scrFill','scrSend','bbSend','scrTextSend','stRead','dashStart','dashStop','pNotify','pBigSend']) $(id).disabled = false;
      dash = makeDashboard(otaIo, { getMessage: () => $('dashMsg').value, log: (m, c) => log(m, c) });
      if (!_dashPrev) _dashPrev = setInterval(() => { try { if (dash && _dashOn) dash.renderPreviewTo(faceCtx(), FACE, FACE); } catch {} }, 1000);
    } else {
      log('canal Qix no disponible: OTA de firmware deshabilitado', 'warn');
    }
    log(recovery ? 'conectado en modo recuperación — usa "Flashear" con tu .ufw OEM' : 'conectado y autenticado — listo para enviar', 'ok');
  } catch (e) { log('ERROR conexion: ' + (e.message || e), 'err'); setStatus('error', false); }
}

async function startNotify(ch, cb) {
  await ch.startNotifications();
  ch.addEventListener('characteristicvaluechanged', e => cb(e.target.value));
}
// Web Bluetooth serializa las operaciones GATT: dos escrituras a la vez dan
// "GATT operation already in progress". Encadenamos todas las escrituras en una
// sola cola para que salgan una tras otra aunque quien llama no haga await.
let gattChain = Promise.resolve();
function writeChar(ch, u) {
  const p = gattChain.then(() => doWrite(ch, u));
  gattChain = p.catch(() => {});   // el error se propaga a quien espera, pero la cola sigue viva
  return p;
}
async function doWrite(ch, u) {
  if (!ch) throw new Error('caracteristica no disponible');
  const buf = u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
  if (ch.properties && ch.properties.writeWithoutResponse && ch.writeValueWithoutResponse) {
    return ch.writeValueWithoutResponse(buf);
  }
  return ch.writeValue(buf);
}
// Escritura CON respuesta (para la OTA: control de flujo fiable), por la misma cola.
function writeCharResp(ch, u) {
  const p = gattChain.then(() => {
    if (!ch) throw new Error('canal Qix no disponible');
    const buf = u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
    return ch.writeValue(buf);
  });
  gattChain = p.catch(() => {});
  return p;
}

// ---------- generacion de medios ----------
function newCanvas() { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; }
async function loadImage(file) {
  const bmp = await createImageBitmap(file);
  return bmp;
}

async function buildMedia() {
  const mode = $('mode').value;
  const canvas = newCanvas(); const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (mode === 'text') {
    drawText(ctx, $('text').value || 'Hola', { font: 'bold ' + ($('fontsize').value || 44) + 'px sans-serif' });
    preview(canvas);
    const jpg = await canvasToJpeg(canvas, 0.92);
    // ZRun manda el texto como 60 frames a 12 fps; usamos 12 (1 s en bucle) para no alargar la subida.
    return { data: buildAvi(Array(12).fill(jpg), 83333), ext: 'avi', kind: 'AVI texto 12 frames' };
  }
  if (mode === 'image') {
    const f = $('files').files[0]; if (!f) throw new Error('elige una imagen');
    drawImageCover(ctx, await loadImage(f)); preview(canvas);
    const jpg = await canvasToJpeg(canvas, 0.92);
    return { data: jpg, ext: 'jpg', kind: 'JPEG unico' };
  }
  if (mode === 'images') {
    const fs = [...$('files').files]; if (!fs.length) throw new Error('elige varias imagenes');
    const secs = Math.max(1, +$('secs').value || 3);
    const frames = [];
    for (const f of fs) { drawImageCover(ctx, await loadImage(f)); preview(canvas); frames.push(await canvasToJpeg(canvas, 0.92)); }
    return { data: buildAvi(frames, secs * 1000000), ext: 'avi', kind: `AVI pase ${frames.length} img @ ${secs}s` };
  }
  if (mode === 'gif') {
    const f = $('files').files[0]; if (!f) throw new Error('elige un GIF');
    const frames = await gifFrames(f, ctx, canvas);
    return { data: buildAvi(frames, 83333), ext: 'avi', kind: `AVI GIF ${frames.length} frames` };
  }
  if (mode === 'video') {
    const f = $('files').files[0]; if (!f) throw new Error('elige un video');
    const frames = await videoFrames(f, ctx, canvas);
    return { data: buildAvi(frames, 83333), ext: 'avi', kind: `AVI video ${frames.length} frames @12fps` };
  }
  throw new Error('modo desconocido');
}

async function gifFrames(file, ctx, canvas) {
  if (!('ImageDecoder' in window)) throw new Error('ImageDecoder no soportado; prueba otro navegador');
  const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' });
  await dec.tracks.ready; const n = dec.tracks.selectedTrack.frameCount || 1;
  const frames = [];
  for (let i = 0; i < n; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    drawImageCover(ctx, image); frames.push(await canvasToJpeg(canvas, 0.9)); image.close();
    if (i === 0) preview(canvas);
  }
  return frames;
}

async function videoFrames(file, ctx, canvas) {
  const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(file);
  await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error('video ilegible')); });
  const dur = Math.min(v.duration, 20); const step = 1 / 12; const frames = [];
  for (let t = 0; t < dur; t += step) {
    await new Promise(r => { v.onseeked = r; v.currentTime = t; });
    drawImageCover(ctx, v); frames.push(await canvasToJpeg(canvas, 0.85));
    if (frames.length === 1) preview(canvas);
    if (frames.length >= 240) break; // tope 20s @12fps
  }
  URL.revokeObjectURL(v.src); return frames;
}

function preview(canvas) {
  const p = $('preview'); const ctx = p.getContext('2d');
  ctx.clearRect(0, 0, p.width, p.height); ctx.drawImage(canvas, 0, 0, p.width, p.height);
}

// ---------- enviar ----------
async function send() {
  if (!session) return;
  $('send').disabled = true;
  try {
    log('generando medio…');
    const m = await buildMedia();
    log(`${m.kind}: ${m.data.length} B`);
    const name = `f_${Date.now()}.${m.ext}`;
    session.setFileTypeBadge();
    const bar = $('bar');
    await session.uploadFile(m.data, name, (s, t) => { bar.value = s; bar.max = t; $('pct').textContent = Math.round(100 * s / t) + '%'; });
    log('ENVIADO ✔  ' + name, 'ok');
  } catch (e) { log('ERROR envio: ' + (e.message || e), 'err'); }
  $('send').disabled = false;
}

// descarga local del medio generado (para depurar sin dispositivo)
async function download() {
  try {
    const m = await buildMedia();
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([m.data]));
    a.download = `badge.${m.ext}`; a.click();
    log(`descargado badge.${m.ext} (${m.data.length} B)`);
  } catch (e) { log('ERROR: ' + e.message, 'err'); }
}

// ---------- OTA de firmware ----------
async function readFw() {
  const f = $('fwfile').files[0];
  if (!f) throw new Error('elige un archivo .ufw');
  return new Uint8Array(await f.arrayBuffer());
}
async function otaProbe() {
  if (!otaIo) { log('conecta y autentica primero', 'warn'); return; }
  try {
    const u = await readFw(); validateUfw(u);
    log(`firmware ${u.length} B · wrapper Qix válido`);
    otaIo.qixQ.items.length = 0;                       // descartar notificaciones viejas
    const r = await new OtaUpdater(otaIo, m => log(m)).probe(u);
    log(r.accepted ? 'OTA: el badge ACEPTA la imagen (no se escribió nada)'
                   : `OTA: no acepta limpio (state=${r.state}, offset=${r.offset})`,
        r.accepted ? 'ok' : 'warn');
  } catch (e) { log('OTA probe ERROR: ' + (e.message || e), 'err'); }
}
async function otaFlash() {
  if (!otaIo) { log('conecta y autentica primero', 'warn'); return; }
  let u;
  try { u = await readFw(); validateUfw(u); } catch (e) { log('OTA ERROR: ' + e.message, 'err'); return; }
  const name = $('fwfile').files[0].name;
  if (!confirm(`Vas a REESCRIBIR el firmware del badge con «${name}» (${u.length} B).\n\n`
    + 'Es irreversible sin la imagen OEM de recuperación. El badge debe estar en su pantalla de actualización.\n\n¿Continuar?')) {
    log('flasheo cancelado', 'warn'); return;
  }
  $('otaprobe').disabled = true; $('otaflash').disabled = true; $('send').disabled = true;
  try {
    otaIo.qixQ.items.length = 0;
    const bar = $('otabar');
    await new OtaUpdater(otaIo, m => log(m)).flash(u, f => {
      bar.value = f; $('otapct').textContent = Math.round(f * 100) + '%';
    });
    log('FIRMWARE FLASHEADO ✔ — el badge reinicia y aplica la imagen', 'ok');
  } catch (e) { log('OTA flash ERROR: ' + (e.message || e), 'err'); }
  $('otaprobe').disabled = false; $('otaflash').disabled = false; $('send').disabled = false;
}

async function otaSpeed() {
  if (!otaIo) { log('conecta primero', 'warn'); return; }
  $('otaspeed').disabled = true;
  try { await measureThroughput(otaIo, 64 * 1024, m => log(m)); }
  catch (e) { log('medición ERROR: ' + (e.message || e), 'err'); }
  $('otaspeed').disabled = false;
}

// ---------- pantalla (display server) ----------
async function scrFill(color) {
  if (!otaIo) { log('conecta primero', 'warn'); return; }
  try { await fillScreen(otaIo, color); faceRect(0, 0, 360, 360, color); log('pantalla: relleno enviado', 'ok'); }
  catch (e) { log('pantalla ERROR: ' + (e.message || e), 'err'); }
}
async function scrSendImg() {
  if (!otaIo) { log('conecta primero', 'warn'); return; }
  const f = $('scrImg').files[0]; if (!f) { log('elige una imagen', 'warn'); return; }
  $('scrSend').disabled = true;
  try {
    const bmp = await createImageBitmap(f);
    faceCover(bmp);
    const bar = $('scrBar');
    await showImage(otaIo, bmp, {
      onProgress: p => { bar.value = p; $('scrPct').textContent = Math.round(p * 100) + '%'; },
      log: (m, c) => log(m, c),
      dither: $('imgDither').checked, circular: $('imgCircle').checked,
    });
    log('pantalla: imagen enviada ✔', 'ok');
  } catch (e) { log('pantalla ERROR: ' + (e.message || e), 'err'); }
  $('scrSend').disabled = false;
}

// ---------- widgets / estado ----------
let _bbBusy = false, _bbPending = false;
async function bbUpdate() {
  if (!otaIo) return;
  if (_bbBusy) { _bbPending = true; return; }           // coalesce: no saturar el BLE
  _bbBusy = true;
  do {
    _bbPending = false;
    try {
      const f = (+$('bbVal').value) / 100, fg = hexToRgb888($('bbColor').value);
      faceRect(20, 160, 320, 40, 0x222831); faceRect(20, 160, Math.round(320 * f), 40, fg);
      await busyBar(otaIo, 20, 160, 320, 40, f, { fg, bg: 0x222831 });
    }
    catch (e) { log('barra ERROR: ' + (e.message || e), 'err'); _bbPending = false; }
  } while (_bbPending);
  _bbBusy = false;
}
async function scrTextSend() {
  if (!otaIo) { log('conecta primero', 'warn'); return; }
  const txt = $('scrText').value || '';
  try {
    const c = faceCtx(); c.fillStyle = '#000'; c.fillRect(0, 232 * K, FACE, 56 * K);
    c.fillStyle = '#fff'; c.font = `bold ${34 * K}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(txt, FACE / 2, (232 + 28) * K);
    await textRegion(otaIo, 0, 232, 360, 56, txt, { size: 34 }); log('texto enviado', 'ok');
  }
  catch (e) { log('texto ERROR: ' + (e.message || e), 'err'); }
}

// ---------- avisos (presets) ----------
async function pNotify() {
  if (!otaIo) { log('conecta primero', 'warn'); return; }
  const opts = { icon: $('pIcon').value, title: $('pTitle').value, text: $('pText').value };
  $('pNotify').disabled = true;
  try { faceRender(ctx => renderNotify(ctx, opts)); await notify(otaIo, opts); log('aviso mostrado', 'ok'); }
  catch (e) { log('aviso ERROR: ' + (e.message || e), 'err'); }
  $('pNotify').disabled = false;
}
async function pBigSend() {
  if (!otaIo) { log('conecta primero', 'warn'); return; }
  const t = $('pBig').value;
  $('pBigSend').disabled = true;
  try { faceRender(ctx => renderBigMessage(ctx, t)); await bigMessage(otaIo, t); log('mensaje mostrado', 'ok'); }
  catch (e) { log('mensaje ERROR: ' + (e.message || e), 'err'); }
  $('pBigSend').disabled = false;
}

// ---------- estado / control (botón) ----------
let _stTimer = null, _stLastKey = null;
const NOKEY = new Set([0, 0xff]);         // valores de "sin tecla" probables
async function stRead() {
  if (!otaIo) { log('conecta primero', 'warn'); return; }
  try { const s = await queryState(otaIo); $('stInfo').textContent = `Batería ${s.battery}%, tecla ${s.key}`; setBattery(s.battery); return s; }
  catch (e) { log('estado ERROR: ' + (e.message || e), 'err'); }
}
function stMonitor(on) {
  if (_stTimer) { clearInterval(_stTimer); _stTimer = null; }
  if (!on) return;
  _stLastKey = null;
  _stTimer = setInterval(async () => {
    if (!otaIo) return;
    try {
      const s = await queryState(otaIo, 1500);
      $('stInfo').textContent = `Batería ${s.battery}%, tecla ${s.key}`; setBattery(s.battery);
      if (_stLastKey !== null && s.key !== _stLastKey && !NOKEY.has(s.key)) log(`🔘 BOTÓN pulsado (kv=${s.key})`, 'ok');
      _stLastKey = s.key;
    } catch (e) { /* un fallo puntual no detiene el monitor */ }
  }, 350);
}

// ---------- dashboard ----------
let dash = null, _dashPrev = null, _dashBat = null, _dashOn = false;
async function dashStart() {
  if (!otaIo) { log('conecta primero', 'warn'); return; }
  if (!dash) dash = makeDashboard(otaIo, { getMessage: () => $('dashMsg').value, log: (m, c) => log(m, c) });
  try { const s = await queryState(otaIo, 1500); if (s) { dash.setBattery(s.battery); setBattery(s.battery); } } catch {}
  _dashOn = true; dash.renderPreviewTo(faceCtx(), FACE, FACE);
  await dash.start();
  if (_dashBat) clearInterval(_dashBat);
  _dashBat = setInterval(async () => { try { const s = await queryState(otaIo, 1500); dash.setBattery(s.battery); } catch {} }, 15000);
}
async function dashStop() {
  _dashOn = false;
  if (_dashBat) { clearInterval(_dashBat); _dashBat = null; }
  if (dash) { try { await dash.stop(); } catch (e) { log('dashboard stop ERROR: ' + (e.message || e), 'err'); } }
}

function refreshControls() {
  const mode = $('mode').value;
  $('row-text').style.display = mode === 'text' ? '' : 'none';
  $('row-files').style.display = (mode !== 'text') ? '' : 'none';
  $('row-secs').style.display = mode === 'images' ? '' : 'none';
  $('files').multiple = mode === 'images';
  $('files').accept = mode === 'gif' ? 'image/gif' : mode === 'video' ? 'video/*' : 'image/*';
}

addEventListener('DOMContentLoaded', () => {
  $('connect').onclick = connect;
  $('send').onclick = send;
  $('download').onclick = download;
  $('otaprobe').onclick = otaProbe;
  $('otaflash').onclick = otaFlash;
  $('otaspeed').onclick = otaSpeed;
  $('scrRed').onclick = () => scrFill(0xff0000);
  $('scrGreen').onclick = () => scrFill(0x00ff00);
  $('scrBlue').onclick = () => scrFill(0x0000ff);
  $('scrBlack').onclick = () => scrFill(0x000000);
  $('scrFill').onclick = () => scrFill(hexToRgb888($('scrColor').value));
  $('scrSend').onclick = scrSendImg;
  $('bbVal').oninput = () => { $('bbPct').textContent = $('bbVal').value + '%'; bbUpdate(); };
  $('bbSend').onclick = bbUpdate;
  $('scrTextSend').onclick = scrTextSend;
  $('stRead').onclick = stRead;
  $('stMon').onchange = () => stMonitor($('stMon').checked);
  $('dashStart').onclick = dashStart;
  $('dashStop').onclick = dashStop;
  $('pNotify').onclick = pNotify;
  $('pBigSend').onclick = pBigSend;
  $('scrTake').onchange = async () => { if (!otaIo) { log('conecta primero', 'warn'); return; } try { await takeover(otaIo, $('scrTake').checked); log('pantalla: ' + ($('scrTake').checked ? 'tomada (menú suspendido)' : 'devuelta al menú'), 'ok'); } catch (e) { log('takeover ERROR: ' + (e.message || e), 'err'); } };
  $('mode').onchange = refreshControls;
  refreshControls();
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { // cara en reposo: invita a conectar
    if ($('face').dataset.state === 'on') return;
    const c = faceCtx(); c.fillStyle = '#000'; c.fillRect(0, 0, FACE, FACE);
    c.fillStyle = '#A2B9AC'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '600 30px "Chakra Petch", sans-serif'; c.fillText('Sin conectar', FACE / 2, FACE / 2 - 14);
    c.font = '20px "Atkinson Hyperlegible", sans-serif'; c.fillText('Pulsa Conectar', FACE / 2, FACE / 2 + 22);
  });
  if (!navigator.bluetooth) log('Aviso: este navegador no tiene Web Bluetooth. Usa Chrome/Edge de escritorio.', 'warn');
});
