# Comparación: nuestra app web (scratch/web) vs qix-ble de ElectronicCats

Objetivo del usuario: comparar nuestro "Qix" con el suyo, junto con el SDK. Clon suyo en
`scratch/jieli-ble-badge-research/tools/qix-ble/`. Ambos hablan el mismo badge (E87) pero **variantes de
chip distintas** (nuestro AC697N/BR30 vs su AC707N/BR35) — y eso se nota justo en la auth.

## 1. Autenticación — ⚠️ HALLAZGO: cifrado DISTINTO entre 697 y 707 (misma clave) — CONFIRMED
Los dos usan **la misma clave** `06775f87918dd423005df1d8cf0c142b` y el mismo `112233332211`, y el **mismo
handshake de 6 pasos** por AE01/AE02 (00‖rand, 01‖enc, "\x02pass", 00‖reto, 01‖enc, "\x02pass"). Pero la
**función de cifrado es otra**:
- **Nuestro `scratch/web/e1.js` = SAFER+/E1 de Bluetooth** (tablas EXP/LOG base 45 mod 257, permutación P,
  ktilde). Sale de `libjl_ota_auth.so`. **Validado contra nuestro AC697N real** (el badge aceptó un reto
  nuevo → `autenticacion OK`). Para el 697 es el correcto.
- **Su `qix_ble/auth.py` = cifrado propio JieLi de `libjl_auth.so`** (SBOX/ISBOX/KS_TABLE de 256 B +
  "Fibonacci butterfly" + fases XOR/ADD condicionadas por MASK 0x9999). Validado contra su AC707N (btsnoop).
- Son **algoritmos diferentes** (primitivas distintas), no dos vistas del mismo. Conclusión: **cada
  variante de E87 autentica con un cifrado distinto**, aunque compartan la clave. 
- **Implicación práctica:** su `qix-ble` tal cual **no autenticaría nuestro 697** (usaría el cipher del
  707). Para reusar su tooling en el 697 hay que **sustituir su `auth.py` por nuestra SAFER+ (e1.js)**. Y
  al revés, nuestra e1.js no vale para su 707. (Pendiente de verificar en vivo si algún 697 usa el cipher
  de ellos; nuestra evidencia dice SAFER+.)

## 2. Framing Qix — coincide (CONFIRMED)
- Nuestro `qixFrame`: `9E · chk · flags · cmd · len(LE,2) · payload`. Su `opcodes.py` confirma el marco:
  `CMD_MARK = 0x9E`. Nuestra `setFileTypeBadge()` = `_qix(0xDC,[0x0C])` = **`CMD_SET_SEND_FILE_TYPE`(0xDC)**
  con device_function BADGE. Todo casa con su extracción de `com.qix.library.command.CommandCode` (136 ops).
- Framing RCSP (`fe dc ba · flag · op · len(BE,2) · payload · ef`) idéntico en los dos.

## 3. Lo que a NOSOTROS nos falta para el CFW: la OTA Qix (0xC0–0xC5)
Nuestra app solo hace **subida de archivo** (RCSP "grande": 0x21/0x27/0x1B, datos 0x1D, nombre 0x20, fin
0x1C) — para mandar media, no firmware. La **OTA de firmware** usa otros opcodes Qix que **no tenemos**:
- `CMD_REQ_UPDATE=0xC0` (arranca OTA; el `qix flash --oem` del repo), `CMD_RET_UPDATE=0xC1`,
  `CMD_SEND_UPDATE_DATA=0xC2`, `CMD_RET_UPDATE_DATA=0xC3`, `CMD_REQ_UPDATE_CON=0xC4`,
  `CMD_RET_UPDATE_RESULT=0xC5`.
- Su implementación de referencia a portar: `qix_ble/rcsp_ota.py`, `update_manager.py`, `patchflash.py`,
  `stager.py` (STAGER es el camino legacy), y el wrapper `tools/ufw-repack/wrap_qix.py` (27 B).
- ⚠️ Aviso del repo: `CMD_SET_TEST_MODE=0xA0` — si se activa TEST_MODE (p.ej. su `qix dump --auth`), el
  badge **rechaza en silencio** `REQ_UPDATE`. Hay que apagar/encender para limpiarlo. Nuestra app no lo toca.

## 4. Contenedor UFW — su tooling nos lo da hecho (pura Python)
`tools/ufw-repack/` (sin wine): `parse_outer.py`, `repack_ufw.py`, `make_app_only_ufw.py`, `swap_app.py`,
`transplant_ota.py`, `dump2ufw.py`, `wrap_qix.py`, con `jltech` vendored (cipher/CRC/chipkeybin). **Sustituye
lo que estábamos sacando a mano de `libjl_ota_auth.so`** para el lado contenedor. 
- OJO **chipkey**: el suyo es `0x9847` (707). El chipkey del 697 es **desconocido** y NO es el `authKey`
  RCSP `hE9yfseX6UdK7rFh` (eso es otra cosa). Saldría del **volcado** del 697 (o 0x0000 si no está quemado).

## 5. El SDK — CAZADO: no hay SDK del 697 abierto (CONFIRMED 2026-11-16)
- Vanilla del 707: **`gitlab.zh-jieli.com/e_badge/e_badge_707_sdk_200`** — **clonable anónimo confirmado**
  (control: `git ls-remote` → HEAD `d0167685…`; proyecto id 1463, creado 2025-09-09). ~1.1 GB, `--depth 1`
  basta. El custom es un patch sobre él (`patches/badge/badge-menu.patch`). Build **solo Linux x86-64** +
  wine/docker para `isd_download.exe`.
- **SDK del 697/BR30: NO existe uno accesible.** Comprobado por la API de GitLab:
  - El grupo `e_badge` expone **un solo** proyecto público: el `e_badge_707_sdk_200`. Búsqueda global de
    "697" en ese GitLab → **vacío** (`[]`). Todos los nombres `e_badge_697_sdk_*` que probé → "HTTP Basic:
    Access denied" (privado o inexistente; GitLab no distingue).
  - **Y el SDK público del 707 NO sirve para el 697**: su `SDK/cpu/` trae **solo `br35`** (más genéricos
    components/config/power); **`SDK/cpu/br30` no existe** (`[]`). Sin los ficheros de CPU/loader/maskrom
    del br30 no se puede compilar para el AC697N.
  - GitHub Jieli-Tech: solo el **AC63/AC69 BT SDK genérico** (`fw-AC63_BT_SDK`, sin pantalla/LVGL, "AC69 sin
    audio"), el bootloader y las libs de OTA del lado app. Hay un "AC697N Earphone SDK" en las notas de
    versión, pero earphone ≠ badge con pantalla (no trae board/LVGL/QSPI del display).
- **Conclusión de seguridad**: el camino **"construir firmware 697 desde el SDK" está BLOQUEADO** (SDK
  cerrado, necesitaría cuenta/agente de Jieli o el fabricante). → Para el CFW del 697 sin SDK, la vía
  realista es **volcar un 697 y PARCHEAR su firmware OEM** (modificar el binario volcado y re-empaquetar
  con `ufw-repack`), no compilar. El volcado sigue siendo el artefacto clave; el SDK del 707 queda solo
  como **referencia de arquitectura** (no compilable para br30).

## 6. Hoja de ruta para el CFW del 697 (lo que falta, en orden)
1. **Volcar un 697** (wired/UBOOT; el usuario acepta sacrificar una unidad → se puede forzar UBOOT por
   "arranque fallido" sin dongle, pero eso da imagen corrupta; para OEM limpio hace falta el handshake/
   dongle). El volcado da: uboot OEM 697, chipkey 697, layout, y la copia de recuperación.
2. **Conseguir el SDK 697/BR30** y compilar `app.bin` (Linux).
3. **Empaquetar fw-custom**: `app.bin` dentro de un `.ufw` OEM **del 697** (de su volcado), manteniendo el
   uboot OEM — con su `ufw-repack` adaptado al chipkey/offsets del 697.
4. **Flashear por BLE** con su `qix-ble`, pero con **nuestra auth SAFER+ (e1.js → equivalente Python)** en
   lugar de su `auth.py`, y los opcodes OTA 0xC0–0xC5.

## Resumen de una línea
Nuestro Qix y el suyo coinciden en framing y en la subida de ficheros; **divergen en la auth (SAFER+ en el
697 vs cipher propio en el 707)**; a nosotros nos falta la **OTA 0xC0–0xC5** (que ellos tienen) y a su
tooling le falta **ser del 697** (chipkey/SDK/uboot), que solo se obtiene **volcando un 697**.
