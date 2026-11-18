# Firmware del E87 descargado del servidor OEM — SIN hardware (2026-11-18)

**Logro:** se obtuvo el firmware oficial de NUESTRA unidad por red, sin dongle, sin abrir, sin brickear —
replicando lo que hace la app ZRun. Pista del vídeo de Andrés Sabas (DragonJAR, `auTi_KRarMY`): el servidor
no pide auth y entrega el firmware si iteras el `model` (nº de adaptación) y pides una versión más baja que la
instalada.

## El request (de `UpgradeViewModel` en el APK, verificado)
`com/zijun/zrun/ui/upgrade/a.java` + `xn/l0.java` (OtaConfigResolver) + `xn/g0.java`:
- URL: `POST https://www.zgntec.com/hy-cloud/app/{seg}/upgrade`, `seg` = `prod` (o `dev` si `test_mode`).
- Cuerpo JSON: `{"model": <serial>, "type": "OTA"|"UI", "version": <v>, "appversion": "2.8.6"}` (appversion solo en OTA).
- `model` = `device_serial_num` (适配号) como string, salvo remapeo en `assets/qxOtaConfig.json` por `(cur_serial,version)→new_serial` (solo cubre 783/790, otros aparatos).
- `version` = del `device_firmware_version` partido por `.`, tomando partes [1].[2].[3] (se descarta la [0]).

## Datos reales de NUESTRO E87 (de los MMKV `scratch/ZRunApp*.mmkv`)
- `device_name`=E87, `device_mac`=AA:BB:CC:DD:EE:FF (NO enviar en requests; dato privado).
- `device_serial_num` = **1552** → `model=1552`. (La nota vieja decía 3216: ERROR.)
- `device_firmware_version` = `11.1.0.2` → `version=1.0.2`. `device_ui_version`=1.0.0.

## Respuestas del servidor (2026-11-18)
- `version=1.0.2` (la instalada) → `{"code":"CD000004","msg":"已是最新版本"}` (ya es la última) → por eso la nota vieja (con 3216 y 1.0.2) no daba nada.
- `version=1.0.1/1.0.0/0.0.1` (más baja) → `CD000001` + `download_address`:
  `https://share-1329296078.cos.ap-guangzhou.myqcloud.com/OTA/prod/1552/QX7413_E87_EN_OTA_APP_20251229_V11.1.0.2.bin`
  (name `QX7413_E87_EN`, model 1552, size 1081344, version 1.0.2). COS de Tencent, descarga directa sin auth.
- `type=UI` → `CD000003` (sin imagen de UI para 1552).

## El firmware (en `scratch/fw697/`)
- `QX7413_E87_EN_OTA_APP_20251229_V11.1.0.2.bin` = 1.080.387 B, SHA256 `14484147…645d32`. Es un `.ufw` RCSP con
  wrapper Qix (`bc af`), descifrado y validado con `tools/ufw_outer.py` y `tools/jl_flash_decode.py`:
  - **chip = `AC707N`** (cabecera UFW). ⇒ **el E87 es AC707N/BR35, NO AC697N.** Confirma la marca `AC7074A5`
    del SoC y la placa qx7413. El `projectCode jl_sdk_ac697_publish` del RCSP despistaba.
  - **chipkey = `0x9847`** (de isd_config.ini; fuerza bruta por entropía coincide). **La misma que el 707 de ElectronicCats.**
  - Tabla UFW: flash.bin(CODE) 0xFB000 @0x400, isd_config.ini, ota.bin(loader) 23688 B, blimit.bin, tail.bin — igual estructura que su `custom-fw-ac707n.ufw`.
  - `flash.bin` descifrado (`scratch/fw697/flash_QX7413.bin` → `scratch/fw697/decoded/`): app.bin 0xF3100 B, VM, PRCT, key_mac @0x7FF000; TODOS los CRC JLFS cuadran.

## Qué desbloquea (IMPORTANTE)
1. **Identidad zanjada**: AC707N/BR35, misma familia que ElectronicCats → su **SDK público `e_badge_707_sdk_200`
   (br35)** compila para nosotros, y su tooling (`ufw-repack`, `qix-ble` OTA 0xC0, chipkey 0x9847) aplica. El
   bloqueo "no hay SDK 697, hay que parchear a ciegas" QUEDA ANULADO.
2. **Base OEM propia**: este `.ufw` es el OEM de NUESTRA unidad → base correcta para el fw-custom (meter app.bin
   en él manteniendo el uboot OEM) y, sobre todo, **imagen de recuperación** si algo sale mal.
3. **Vía CFW sin abrir ni dongle**: se entrega por BLE con la OTA Qix (`qix flash --oem`), y se restaura con esta
   misma OEM. Ya NO hace falta el volcado por cable para empezar.
4. **OJO placa distinta a la de EC**: la suya es qx7613 (360×360); la nuestra qx7413_EN (los AVI de ZRun son
   368×368). Mismo chip y chipkey, pero NO grabar su `custom-fw-ac707n.ufw` tal cual: su código de pantalla/pines
   puede no cuadrar. Lo correcto: recompilar del SDK 707 o parchear NUESTRO app.bin, y empaquetar en NUESTRO .ufw.

## Reproducir
```
curl -s -X POST https://www.zgntec.com/hy-cloud/app/prod/upgrade -H "Content-Type: application/json" \
  --data '{"model":"1552","type":"OTA","version":"1.0.0","appversion":"2.8.6"}'
# -> download_address ; luego curl esa URL.
```
Para otras unidades/variantes: iterar `model` (nº de adaptación) y pedir `version` baja. Es lo que hizo Andrés.

## CFW por parcheo — PIPELINE PROPIO VALIDADO (2026-11-18)
Herramienta propia `tools/jl_ufw_repack.py` (reutiliza mi `jl_flash_decode`; no ejecuta código de terceros).
Parchea el `app.bin` del `.ufw` OEM y rehace toda la cadena de CRC de dentro afuera.
- **Round-trip no-op byte a byte IDÉNTICO** sobre nuestro OEM (`roundtrip`) → cifrado+CRC correctos.
- **CFW demo** `scratch/fw697/QX7413_E87_custom.ufw`: cambia la cadena de versión `11.1.0.2`→`11.1.0.9` en app.bin
  (el truco de Andrés: "cambiar un bit visible"). Verificado: parsea limpio (chip AC707N, hdrcrc/listcrc OK),
  app.bin y app_area_head con hcrc+dcrc OK, y **diff vs OEM = 17 bytes** todos justificados (1 del string + 16 de
  los campos CRC: app.bin, app_area_head, flash.bin dcrc, listcrc, hdrcrc, Qix). `uboot.boot` queda idéntico al OEM
  (su dcrc sale "MAL" también en el OEM: cifrado desconocido, no lo enforcea el loader; no tocarlo = sin riesgo).
- Uso: `python -I tools/jl_ufw_repack.py roundtrip <ufw>` ; `... patch <in> <out> --find <ascii> --repl <ascii>`
  (igual longitud) o `--at <jlfs> <offhex> <hex>`.

### Lo que falta para GRABARLO (no hecho; necesita hardware + usuario)
1. Cliente OTA Qix `0xC0`–`0xC5` por BLE (lo tiene `qix-ble` de EC; nuestra web no). OJO auth: nuestro E87 usó
   **SAFER+/e1.js** (validado), no el cipher 707 de `auth.py` de EC → portar su flujo OTA con NUESTRA auth.
2. Badge en su pantalla de actualización + BLE. Recuperación = regrabar nuestro `.ufw` OEM (por BLE desde el custom,
   o por cable). Primer flasheo recomendado: este CFW cosmético (cambio mínimo), reversible.

## Cliente OTA Qix 0xC0-0xC5 — IMPLEMENTADO en la web (2026-11-18)
`scratch/web/ota.js` (propio; reimplementa `UpdateManager`, no ejecuta qix-ble). Usa el MISMO canal Qix FD00/FD02
que app.js abre tras autenticar (SAFER+). Protocolo verificado byte a byte:
- Trama Qix = la nuestra (`9E·chk=sum(body)&0xFF·flags·cmd·len LE16·payload`); OTA usa flags bit final **|0x01**
  (no |0x02), serial rotatorio 0..15, bit "largo" = (len+6)>20.
- `0xC0 REQ_UPDATE` payload = los **27 B del wrapper Qix**. `0xC1 RET_UPDATE` = `state(1) allow(BE32) offset(BE32)`;
  acepta si state==1 && offset==0.
- `0xC2 SEND_UPDATE_DATA` = `size(LE32)+offset(LE32)+datos`, chunks de 1024 B sobre el payload (ufw[27:]).
  `0xC3 RET_UPDATE_DATA` = `state(1) next_offset(**LE32**)` (ojo: LE, distinto del BE32 de 0xC1). El último chunk
  puede saltarse 0xC3 y mandar `0xC5` directo. `0xC5 RET_UPDATE_RESULT` = status (0 = OK).
- `validateUfw()` replica validate_qix_wrapper (bcaf, type 0x01, size, CRC-CCITT-false byte 25, JLUFW).
- **probe() NO escribe nada** (solo 0xC0→0xC1); flash() reescribe (pide confirmación en la UI).
- Test offline `scratch/web/test_ota.mjs` (badge simulado): valida wrapper, probe, y **flash reconstruye el payload
  de 1,08 MB byte a byte** → "TODO OK". Verificado también en navegador (importa, valida, sin errores en consola).
- Desplegado: https://earnest-sunshine-6599f1.netlify.app (sección "Firmware (OTA)").

**Para grabar de verdad falta solo**: el badge en su pantalla de actualización + BLE. Subir `QX7413_E87_custom.ufw`,
pulsar "Probar OTA" (sin riesgo) para ver si acepta, y si acepta, "Flashear". Recuperación = re-flashear el .ufw OEM.
AVISO: nuestro E87 autenticó con SAFER+; la OTA va por FD02 (en claro), así que la auth de conexión basta.

## Prueba en vivo 2026-11-18: el OEM gatea el OTA -> hace falta BOOTSTRAP (resuelto)
Primer intento real: conecto+autentico, probe mando REQ_UPDATE (0xC0) pero TIMEOUT, sin 0xC1. Causa (de
qix-ble/bootstrap.py): el firmware OEM AC707N ignora REQ_UPDATE si no recibe antes la secuencia de arranque Qix
que manda ZRun. Caracteristicas correctas (write FD02, notify FD01+FD03). Portado a scratch/web/ota.js runBootstrap()
(5 fases, 14 tramas): RCSP 0x06 reset_auth + trigger Qix verbatim `9E BD 0B 60 0D 00 03`; set time (Qix 0x02) +
display 0x16 + init 0x29[80]; RCSP 0x03 + Qix 0xC6[01] + 0x20[FF 07]; RCSP 0x07 + Qix 0xFF[22 00]/[24 00]; 0x29[80]
+ 0xC6[01] + 0xDC[0C]. probe()/flash() lo corren una vez antes del REQ_UPDATE; timeout REQ subido a 15-20 s (el OEM
tarda ~6 s y puede recrear servicios GATT). Smoke test OK (14 tramas en orden exacto). Desplegado.
AVISO pendiente: si tras REQ_UPDATE el OEM recrea los servicios GATT (EC lo documenta), Web Bluetooth podria perder
las notificaciones -> habria que re-descubrir caracteristicas. Se vera en la proxima prueba.

PRUEBA 2 (2026-11-18): tras el bootstrap, el probe ACEPTA (state=1, allow=262144, offset=0). El flash falló por el límite de Web Bluetooth: writeValue <=512 B (Chrome no hace GATT long-write como bleak). Fix: chunk de datos 480 B -> trama Qix 494 B, una escritura por chunk. Desplegado. Reproba el flash.

## ✅ PRUEBA 3 (2026-11-18): FLASHEO CUSTOM EXITOSO EN HARDWARE REAL
`QX7413_E87_custom.ufw` grabado por BLE con la web (bootstrap + REQ_UPDATE aceptado + chunks 480 B + RET_UPDATE_RESULT).
HITO: cadena completa validada en el E87 real — servidor OEM → descifrar → parchear app.bin → re-empaquetar (CRCs) →
OTA Qix 0xC0-0xC5 con nuestra auth SAFER+, todo desde la web, sin dongle ni abrir. Recuperación disponible
(`QX7413_E87_OEM_recuperacion.ufw`). El custom solo cambia la versión 11.1.0.2→11.1.0.9 (demo de pipeline, sin
features nuevas). Siguiente: parches reales de app.bin o build del SDK 707.

## CFW de verdad: menú de EC compilado e injertado (2026-11-18)
Build del SDK 707 en WSL (toolchain clang pi32v2 de JieLi, sha actualizado a la versión 20260730 por el usuario;
SDK d016768, patch badge-menu aplicado). `scripts/build-badge-fw.sh --board e87 [--ota]` → `app.bin` 989696 B.
Su `--ota` injerta app.bin en un slot OEM (@0x2100). Cabecera de su app.bin IDÉNTICA a la de nuestro OEM (misma
clase de imagen), y cabe en el slot (995584 B, holgura 5888 B). Injertado en NUESTRO OEM con `tools/jl_ufw_repack.py
swapapp` → `scratch/fw697/QX7413_E87_ECmenu.ufw` (nuestro uboot/config/MAC + código menú de EC). CRCs recomputados y
validados; validateUfw OK. RIESGOS al flashear (recuperables): su build es para placa qx7613/360×360 y la nuestra
qx7413 (panel quizá 368) → pantalla podría verse mal; y su auth es la del 707, no SAFER+ → por eso añadimos el "modo
recuperación" sin auth en la web. Recuperación: QX7413_E87_OEM_recuperacion.ufw (BLE) o USB-ISP por pads si brick.

## ✅✅ CFW DE EC FLASHEADO Y FUNCIONANDO EN HARDWARE (2026-11-18)
`QX7413_E87_ECmenu.ufw` (menú de EC compilado del SDK 707 + injertado en nuestro OEM) flasheado por BLE desde la web
y ARRANCA/FUNCIONA en el E87 real (qx7413). El desajuste 360 vs 368 no impidió el arranque. Cadena completa validada:
descargar OEM del servidor → descifrar → compilar app.bin de EC en WSL → injertar en nuestro OEM (jl_ufw_repack swapapp)
→ flashear por OTA Qix con bootstrap. Recuperación disponible (modo sin auth + acceptAllDevices; OEM.ufw). HITO máximo.

## Firmware MVP "display server" (2026-11-18, preparado sin batería para flashear)
Opcodes Qix propios añadidos a qix_ota_server.c (diff en scratch/fw697/display-opcodes.patch): 0xE1 FILL_RECT
(lcd->clear_screen) y 0xE0 BLIT (lcd->draw, RGB565). Panel 360x360. Compila OK (build con EBW_ALLOW_DIRTY=1 por el
reverse-check del patch). Injertado en nuestro OEM → scratch/fw697/QX7413_E87_ECmenu_display.ufw (validado). Cliente
web: scratch/web/display.js (fillScreen/fillRect/showImage) + UI "Pantalla (display server)" con botones de color e
imagen. PENDIENTE (necesita batería>25% + hardware): flashear QX7413_E87_ECmenu_display.ufw y probar (rellenar color =
primera luz; imagen línea a línea, lenta ~min). Riesgos: formato de color del driver (clear_screen RGB888 / draw
RGB565, byte-order), conflicto con LVGL si la pantalla se refresca (probar en pantalla estática). Build en WSL ~/ebadge-build.

## Capa de widgets/estado + mejoras (2026-11-18, desplegado, pendiente de probar en HW)
- Firmware: buffer de reensamblado subido a 4096 (tramas BLIT multi-línea). Recompilado e injertado en el mismo
  QX7413_E87_ECmenu_display.ufw.
- Web: display.js reescrito (fillRect/fillScreen/blitRegion multi-línea/showImage + modo rápido sin respuesta
  via otaWriteFast). widgets.js nuevo: busyBar (2 FILL_RECT = instantáneo), textRegion/drawRegion (BLIT),
  makeScreen (dashboard 360²). UI: sección "Widgets/estado" (slider→barra en vivo, texto). Test offline
  test_display.mjs → TODO OK (tramas, troceo <=512, busy-bar). Desplegado y verificado en navegador.
- Altavoz: DESCARTADO en el E87 (placa sin transductor; firmware de audio compartido con variantes caras).
  El modelo CON altavoz+micro es el ZNP Z01 (AI badge), no un E87. Repo: github.com/devniz/znp-re.
- Vía JPEG (imagen fluida) documentada como futura: API jljpeg_decode existe pero es de bajo nivel (riesgo alto a ciegas).

## Opcode de estado/control 0xE9 (2026-11-18, desplegado, pendiente HW)
Firmware: opcode QUERY 0xE9 -> responde 0xEA [batería%, g_badge_adkey_kv] (lee get_vbat_percent + el global de
tecla publicado por el patch de EC; todo en contexto BLE RX = seguro, mismo patrón que 0x27/0xC7). Recompilado e
injertado en QX7413_E87_ECmenu_display.ufw (ahora con FILL_RECT+BLIT+buffer4096+QUERY).
Web: ota.js queryState() (manda 0xE9, lee 0xEA). UI "Estado/control": "Leer estado" (batería%+tecla) y "Monitor"
(sondea ~3Hz y avisa en el Registro al pulsar el botón físico = botón→host por sondeo, seguro, sin hookear la tarea
de teclas). Test offline test_state.mjs -> OK. Desplegado + verificado en navegador.

## Takeover de pantalla 0xE7 (2026-11-18, desplegado, pendiente HW)
Riesgo resuelto: que LVGL repinte encima de nuestros dibujos. Firmware: opcode 0xE7 TAKEOVER [v] ->
lvgl_ui_task_suspend_resume(v) (API del SDK; v crudo para poder invertir polaridad desde la web sin reflashear).
Ack 0xE7 [v]. Web: display.js takeover(io,on) + casilla "Tomar pantalla" en la sección Pantalla. Recompilado e
injertado. FIRMWARE FINAL de este set: QX7413_E87_ECmenu_display.ufw = FILL_RECT+BLIT+buffer4096+QUERY(0xE9)+TAKEOVER(0xE7).
Plan de prueba (batería>25%): flashear → "Tomar pantalla" → color/busy-bar/imagen/texto → "Estado/Monitor" con el botón.
Si "Tomar pantalla" hace lo contrario (deja que el menú repinte), avisar: se invierte el valor en la web (1 línea).

## Dashboard en vivo (2026-11-18, pura web, desplegado)
scratch/web/dashboard.js: renderDashboard (hora grande + fecha + mensaje + barra batería en un canvas 360²),
diffRect (bounding box de lo que cambia entre frames, alineado a 2px), makeDashboard (runner): al iniciar hace
takeover(1) + primer frame completo, luego cada 1 s re-renderiza y envía SOLO la región cambiada (blitRegion) →
casi tiempo real; batería via queryState cada 15 s; al parar devuelve la pantalla. UI: tarjeta "Dashboard en vivo"
con mensaje, iniciar/parar y preview redondo (border-radius:50%). Test offline test_dashboard.mjs (diff) -> OK.
Verificado en navegador (renderiza, sin errores). No cambia el firmware (usa los opcodes ya existentes).
SET WEB COMPLETO: color/imagen, busy-bar, texto, estado/control+monitor botón, takeover, y dashboard en vivo.

## Calidad de imagen (2026-11-18, pura web, desplegado)
display.js: canvasRegionTo565Dither (Floyd–Steinberg → suaviza el banding de RGB565) y circularMask (negro fuera del
círculo inscrito, para la pantalla redonda). showImage(io, src, {onProgress, log, dither, circular}). UI: casillas
"Difuminar" y "Recorte circular" (ambas ON por defecto) junto al envío de imagen. Verificado en navegador: dithering
da ~71 tonos/fila en un degradado (vs 3-4 plano), recorte deja esquinas negras. No cambia el firmware.

## Rediseño de la web con la skill frontend-design (2026-11-18, desplegado)
Concepto: "panel del E87" anclado en la propia placa QX7413. Paleta de la PCB: máscara verde #0F4432, pistas #2F6E57,
serigrafía #ECEFE4, pads ENIG #D7B04A (acción principal), cobre #A2B9AC (secundario), fallo #E0604F (firmware).
Tipos: Chakra Petch (títulos) + Atkinson Hyperlegible (texto). Elemento protagonista ÚNICO: la cara redonda (#preview)
que hace de espejo de lo que se manda (relleno, imagen, barra, texto, avisos, dashboard) con bisel dorado que se
"enciende" al conectar (única animación, respeta reduced-motion) y batería. Secciones separadas por líneas tipo pista,
sin tarjetas ni sombras; firmware al final en <details> con borde rojo. Copy en español, sentence case, sin mayúsculas
de etiqueta ni puntos medios. Nuevo: sección "Avisos" (presets.js: notificación + mensaje grande). Se quitó dashPrev
(el dashboard se refleja en la cara). Revisado con capturas escritorio + móvil (cara 293x293 redonda, sin scroll lateral).
