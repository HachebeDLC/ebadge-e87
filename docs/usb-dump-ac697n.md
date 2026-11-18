# Receta: volcar la flash del E87 (Jieli AC697N) por USB — vía jl-uboot-tool

Objetivo: sacar el firmware real del E87 (imagen de flash) conectándolo por USB al PC. El servidor no
sirve ninguna actualización (`cfw-e87.md` §4b), así que el volcado es la **única vía fiable** para tener
material que desempaquetar/parchear.

Vía elegida: **B — `kagaimiq/jl-uboot-tool`** (open-source, sin dongle de pago). La vía A (dongle oficial
de Jieli) queda como plan de reserva al final.

> **No ejecutado todavía.** Esto es la preparación en frío para cuando tengas el E87 por cable. El repo ya
> está clonado y verificado (ver §1). Nada se ha corrido contra hardware.

---

## 0. Estado de la preparación (hecho sin el dispositivo)
- Repo clonado en `scratch/jl-uboot-tool/` (solo leído, no ejecutado).
- **Soporte del AC697N CONFIRMED en el propio repo** (no solo "seems to work" genérico):
  - `data/chips.yaml` → familia **`br30`** incluye `AC697N/AD697N/JL697N/AC897N`, arch `pi32v2`.
  - `data/usb-loaders.yaml` → `br30: file: loaderblobs/usb/br30loader.bin, address: 0x2000,
    encryption: MengLi, block-size: 512`. **El loader existe** (`br30loader.bin`, 24576 B).
  - La herramienta **sube ese loader sola** al entrar y hace el cifrado/descifrado **MengLi**
    automáticamente (quirk `memory-rw-mengli-crypt: yes` en la entrada `uboot1.00` del br30). No hay que
    tocar nada de eso a mano.
- Sigue siendo **LIKELY** (no probado por nosotros en un AC697N real), pero el chip y su loader vienen de
  serie en la herramienta: es una base sólida.

---

## 1. Montaje en Windows (se puede dejar listo ya)
1. **Python**: hay `py` (3.14) y `python` (3.8) en el PC; cualquiera vale (requiere Python 3).
2. **Dependencias** (de `requirements.txt`): `crcmod pyyaml pycryptodomex tqdm`.
   ```
   py -m pip install crcmod pyyaml pycryptodomex tqdm
   ```
3. **Driver: NINGUNO que instalar.** Corrección importante respecto a la idea inicial — **no** hace falta
   Zadig/WinUSB/libusb. La herramienta habla **SCSI crudo** contra el volumen del disco
   (`win32port.py`: abre `\\.\HardDiskVolumeN` con `CreateFile` + `IOCTL_SCSI_PASS_THROUGH_DIRECT`). El E87
   en modo descarga aparece como un **disco USB normal** y el driver de almacenamiento de Windows ya sirve.
4. **Administrador (imprescindible):** abrir el volumen crudo exige privilegios → ejecutar la herramienta
   en una consola **"Ejecutar como administrador"**. Sin ella, `jldevfind.py` no ve el dispositivo
   (PermissionError silencioso).

---

## 1b. Vía 0 (NUEVA, sin dongle): el modo `UDISK` del firmware de serie — probar PRIMERO
Evidencia (ElectronicCats, `scripts/hw-vector-b/README.md`, E87 707 placa qx7613): con `DP/DM/5V/GND` a un host
USB, el firmware OEM **enumera solo, sin key 0x16EF**: dispositivo compuesto (almacenamiento + audio USB + HID),
VID `0x3654`, que se desconecta a los ~8,5 s y vuelve cada ~10-11 s. El disco es una FAT12 de 2,28 MB (4672
sectores) con la carpeta `BAG/` = la FAT de medios de `0x1B7000` (`firmware-707-decodificado.md` §2). Lo que nos da,
sin riesgo, en orden:
1. **Identidad del chip**: el INQUIRY SCSI dice `BR35 UDISK 1.00` en el 707. En Windows sale en el nombre del disco
   (Administrador de dispositivos / `Get-Disk`). Si el nuestro dice **`BR30`** → AC697N confirmado; si dice `BR35` →
   la marca `AC7074A5` tenía razón. Zanja el conflicto chip/software.
2. **Borrar los medios** del E87 colgado: es un disco FAT normal → borrar/formatear desde el Explorador (pendiente de
   `findings.md`). Haz antes una copia del contenido.
3. **Volcado sin dongle, quizá**: con el disco enumerado, `py jluboottool.py --chip br30 …` (consola de
   Administrador) le manda un comando SCSI privado de JieLi; si el firmware trae el gancho `private_scsi_cmd` →
   `go_mask_usb_updata`, el chip salta a UBOOT y se vuelca. En el 707 OEM LIKELY no está (ElectronicCats, 95 %, sin
   probar); en el 697 **UNKNOWN**. Hay que ser rápido o repetirlo: el disco solo dura ~8 s por ciclo (la herramienta
   reintenta en bucle).
Si no enumera nada: probar DP↔DM cruzados; si sigue sin nada, la vía 0 no existe en el 697 y se vuelve al §2.

## 2. Poner el E87 en modo descarga (UBOOT) — el paso que necesita hardware
El chip ya tiene firmware, así que **no** entra solo. La Boot ROM del BR30/BR35 solo entra en modo descarga
si recibe el **USB_KEY `0x16EF`** por D-/D+ al arrancar (D- reloj, D+ datos, MSB primero, bit ~19.3 µs; el
chip responde tirando D+/D- a masa ≥1-2 ms). **Esto NO se fuerza con un simple puente** (no vale "DM a masa"
en estos ROM BR23+); hace falta algo que genere esa señal:
- **Dongle oficial "JL USB Updater"** (강제/强制升级) — la vía práctica y barata (Taobao/AliExpress, pocos €).
  Lleva un chip JL que manda la key y luego pasa el USB al PC. Se cablea **DP↔DP, DM↔DM, +5V↔VBAT, GND↔GND**
  a los pads de la placa abierta; **VBAT debe poder cortarse** para resetear el chip desde maskrom; se pulsa
  "update". Confirmado para AC697x/AD697N/AC897N (misma familia).
- **Dongle casero con Raspberry Pi Pico** (el `tools/pi-pico-jl-dongle` del repo ElectronicCats): hace el
  bit-bang del 0x16EF. **Está a medias** (handshake en construcción, puente USB sin decidir) → es un proyecto
  en sí, no una solución lista. Timing ya resuelto en su doc si se quisiera terminar.
- **Arranque fallido**: si la flash estuviera vacía/corrupta entraría solo — no aplica a una unidad que
  funciona y no queremos corromperla.

Señal de éxito: enumera un **disco nuevo**; `jldevfind.py` lo lista como `UBOOT`/`UDISK`/`DEVICE`
(para BR35 sale como `4c4a:2942` "BR35UBOOT1.00"; el BR30 dará su propio PID análogo).
→ **Conclusión**: los pads DP/DM/GND de la unidad abierta **sí sirven** para volcar, pero para *entrar* en
UBOOT necesitas el **dongle** (oficial barato, o terminar el de Pi-Pico). No es solo tocar los pads al USB.

---

## 2b. ¿Se puede sin dongle? RESUELTO por fotos (2026-11-16): flash in-package → NO CH341A
> **PCB `qx7413_v1.1_20250822`.** Fotos del PCB inspeccionadas:
> - **NO hay flash SPI discreta** (ningún 8-patas 25Qxx). SoC `JL C14225ZJC / AC7074A5` + G-sensor
>   `AXS5106L`. → la NOR va **dentro del encapsulado** → **CH341A descartado**; el volcado va por UBOOT/USB.
> - **PERO el dorso trae pads USB etiquetados: `DP`, `DM`, `5V`, `GND`, `3V3`** (+ G-SDA/G-SCL, MIC+, INT,
>   K+/-). → el cableado USB/dongle es directo (`5V`→VBUS, `DP`→D+, `DM`→D-, `GND`→GND); no hay que rascar
>   pads a ciegas ni abrir más. Las líneas de datos están accesibles. Falta solo el **modo UBOOT** (§2: key
>   0x16EF por dongle/Pi-Pico sobre estos mismos pads).
> - **Top-mark `AC707…`** (no AC697): conflicto con el SDK-code ac697; el SKU real lo da el volcado. Ver
>   [[e87-chip-ac697n]].

- Si en la placa hay un **chip de flash SPI aparte** (SOIC/WSON de 8 patas, marcado tipo `W25Q32`, `GD25`,
  `25Qxx`): **NO hace falta dongle** → un **programador SPI CH341A (~3 €) con pinza** lee/escribe esos 4 MB
  directamente, saltándose UBOOT y la key. El volcado es el mismo (imagen SFC), y se reescribe igual.
- Si **no** hay chip de flash discreto (solo el SoC): la NOR va **dentro del encapsulado** del AC697N →
  **sí hace falta dongle** (o terminar el Pi-Pico), porque no hay patas de flash que pinzar ni cortar.
- Indicio: el equipo de ElectronicCats **no clipó ninguna flash** y se construyó un dongle de key → su E87
  (707) casi seguro lleva la **flash in-package**. El tuyo (697) probablemente igual, pero **compruébalo**
  abriendo la unidad: busca un segundo chip de 8 patas cerca del SoC.
- Aceptar brickear **no** evita el dongle para el primer volcado limpio: el auto-UBOOT (sin key) solo ocurre
  si el chip no puede leer su flash, y eso no se puede forzar con la flash in-package (ni tenemos aún cliente
  OTA 697 para brickear por BLE); además un equipo bricked daría imagen corrupta, no OEM limpio.

## 3. Detectar el dispositivo (solo lectura, inofensivo)
Consola **como administrador**, en `scratch/jl-uboot-tool/`:
```
py jldevfind.py
```
Lista los Jieli cuyo producto empieza por `UBOOT`, `UDISK` o `DEVICE`. Si no aparece: revisar que entró en
modo descarga (§2) y que la consola es de administrador.

## 4. Volcar la flash (SOLO LECTURA — esto primero y guardar copia)
Al arrancar, la herramienta: identifica el chip (debe decir **BR30 / AC697N series**), sube `br30loader.bin`
si hace falta, e imprime un **Quick info** con el **chip key** y el **online device** (ID JEDEC de la flash +
tipo). Ese ID da el **tamaño de la flash** (byte de densidad: `2^n` bytes).

Forma recomendada — **un solo comando no interactivo** (lee y sale limpio). Leer los **4 MB enteros**: así lo
exige ElectronicCats (`docs/dump-firmware.md` §3: `dump2ufw.py` necesita `[0,0xFC000)` y la imagen completa es la
recuperación) y es lo que espera `tools/jl_flash_decode.py`. **Guardarlo tal cual** (cifrado), sin "arreglarlo":
```
cd scratch/jl-uboot-tool-br35
py jluboottool.py read 0x0 0x400000 e87_flash.bin exit
certutil -hashfile e87_flash.bin SHA256
```
- Usar **`scratch/jl-uboot-tool-br35/`** (fork HeikkiRadu `ef77f9c`, el que fija ElectronicCats): trae **br30 y br35**;
  su código `.py` es idéntico a nuestro clon upstream (`diff` vacío), solo añade `chips.yaml`/`usb-loaders.yaml` y
  `br35loader.bin`. Así vale tanto si la prueba USB dice BR30 como BR35. Sin `--chip` la herramienta lo detecta.
- En Windows no hay `lsusb`: el modo UBOOT se ve con `Get-PnpDevice -PresentOnly | ? InstanceId -match 'VID_4C4A'`
  (en el 707 sale `4C4A:2942` "BR35UBOOT1.00").
- `--chip br30` acota la búsqueda al AC697N.
- `read <addr> <len> <file>`: direcciones/longitud aceptan hex (`int(x,0)`). `0x200000` = 2 MiB.
  **Ajustar `<len>` al tamaño real** que diga el Quick info (empezar por 1-2 MiB).
- `exit` cierra bien la sesión.

Equivalente interactivo (si prefieres ver el Quick info antes de decidir el tamaño):
```
py jluboottool.py --chip br30
   =>JL: dump 0x0            # vuelca 256 B de cabecera a consola (no escribe nada)
   =>JL: read 0x0 0x200000 e87_flash.bin
   =>JL: exit
```
También existe `--device "\\.\E:"` o `--device "\\.\HardDiskVolumeN"` para fijar el disco a mano.

## 5. Verificar el volcado
- Buscar el magic `JLUFW` y cabeceras conocidas dentro de `e87_flash.bin` (grep binario).
- Si sale cifrado (probable — la app descifra el `.ufw`), pasarlo por la lógica `decrypt` de
  `libjl_ota_auth.so` ya caracterizada (cifrado simétrico + CRC). El volcado es la materia prima.

---

## 6. Lo que NO se toca (comandos destructivos de la misma herramienta)
- `write`, `erase`, `erasechip`: **escriben/borran flash**. Nada de esto hasta tener el volcado guardado y
  entendido, y con tu permiso explícito en el momento.
- `burnchipkey`: quema el **chipkey en eFuse** (pide confirmación "yes i do"). **Irreversible.** Ni acercarse.
- `memwrite`/`memjump`/`reset`: escriben RAM / saltan / reinician. Innecesarios para volcar.

## 7. Riesgos / UNKNOWN
- **AC697N "LIKELY"**: el loader viene de serie, pero no lo hemos probado en este chip. Si el `read`
  devuelve basura o falla el loader → plan B (dongle oficial).
- **Posible read-lock** del loader (en loaders antiguos había que meter una "read key"; en el br30loader
  UNKNOWN). Si `read` devuelve todo ceros/constante, sospechar esto.
- **Imagen cifrada**: aun con volcado correcto, el contenido puede ir cifrado.
- **Verificación del loader al aplicar un `.ufw` reempaquetado** sigue UNKNOWN; tener el volcado real es lo
  que permite empezar a responderlo.

## 8. Qué necesito de ti con el E87 por cable
1. El **handshake de entrada a modo descarga** (reset + señal 0x16EF) — tus manos en el hardware.
2. Permiso explícito antes de **cualquier** `write`/`erase`. El `read`/`dump` lo hacemos sin riesgo.
3. (Opcional, ya) puedo preinstalar las dependencias pip para no perder tiempo luego.

---

## Plan B — dongle oficial de Jieli (si la vía B falla)
"JL USB Updater / 强制升级工具 4.0": dongle USB-serie del fabricante (agente/Taobao). En AC697x el pin de
upgrade por serie es **LDOIN**; manda el handshake durante el reset; en el 4.0 hay que subir el **bit 7**
del dip-switch y reenchufar para habilitar USB. Pensado sobre todo para grabar; la lectura depende de la
versión del software.

## Fuentes
- jl-uboot-tool (dumper open-source; transporte SCSI, soporte BR30=AC697N, comandos):
  https://github.com/kagaimiq/jl-uboot-tool  (clon local en `scratch/jl-uboot-tool/`)
- fw-Bootloader de Jieli (mapa SDK→bootloader, AC697N→br30): https://github.com/Jieli-Tech/fw-Bootloader
- Doc oficial Jieli, USB下载程序: https://doc.zh-jieli.com/AC79/zh-cn/master/getting_started/preparation/update.html
- Herramienta de forzado 4.0 (dongle, pin LDOIN, dip bit 7):
  https://ble-voice.hashnode.dev/jieli-jl-forced-upgrade-tool-40-upgrade-and-download-instructions
