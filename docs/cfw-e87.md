# CFW del eBadge E87 — identificación del chip y vías

Objetivo (del usuario): antes de plantear un firmware a medida, **determinar el chip Jieli exacto y sus
capacidades**. Este documento recoge eso; la parte de OTA/flasheo queda como trabajo en curso.

## 1. SoC — CONFIRMED: Jieli AC697N
Fuente: respuesta RCSP `0x03` GetTargetInfo capturada al emparejar (`scratch/att_sticker.json`,
notify a las 14:54, handle 8, uuid ae02). Decodificada campo a campo con `tools/targetinfo_decode.py`
(port de `TargetInfoResponse.parse` y los sub-parsers de `com/jieli/jl_rcsp/model/response/device/*`).

| TLV | Campo | Valor | Lectura |
|---|---|---|---|
| 12 | **projectCode** | `jl_sdk_ac697_publish` | **familia AC697N** (珠海杰理 AC6973/6974…) |
| 11 | authKey | `hE9yfseX6UdK7rFh` | clave RCSP (ASCII, 16 B); NO es la clave E1 del BLE |
| 6 | sdkType | 13 | identificador interno de SDK |
| 0 | protocolVersion (RCSP) | 2.0 | distinta del `pact_version` QIX (2.7) |
| 1 | systemInfo | batería/vol = 0 | el badge no reporta batería por este canal |
| 2 | classicBtInfo | edrAddr AA:BB:CC:DD:EE:FF | tiene dirección BT clásica aunque se use como BLE |
| 5 | version (firmware) | 0x0001 | **no coincide** con el 11.1.0.2 de la app (ese es la UI/app) |
| 7 | uBootVersion | 0x3130 | loader |
| 8 | **otaSettings** | doubleBackup=False, needBootLoader=True, singleBackupOtaWay=1, reuseSpaceOTA=0 | **OTA de banco único con loader** |
| 9 | otaState | mandatory=0, requestOta=0, expandMode=0 | sin OTA forzada pendiente |
| 10 | productInfo | vid=0x05d6(1494 Jieli), uid=0x0002, pid=0x008b | VID por defecto de Jieli |
| 13 | protocolMtu | send=272, recv=540 | MTU RCSP |
| 19 | expandFunc | `0404` | funciones ampliadas (sin descodificar) |
| 21 | fileConfiguration | `00000007` | config de ficheros |

### Qué implica el AC697N
- Núcleo **DV15 (arquitectura propia de Jieli, no ARM ni RISC-V públicos)**; por eso el emulador ARM64
  que se intentó antes no servía y la toolchain es la de Jieli.
- Flash SPI interna; el firmware se distribuye como **archivo `.ufw`** (contenedor Jieli con cabecera,
  múltiples secciones y CRC/firma).
- BR23/AC697N es la plataforma típica de pulseras/relojes BLE de bajo coste con pantalla — coherente con
  el E87 (pantalla 360×360, subida de AVI MJPEG).

## 2. Modelo de actualización — LIKELY
De `otaSettings` (TLV 8): **banco único + bootloader + singleBackupOtaWay=1, sin reuseSpace**.
- Banco único = no hay copia A/B; el nuevo firmware se escribe y se reinicia al loader para aplicarlo.
  Un fallo a medias puede dejar el equipo en modo loader (recuperable por USB, no "ladrillo" total).
- `needBootLoader=True` = el proceso pasa por el `uboot`/loader, no se auto-sobreescribe en caliente.

## 3. Autenticación del OTA — CONFIRMED (parte app) / UNKNOWN (parte loader)
`scratch/native/libjl_ota_auth.so` (ARM64, se carga como `BluetoothConstant.JL_AUTH`). Símbolos exportados
(`tools/elf_syms.py`) y `.rodata`:
- **Doble función de la lib**: hace la **auth BLE E1** (`getRandomAuthData`, `getEncryptedAuthData`,
  `setLinkKey`, `function_E1test`, `function_E21`, variante `function_xiaomi`/`register_xm_bluetooth`,
  clase `com/jieli/jl_bt_ota/impl/RcspAuth`) **y** el **procesado del firmware**. Es decir, la auth que ya
  reimplementamos en `scratch/web/e1.js` sale de aquí: lo confirma `getEncryptedAuthData` como símbolo nativo.
- **Firmware**: magic **`JLUFW`** en `.rodata`; símbolos `parse_fw_info` (1344 B), `decrypt` (204 B),
  `cd03_crc_encode`, `CRC16`, y el JNI `Java_..._ParseDataUtil_nativeFilterFile`.
- Java: `ParseDataUtil.filterFile(data, off, len)` → `nativeFilterFile(...)` (`jl_bt_ota/util/ParseDataUtil.java:33-52`).
- **Lectura (CONFIRMED):** el `.ufw` va **cifrado/ofuscado**; la app lo pasa por `nativeFilterFile`
  (internamente `parse_fw_info` + `decrypt`) **en local** antes de enviarlo al dispositivo por bloques.
  La clave de ese descifrado está embebida en la `.so` (procesable sin el dispositivo).
- **Sin criptografía asimétrica (CONFIRMED a nivel de estructura):** el conjunto COMPLETO de imports de la
  `.so` es `malloc, free, memcpy, memcmp, rand, __strlen_chk, __android_log_print, __stack_chk_fail, __cxa_*`.
  No hay SHA, RSA, AES, curvas ni aritmética de precisión múltiple. Además `decrypt` (204 B) **no hace ninguna
  llamada externa** (0 `BL` a PLT): es una transformación simétrica en línea (XOR/tabla). `parse_fw_info` solo
  llama a `malloc/memcpy/memcmp/log`. Decodificado a mano los `BL` del `.text` (vaddr=offset en esta `.so`).
  → La protección del `.ufw` es **cifrado simétrico con clave embebida + CRC16/MD5**, reproducible una vez se
  extraigan la clave y la tabla de `decrypt`. No hay firma por clave privada en el lado app.
- **Verificación en el equipo (UNKNOWN):** el dispositivo comprueba integridad por su lado — `GetDevMD5Cmd`
  (`isSupportMD5`), CRC (`cd03_crc_encode`), y aplica vía loader (`needBootLoader=True`). Queda por confirmar
  si el **loader del AC697N** añade su propia verificación de clave además del cifrado/CRC. Eso ya no se ve en
  el APK; hace falta un `.ufw` real para probar el (des)empaquetado, o volcar el loader por USB.
- **Viabilidad del CFW (LIKELY):** por el lado app, un `.ufw` rehecho (parcheado + recifrado con la clave de la
  `.so` + CRC/MD5 correctos) debería pasar. El único riesgo serio restante es una comprobación extra en el
  loader del chip, que es lo próximo a determinar con el firmware real en la mano.
- Servidor de firmware legítimo: `www.zgntec.com/hy-cloud/app/{id}/upgrade` (ver `unknowns.md`).

## 4. Vías de CFW (panorama, sin ejecutar nada todavía)
1. **Toolchain oficial de Jieli** (SDK AC697N / "fw_products"): la ruta soportada; requiere el SDK del
   fabricante (no público) y la clave de firma para que el loader acepte el `.ufw`.
2. **Parcheo del firmware existente**: volcar el `.ufw` real del E87 (del servidor o de la flash),
   desempaquetarlo con herramientas de la comunidad (jieli uboot/ufw tools) y re-firmarlo — depende de
   si la firma la impone el loader.
3. **Modo USB del loader** (JieLi "dfu"/updater por USB): los AC69xx exponen un modo de descarga por USB;
   util para recuperación y para leer/escribir flash con las utilidades de Jieli.

## 4b. API de actualización de firmware — CONFIRMED (y probada)
Flujo en `com/zijun/zrun/ui/upgrade/a.java` (`UpgradeViewModel.fetchOTAInfo`, línea 674) y
`UpgradeActivity.java:542`. Petición:

```
POST https://www.zgntec.com/hy-cloud/app/prod/upgrade      (prod normal; "dev" si test_mode)
Content-Type: application/json
User-Agent: okhttp/...
{"model":"3216","type":"OTA","version":"1.0.2","appversion":"2.8.6"}
```
- `{id}` de la ruta = `xn.g0.m()` → literal **`prod`** (o `dev` en modo test). (g0.java:492)
- `model` = `l0.h(device_serial_num, version)` = **`String.valueOf(device_serial_num)` = `"3216"`**, salvo
  remapeo por una config online (lista `ko.r0`; por defecto, 3216). (l0.java:357-364)
- `version` = del `device_firmware_version` `11.1.0.2`, tomando partes [1..3] → **`"1.0.2"`** (OTA).
  Para `type:"UI"` usa `device_ui_version` (`1.0.0`) tal cual.
- `appversion:"2.8.6"` solo en OTA.
- Respuesta esperada con actualización: JSON cuyo `body.a()`=URL de descarga del `.ufw`, `.e()`=versión,
  `.b()/.c()/.d()`=md5/tamaño/flag forzado (a.java:593-599). `downloadBin` baja ese `.ufw`.

**Probado esta sesión (2026-11-15):** el endpoint responde a model 3216 pero devuelve
`{"code":"CD000004","msg":"已是最新版本","body":null}` ("ya es la última versión") con **cualquier**
versión que le mandes (1.0.2, 1.0.0, 0.0.1, 0.0.0) e **incluso con un modelo inválido** (999999) y en el
canal `dev`. Es decir, `CD000004` es su respuesta por defecto cuando no hay build que ofrecer: **el servidor
no sirve ningún `.ufw` para este modelo ahora mismo**. No se puede sacar el firmware por esta vía hasta que
publiquen una versión más nueva que la del equipo. (La captura con mitmproxy sobre el R1 tampoco daría nada:
si el servidor dice "latest", la app no descarga.)

## 5. Qué hace falta del usuario para avanzar (cuando vuelva)
- **Vía fiable para el `.ufw`: modo USB de descarga del AC697N** y las utilidades de Jieli, para **volcar la
  flash** del propio E87 (independiente del servidor). Necesita el dispositivo conectado por USB al PC. Es el
  único camino que no depende de que haya una actualización publicada.
- Alternativa pasiva: dejar mitmproxy puesto en el R1 y esperar a que algún día el servidor ofrezca una
  actualización; poco práctico.
- Decisión de alcance: el chip ya está (AC697N) y el OTA ya está mapeado (cifrado simétrico + CRC/MD5, sin
  firma asimétrica en la app). El siguiente salto real (desempaquetar/parchear) requiere tener el `.ufw` en
  la mano, y eso pasa por el volcado USB.

## 6. Hecho sin dispositivo (esta sesión)
- Chip identificado (**AC697N**) y GetTargetInfo descodificado → `tools/targetinfo_decode.py`.
- OTA mapeado: la app descifra el `.ufw` (`JLUFW`) con `libjl_ota_auth.so::nativeFilterFile` y lo manda a
  trozos; el equipo valida con MD5/CRC y loader de banco único. La misma `.so` hace la auth E1 (confirma el
  origen de `scratch/web/e1.js`).
- **Punto en que se necesita ayuda/hardware** (el usuario avisó de que hoy no está):
  1. Conseguir un `.ufw` real del E87 — capturar la descarga de `zgntec.com` desde el R1 (mitmproxy) o
     volcar la flash por el modo USB del AC697N. Sin él no se puede probar el (des)empaquetado ni el parcheo.
  2. Confirmar en el dispositivo el AVI corregido tras **borrarle los datos** (se congeló y apagó con el AVI
     de 1 frame; `media.js` ya genera el formato idéntico al de ZRun — pendiente de reprobar).
- Siguiente paso offline posible: desensamblar `parse_fw_info`/`decrypt` de la `.so` para ver si hay firma
  por clave privada o solo cifrado+CRC (determina si el CFW por parcheo es viable).
