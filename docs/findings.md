# ZRun 2.8.6 — Inventario inicial

Objetivo: `target/xapk/com.zijun.zrun.apk` (APK base del XAPK). Decompilado con jadx 1.5.6 en `scratch/jadx`, recursos con apktool 3.0.3 en `scratch/apktool`.

## Qué es — CONFIRMED
- App compañera Android para un **smartwatch / pulsera de fitness**. Paquete `com.zijun.zrun`, versión 2.8.6 (`versionCode 2026102120`), minSdk 26, targetSdk 36.
  - Evidencia: `target/xapk/manifest.json`; actividades de salud y dispositivo en `scratch/apktool/AndroidManifest.xml` (HeartRateDetail, BODetails, BPDetail, SleepDetails, StepDetails, Menstruation, dial/watchface, AlarmClock, Contacts, etc.).
- **Código propio pequeño (251 archivos Java) bajo `com/zijun/zrun`**; el resto (≈19.700 archivos) son librerías. Paquetes propios: `base`, `core` (db, services), `model`, `ui`.
  - Evidencia: `scratch/jadx/sources/com/zijun/zrun/`.

## Hardware / BLE — CONFIRMED
- El dispositivo usa el **SoC Bluetooth de Jieli (JL / 珠海杰理)**. SDK presente: `com.jieli.{jl_rcsp, jl_bt_ota, jl_fatfs, jl_filebrowse, jl_audio_decode, bluetooth_connect, watchtool, otasdk}`.
  - Evidencia: `scratch/jadx/sources/com/jieli/`; libs nativas `lib/arm64-v8a/libjl_*.so`, `libjl_rcsp`, `libjl_ota_auth.so`, `libjl_fatfs.so` en `config.arm64_v8a.apk`.
- **RCSP** es el protocolo de app↔reloj de Jieli (comandos, OTA, watchfaces, transferencia de archivos). Es el punto de partida para entender el protocolo del dispositivo.
- Funciones de dispositivo (actividades en `ui/device/`): alarmClock, album, altitude, camera, card (NFC/tarjetas), contacts, dial (watchfaces: Massive/Custom/Ai/Video dial), interpretation, monitor (salud), music, notification, smartRemind, wechatremind, aiChat, record.

## Backend / red — CONFIRMED
- Dominio del fabricante: **zgntec.com**.
  - API: `https://admin.zgntec.com/api/v1/...` (p. ej. `.../common/file/preview`) — `ui/device/connect/a.java:1308`.
  - OTA de la app/firmware: `https://www.zgntec.com/hy-cloud/app/{id}/upgrade` — `ui/upgrade/a.java:674`.
  - Políticas/privacidad y config inicial: `https://www.zgntec.com/...` — `MyApp.java:577`, `AboutActivity.java`, `PrivacyPolicyActivity.java`.
- Stack de red: Retrofit2 + OkHttp3 + RxHttp + Drake Net (paquetes `retrofit2`, `okhttp3`, `rxhttp`, `com/drake/net`).

## SDKs de terceros notables — CONFIRMED (por manifiesto/paquetes)
- Google Mobile Ads (AdMob app id `ca-app-pub-4366565240346802~1052708666`), Firebase (Analytics, Crashlytics, Sessions), Google Play services/measurement.
- Baidu Location (`com.baidu.location`, API key en manifiesto) — geolocalización.
- iFlytek / SparkChain (`libSparkChain.so`, `com/iflytek`) — voz/IA (coincide con AiChat e "interpretation").
- FFmpeg (`libav*.so`, `libffmpegkit`) — conversión de vídeo para watchfaces de vídeo.
- Tencent/WeChat (verificación por slider, recordatorios de WeChat), TheRouter (enrutado interno, mapa en `assets/therouter/routeMap.json`), MMKV (almacenamiento).

## Permisos sensibles — CONFIRMED (manifest.json)
SMS (READ/RECEIVE), llamadas (ANSWER_PHONE_CALLS, READ_CALL_LOG, READ_PHONE_NUMBERS/STATE), CONTACTS, ubicación fina/gruesa, Bluetooth + scan/connect, cámara, micrófono, lectura de media, listener de notificaciones. Coherente con reenviar notificaciones/llamadas/SMS al reloj.

## App web independiente contra el E87 real — CONFIRMED (2026-11-15)
Prueba en vivo con `scratch/web/` en Chrome (Windows), E87 real en modo pairing. Evidencia: registro de la página.
- Conexión GATT (AE00 + QIX `c2e6fd00-…`) OK (23:21:13–23:21:16).
- **Autenticación E1/SAFER+ aceptada por el hardware**: `reto app -> badge: VERIFICADO`, `autenticacion OK` (23:21:16). Confirma `scratch/web/e1.js` / `tools/e1_e87.py` fuera de los vectores capturados.
- Boot RCSP (0x03 + 0x08 hora) OK; `QIX DC 0C` enviado antes de la subida.
- Subida de AVI de texto (3832 B, crc 0x49e6): badge devolvió MTU de datos 490 B, pidió nombre (0x20) y cerró con 0x1C → `subida COMPLETA` (23:21:31–23:21:43), sin errores en consola.
- Bug encontrado y corregido: Web Bluetooth no admite escrituras GATT simultáneas (`NetworkError: GATT operation already in progress` en la ráfaga de paquetes de un bloque 0x1D). Fix: cola única de escrituras en `scratch/web/app.js` (`writeChar` → `gattChain`). La simulación de Node no lo detectaba porque sus escrituras eran síncronas.
- **Resultado en pantalla: el E87 se congela y se apaga** (informe del usuario). Ahora hay que borrarle los datos para seguir usándolo.
- Si `DC 0C` es obligatorio sigue sin saberse (se mandó; no se ha probado sin él).

### Causa probable del cuelgue: AVI distinto del de ZRun — LIKELY
Comparé el AVI de la web (`buildAvi` antiguo) con los 4 AVI reales de ZRun en `scratch/avi/`, usando un volcado RIFF:
1. **Offsets de `idx1` (CONFIRMED como diferencia):** ZRun guarda el 1.er frame en `0x4`, contando desde el fourcc `movi`; la web guardaba `0x0`. Si el firmware busca los frames con `idx1`, en el offset 0 lee `movi` y luego toma `00dc` (0x63643030) como tamaño → lectura gigante. Encaja con un cuelgue.
2. **Disposición de la cabecera (CONFIRMED como diferencia):** en los 4 AVI de ZRun (ffmpeg Lavf60.3.100), `LIST movi` está siempre en `0x166e`, con JUNK de índice ODML, `vprp`, JUNK `odml/dmlh`, `INFO/ISFT` y JUNK de 1016 B; `avih.flags=0x910`, `maxBytesPerSec=25000`, `sugBuf=1048576`. La web ponía `movi` en `0xd4`, `flags=0x10`. Solo 8 campos cambian entre los 4 archivos reales: tamaño RIFF, usPerFrame, totalFrames, strh scale/rate/length/sugBuf, vprp refresh y tamaño de movi.
3. **JPEG (CONFIRMED como diferencia):** todos los JPEG que ZRun ha mandado, incluidos `single.jpg` y `f_sticker.jpg`, son de ffmpeg: `E0 FE DB C4 C0 DA`, con una sola DQT y una sola DHT. Chrome genera `E0 E2 DB DB C0 C4×4 DA`.
4. El AVI de la web tenía 1 frame; los de ZRun tienen 3–60.

No se puede distinguir cuál de las cuatro causó el cuelgue sin probarlas una a una en el dispositivo. Para descartarlas todas a la vez se corrigieron todas:
- `buildAvi` reescrito: **reconstruye byte a byte idénticos** los 4 AVI reales a partir de sus frames (`scratch/web/test_avi.mjs`: danmaku 170482 B, slideshow 46784 B, gif 150378 B, vídeo 163790 B, los cuatro IDENTICO).
- `normalizeJpeg` (`media.js`): reordena el JPEG de Chrome a `E0 DB C4 C0 DA` sin recodificar. En Chrome se decodifica **píxel a píxel igual** que el original (diffBytes=0).
- El texto ahora va en 12 frames a 12 fps.
- UNKNOWN: falta probarlo en el E87, después de borrarle los datos.

### Mejoras 2026-11-17 y despliegue — CONFIRMED (offline + Netlify)
- Publicada en **https://earnest-sunshine-6599f1.netlify.app** (sitio Netlify `earnest-sunshine-6599f1`, enlazado
  desde la raíz `EBadge/.netlify`). Cabeceras vía `scratch/web/_headers` (`Permissions-Policy: bluetooth=(self)`,
  `nosniff`, `no-referrer`), comprobadas con `curl -I`.
- `rcsp.js authenticate()`: si la respuesta del paso 1 no es SAFER+, responde al reto del badge por **reflexión**
  (técnica del ZNP Z01). Camino SAFER+ sin cambios. Prueba: `scratch/web/test_auth.mjs` → OK. En el E87 real: UNKNOWN.
- `media.js drawText`: interlineado proporcional a la fuente y encogido automático si no cabe (probado en Chrome).
- Detalle y candidatos para borrar ficheros (op `1A 05 01 path`): `notes/comparacion-znp-z01.md`.

## Firmware del E87 707 (ElectronicCats) descifrado — CONFIRMED (2026-11-17)
- `tools/jl_flash_decode.py` (propio) descifra `dump_E87.bin`: chipkey `0x9847` (isd_config.ini y fuerza bruta por
  entropía coinciden), appbase `0x2000`, **todos los CRC JLFS cuadran** (incluido `app.bin`, 0xF3120 B).
- Mapa: código hasta ~`0xFB000`, VM `0xFD000`, **FAT12 de medios `0x1B7000–0x3FF000`** (vacía en este volcado; quedan
  52 JPEG huérfanos de **360×360**), `key_mac` `0x3FF000`.
- Rutas de medios en el código: `SC/JPGBDG/`, `SC/JPGMY/`, `SC/JPGP/%d`, `SC/JPGN/%d`, `SC/AVI/0|1`.
- `uboot.boot`: su CRC de datos no cuadra con ningún cifrado probado (UNKNOWN). Detalle: `notes/firmware-707-decodificado.md`.

## Pendiente / UNKNOWN
- Host base real de la API REST (hay muchos `api.` ofuscados en librerías; falta fijar el cliente Retrofit propio y su `baseUrl`). → `notes/unknowns.md`.
- Detalle del protocolo RCSP sobre BLE (UUIDs de servicio/característica, formato de comandos) — requiere leer `ui/device/connect/` y `com/jieli/jl_rcsp`.
- Autenticación OTA (`libjl_ota_auth.so`) y firma de firmware.
- jadx reportó 191 métodos con error de decompilación (código ofuscado); no afecta al inventario.
