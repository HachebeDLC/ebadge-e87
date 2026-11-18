# eBadge E87 · aplicación web (Web Bluetooth)

App independiente para enviar imagen / texto / GIF / vídeo al badge **E87** sin la app ZRun.
Hace toda la cadena: conectar → **autenticar (E1/SAFER+)** → avisar tipo BADGE (QIX `DC 0C`) →
subir el archivo (transferencia "grande" RCSP con CRC-16/XMODEM por paquete).

## Archivos
- `e1.js` — autenticación Bluetooth E1 (SAFER+). **Validada** contra 2 vectores reales del dispositivo.
  Si el badge no responde con SAFER+ (otra variante de chip), `rcsp.js` cae a **reflexión**: le devuelve
  su propio reto y el badge calcula la respuesta (técnica del ZNP Z01, github.com/devniz/znp-re).
- `media.js` — canvas → JPEG 368×368 (imagen única) y AVI RIFF MJPEG 368×368 (texto/varias/GIF/vídeo).
- `rcsp.js` — framing Jieli RCSP + canal QIX, auth y driver de subida.
- `app.js` — Web Bluetooth (GATT, notificaciones) y orquestación/UI.
- `index.html` — interfaz.
- `test_upload.mjs` — prueba **offline** (badge simulado): auth, CRC, bloques y reconstrucción byte a byte.
- `test_auth.mjs` — prueba **offline** de la auth: SAFER+, respaldo por reflexión y reflexión rechazada.
- `ota.js` — cliente **OTA de firmware** por BLE (Qix `0xC0`–`0xC5`): `probe()` (sin escribir) y `flash()`.
- `test_ota.mjs` — prueba **offline** del OTA contra un badge simulado (tramas + reconstrucción byte a byte).

## Cómo ejecutarla
Web Bluetooth necesita **Chrome o Edge de escritorio** y un contexto seguro (**localhost** o HTTPS).

```bash
cd scratch/web
python -m http.server 8777
```

Abre `http://localhost:8777` en Chrome/Edge (o la versión publicada: https://earnest-sunshine-6599f1.netlify.app). Enciende el modo **pairing** del E87, pulsa **Conectar**,
elige el contenido y **Enviar al badge**. "Descargar medio" guarda el JPEG/AVI generado sin enviarlo.

## Estado
- ✅ Autenticación E1, generación de medios, framing, CRC y driver de subida: **probados** (offline y en navegador).
- ✅ **Probada contra el E87 real** (2026-11-15): conexión, autenticación E1 aceptada y subida de un AVI de texto completada.
- Las escrituras GATT van por una cola única (`writeChar` en `app.js`): Web Bluetooth rechaza escrituras simultáneas.
- Notas: si el badge rechaza algo, mirar el Registro. Puntos por confirmar en vivo
  (ver `notes/protocolo-e87.md` §5): si hace falta el `DC 0C` previo, nombres/extensión aceptados,
  y el opcode de borrado para liberar memoria.

## Pruebas offline
```bash
node test_upload.mjs      # debe terminar en "reconstruccion identica: OK"
node test_auth.mjs        # debe terminar en "auth SAFER+ / reflexion / rechazo: OK"
node test_ota.mjs ../fw697/QX7413_E87_custom.ufw   # debe terminar en "TODO OK"
```
