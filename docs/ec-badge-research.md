# Hallazgo clave: ElectronicCats/jieli-ble-badge-research (el MISMO badge E87)

Repo público (MIT) que hace **exactamente** nuestros dos objetivos sobre el **mismo badge E87**
("DragonJAR badge"): https://github.com/ElectronicCats/jieli-ble-badge-research
Autores: Andrés Sabas (@sabas1080) y Heikki Perea (@HeikkiRadu), Electronic Cats. Charla DragonJarCon
("Compré un e-badge otaku de 10 dólares y terminé hackeándolo"). Clon local: `scratch/jieli-ble-badge-research/`.
Partió de la skill de auditoría de APKs de DragonJAR (Android-Pentesting-Skill).

## ⚠️ Diferencia de chip CRÍTICA — su E87 ≠ nuestro E87 (CONFIRMED)
- **El suyo: AC707N / familia BR35.** `dump_E87.bin` lleva la cadena `AC707N` en offset 0x10; PCB
  `qx7613_v1.3`, USB PID 1558, UBOOT USB `4c4a:2942` ("BR35UBOOT1.00"), chipkey `0x9847`.
- **El nuestro: AC697N / familia BR30** (CONFIRMED por `projectCode jl_sdk_ac697_publish` del GetTargetInfo
  real de ZRun; ver `cfw-e87.md` §1). Hay **al menos dos variantes de hardware vendidas como "E87"**.
- **Consecuencia (IMPORTANTE):**
  - **NO flashear su `custom-fw-ac707n.ufw` ni su `dump_E87.bin` en nuestra unidad AC697N**: chip/SDK
    equivocados → brick probable; y su dump reescribe el `key_mac` → **clona su MAC** (colisión BLE).
  - Su firmware/volcado valen como **referencia de formato/descifrado** (analizables ya, sin hardware),
    no como algo a grabar en el 697.
  - Su **método** (ver abajo) sí debería portarse al AC697N, pero rehaciendo el build con el SDK del 697.
- **Pendiente antes de grabar nada**: confirmar qué chip es la unidad que el usuario tiene **abierta**
  (697 vs 707): marcado del chip con lupa, marcado de PCB, o re-leer GetTargetInfo por BLE de ESA unidad.

## El método que usan (la gran noticia para el CFW)
El OEM solo expone un punto de entrada: la **OTA BLE de la app ZRun**. Lo convierten en control total
**sin USB, sin abrir, sin loader**:
- Empaquetan **fw-custom** = su `app.bin` insertado en un `.ufw` OEM, **manteniendo el uboot OEM byte a
  byte**. Un solo `qix flash --oem` se lo entrega al uboot OEM residente, que reescribe la partición CODE
  y arranca el custom. (Un `make` crudo del SDK trae el uboot *nativo*, que NO sabe hacer eso → brick
  silencioso. Nunca grabar una imagen `make` cruda por OTA.)
- Protocolo: **Qix** en servicio BLE **FD00**, opcode **0xC0** (OTA app-only). **RCSP** convive en **AE00**
  (auth, target/sys info, FS, subida de ficheros); la auth de 6 pasos va en crudo por AE01/AE02. Esto
  encaja con lo que ya reimplementamos en `scratch/web/` (e1.js = auth; DC 0C = Qix). **Su `qix-ble` es la
  referencia pura-Python del mismo protocolo que nuestra app web** — comparar.
- El MAC es constante (vive en `key_mac`), solo cambia el nombre anunciado (custom = `EC-BADGE`). Todo se
  direcciona por MAC, nunca por nombre.
- Validado en hardware: `OEM→custom` y `custom→custom` de punta a punta (en Linux/BlueZ). `custom→OEM`
  reusa lo mismo al revés y necesita un dump de TU unidad.

## Lo que el repo nos da YA (sin hardware)
- **`.ufw` reales**: `firmware/custom-fw-ac707n.ufw` (1.079.363 B; cabecera `bcaf..` ver "1.0.3", `JLUFW`
  dentro), `tools/ufw-repack/loaderdl-base.ufw`. **Volcados OEM de 4 MB**: `firmware/dump_E87.bin`
  (AC707N) y `firmware/oem_DG01.bin` (DG01, chipkey 0xB165).
- **Herramienta UFW pura-Python**: `tools/ufw-repack/` (pack/parse + wrapper Qix de 27 B + `dump2ufw.py`),
  con `jltech` vendored (cipher/CRC/chipkey) — **sustituye a mano lo que estábamos sacando de
  `libjl_ota_auth.so`**. Y `tools/jl-flash-decrypt` (descifra la región CODE "SFC-scrambled" de un dump BR35).
- **Dump/restore wired** documentado (`docs/dump-firmware.md`): confirma nuestra receta de volcado —
  `python3 jluboottool.py "read 0x0 0x400000 oem-dump.bin"` por los pads **DP/DM/GND** en modo UBOOT. Su
  fork de jl-uboot-tool añade soporte **BR35/AC707N**; el upstream que clonamos ya trae **BR30/AC697N**.
- **Dongle USB-ISP casero**: `tools/pi-pico-jl-dongle` (Raspberry Pi Pico) — prototipo, incompleto.
- Build desde fuente: **solo Linux x86-64**, SDK `e_badge_707_sdk_200` clonable anónimamente del GitLab de
  JieLi; el custom es un patch (`patches/badge/badge-menu.patch`) sobre el SDK vanilla. Para el 697 haría
  falta el SDK equivalente del 697/BR30.

## Respuestas directas a las preguntas del usuario
1. **"¿Seguro que esos pads funcionarían si existieran?"** → **SÍ, confirmado por un equipo que lo hizo en
   este badge.** El volcado es por los pads **DP/DM/GND** del chip en modo UBOOT (los pads externos de
   carga no sirven; en la unidad abierta se llega al DP/DM del chip). Entrar a UBOOT: USB updater de Jieli,
   el dongle Pi-Pico casero, o una unidad que no arranca. El dispositivo enumera como `4c4a:2942`.
2. **"Busca un UFW"** → **Encontrado**: `.ufw` custom real + 2 volcados OEM de 4 MB + tooling UFW
   pura-Python. Sirven como referencia de formato/descifrado **ya**; **NO** para grabar en el 697 (son 707).

## Implicación de rumbo
Para el CFW quizá **no haga falta abrir ni volcar**: el camino previsto es **BLE-only** vía la OTA de ZRun.
Abrir+volcar es solo la red de seguridad (recuperación USB-ISP y la pata `custom→OEM`). Pero para ir
BLE-only en NUESTRO chip hace falta un **custom build para AC697N/BR30** (el prebuilt es 707). Si la unidad
abierta resultara ser un 707, su prebuilt serviría directamente (siempre con dump previo de seguridad).

## Precaución
Binarios y scripts del repo = contenido descargado no confiable: analizar, no ejecutar a ciegas. **No
grabar NADA** sin (a) confirmar el chip de la unidad y (b) tener un dump de seguridad de esa misma unidad.
El propio README avisa de brick por brown-out, por imagen de chip equivocado y de clonado de MAC.
