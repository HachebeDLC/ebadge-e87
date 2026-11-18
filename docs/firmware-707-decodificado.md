# Firmware del E87 (variante AC707N) descifrado — 2026-11-17

Entrada: `scratch/jieli-ble-badge-research/firmware/dump_E87.bin` (volcado de 4 MB del E87 **707** de ElectronicCats,
NO de nuestra unidad). Herramienta **propia y aislada**: `tools/jl_flash_decode.py` (reimplementa los cifrados y CRC;
no importa código de terceros). Salida en `scratch/fw707/dump_E87/` (`dump_E87_plain.bin`, `files/`, `report.json`).

```
python -E tools/jl_flash_decode.py <volcado.bin> <carpeta_salida> [--brute]
```
(`-E` en vez de `-I` solo para que encuentre numpy en el site de usuario, que hace falta para `--brute`.)

## 1. Descifrado — CONFIRMED (todos los CRC cuadran)
- Cabecera de flash (0x20 B) y entradas JLFS de primer nivel: `jl_enc_cipher` key `0xFFFF`.
- **chipkey `0x9847`**, de `isd_config.ini` (32 B chipkey-bin + CRC16 correcto).
- Área de app desde **`appbase = 0x2000`** (no `0x1000` como dice el README de `jl-flash-decrypt`, que era de
  otra placa): SFC, bloques de 32 B, key = `chipkey ^ ((off − 0x2000) >> 2)`.
- Prueba de que está bien: el **CRC de cabecera y el de datos de cada entrada** cuadran tras descifrar, incluido
  `app.bin` completo. Entropía del área de app: 7.997 → 7.025.
- **Fuerza bruta independiente** (`--brute`, 65 536 claves × 4 KB, sin mirar isd_config): gana `0x9847` con
  entropía 6.776 frente a 7.937 sin descifrar (empata `0x6858`, alias conocido del cifrado). ⇒ **del volcado del
  697 se podrá sacar su chipkey aunque no supiéramos dónde está el isd_config.**

## 2. Mapa de la flash (707)
| offset | tamaño | qué | CRC |
|---|---|---|---|
| `0x0000` | 0x20 | cabecera de flash | — |
| `0x0020…` | 5×32 | JLFS primer nivel | hcrc OK |
| `0x00C0` | 0xDDF | `uboot.boot` | **dcrc NO cuadra** con ningún cifrado probado (en claro, enc 0xFFFF, crc_cipher, rxgp, enc chipkey) → UNKNOWN |
| `0x0E9F` | 0x87 | `isd_config.ini` (chipkey-bin + `SPI 4_3_1_0`, `NORFLASH_DTR_EN`, `NORFLASH_WPS_EN`, `RESET PB07_08_0`, `SD_LATCH_IO`) | OK |
| `0x0F26` | 0x100 | `otp_cfg` | placeholder |
| `0x2000` | 0xF3200 | `app_area_head` → hijos `app.bin`, `VM`, `PRCT`, `BTIF`, `EXIF` | OK |
| `0x2100` | **0xF3120** | **`app.bin` (código)** | OK |
| `0xF5240…0xFAB5C` | | `EXT_RESERVED`, `tone_zh`, `cfg_tool.bin`, `p11_code.bin`, `stream.bin`, `config.dat` | OK |
| `0xFD000` | 0x15000 | `VM` (config persistente) | placeholder |
| `0x112000` / `0x113000` | 0x1000 c/u | `BTIF` / `EXIF` | placeholder |
| `0x1B7000` | 2 392 064 B | **volumen FAT12 de medios** (`MSDOS5.0`, 512 B/sector, 8 sect/cluster, 579 clusters), hasta `0x3FF000` | — |
| `0x3FF000` | 0x1000 | `key_mac` | placeholder |

- En este volcado la **FAT de medios está vacía** (tabla y raíz a cero: recién formateada). En su zona de datos
  quedan **restos** de subidas: 52 JPEG completos, **todos 360×360**, y 2 AVI (`RIFF` en `0x1C5600`, `0x1E3600`).
  Recuperados de muestra en `scratch/fw707/dump_E87/carved_*.jpg` (se decodifican bien).
- En `0x381000` hay una estructura `SD_` con `EXT_RESERVED` y una **plantilla FAT** (boot sector en `0x381228` con
  carpeta `BAG` vacía) cuyo tamaño declarado pasa de los 4 MB → no es un volumen vivo; LIKELY la imagen que el
  firmware escribe al formatear. `BAG` es el mismo nombre que vio el browse RCSP de `qix-ble`.
- `0x210000–0x26FFFF` y `0x390000–0x3FEFFF`: vacío (`FF`). `0x280000–0x37FFFF`: entropía 8.0 dentro del área de
  datos de la FAT → LIKELY restos de MJPEG; no verificado.

## 3. Lo que dice el código (`app.bin`, cadenas) — CONFIRMED como cadenas, significado LIKELY
- **Rutas de medios**: `SC/JPGBDG/` (imágenes del badge), `SC/JPGMY/`, `SC/JPGP/%d`, `SC/JPGN/%d`, `SC/AVI/0`,
  `SC/AVI/1`, `flash/res/`, `mnt/sdfile/EXT_RESERVED/UIRES`, `mnt/sdfile/EXT_RESERVED/INORFS`, `homebadge_page`,
  `badge_trans_task`. → candidatas para el borrado por `1A 05 01 ruta` (`comparacion-znp-z01.md` §2).
- Build: `@20251215-$1d3e4aa5` (fecha 2025-12-15 + hash). Nombre BT clásico: `E87_Audio`.
- `BR35    UDISK           1.00` (descriptor USB de almacenamiento: cuadra con la detección `UDISK` de
  jl-uboot-tool). También aparecen `YL-BR30` y `JL-BR22` en tablas cercanas a `0xF0000` (significado UNKNOWN).

## 4. Qué cambia para nuestro E87 (697)
- **Herramienta lista**: cuando haya volcado, `jl_flash_decode.py` lo descifra y valida con los CRC; si el
  `isd_config.ini` del 697 estuviera en otro sitio o no saliera, `--brute` da el chipkey igual.
- **Pantalla**: los medios del 707 son **360×360**; los que manda ZRun a nuestra unidad son **368×368**
  (`scratch/avi/`, `protocolo-e87.md`). Otra diferencia de hardware entre variantes (LIKELY: distinto panel).
  Refuerza no mezclar firmware/medios de una variante en la otra.
- La FAT de medios empieza en `0x1B7000` en el 707; el código no llega ahí. Si en el E87 existe la lectura cruda
  `1A 01 01` del Z01 y es relativa al volumen FAT, **no** sirve para sacar el firmware (LIKELY).
