# Vía de CFW por PARCHEO para el AC697N (sin SDK)

Como el SDK del 697 está cerrado (`comparacion-qix.md` §5), el CFW del 697 no es "compilar" sino **parchear
el firmware OEM volcado** y re-empaquetarlo. Aquí queda el flujo preparado con los números reales ya
validados sobre los artefactos del 707.

## 0. Formato UFW — VALIDADO byte a byte (2026-11-16)
Parser propio aislado `tools/ufw_outer.py` (reimplementa `jl_enc_cipher` + `jl_crc16`, no usa código de
terceros). Corrido sobre `custom-fw-ac707n.ufw`: **hdrcrc y listcrc recomputados == los guardados** → el
contenedor está entendido del todo. Estructura (exterior→interior):
- **Qix wrapper** opcional: 27 B que empiezan por `bc af`; su CRC (CRC-CCITT-false) va en el byte 25 (LE16),
  calculado sobre el UFW interior.
- **UFW**: todo cifrado con `jl_enc_cipher` (XOR stream, poly 0x1021, key `0xFFFF`):
  - Cabecera 0x40 B: `<HHIHHI` = hdrcrc, listcrc, imgsize, numents, _, _ + chipname en 0x10..0x40
    (`'AC707N'`). `hdrcrc`=crc16 de hdr[2:64]; `listcrc`=crc16 de las entradas **cifradas**.
  - `numents` entradas de 0x50 B: `<HHHHIII44s16s` = etype, eindex, **edcrc**, _, **eoff**, **esize**, _,
    _, name.
- **`flash.bin`** (entrada type=0) = la **región CODE**, cifrada con `jl_sfc_cipher` (bloques de 32 B, key=
  **chipkey**). Dentro: JLFS (cabecera 0x20 + entradas 32 B). La cabecera de flash y las entradas "top" van
  con key `0xFFFF`; el área de app va con `jl_sfc_cipher(chipkey)`.

### Tabla real del `custom-fw-ac707n.ufw` (plantilla)
| idx | type | name | off | size |
|----|----|----|----|----|
| 0 | 0 | **flash.bin** (CODE) | 0x400 | 0x0FB000 |
| 2 | 55 | uboot.version | 0xfb400 | 64 |
| 3 | 238 | params_flash.bin | 0xfb440 | 2420 |
| 4 | 52 | **isd_config.ini** (lleva el chipkey) | 0xfbdc0 | 1656 |
| 6 | 100 | **ota.bin** (loader/updater) | 0xfc480 | 23688 |
| 8 | 161 | blimit.bin (cifrado LFSR 144 B) | 0x102140 | 144 |
| 9 | 255 | tail.bin | 0x1021e0 | 64 |

- CODE `flash.bin` ≈ **0xFB000–0xFC000** (la base `loaderdl-base.ufw` usa 0xFC000). El loader reescribe CODE
  **[0, 0x17E000)**; particiones de recursos: **SDFILE 0x17E000**, **VIRFAT 0x33E000**; flash total 4 MB.
- **chipkey**: sale de `isd_config.ini` dentro del propio firmware (primeros 32 B = chipkey-bin + CRC16). En
  el 707 es `0x9847`; **en el 697 es desconocido** y se leerá de SU volcado.

## 1. Cadena de CRC a recomputar al parchear (de su `repack_ufw.py`, entendido)
Como **todos los cifrados JieLi son XOR stream**, se parchea en claro y se recifra sin re-encriptar todo.
Al cambiar bytes dentro de un fichero JLFS hay que rehacer, de dentro afuera:
1. `data_crc` + `hcrc` de la entrada JLFS hoja (y de **cada padre** cuyo rango la cubra, p.ej.
   `app_area_head`; si no, el `dual_bank_update_verify` del loader hace rollback). Ojo: entradas con
   `data_crc == 0xFFFF` son placeholders (PRCT/VM/key_mac/otp_cfg…) → **no** tocar su CRC.
2. `flash.bin` dcrc (crc16 sobre el `flash.bin` **recifrado**).
3. UFW `listcrc` (sobre entradas cifradas) y `hdrcrc` (sobre hdr[2:64]).
4. Qix wrapper CRC (CRC-CCITT-false) en el byte 25.
Su `repack_ufw.py` hace todo esto y es **casi agnóstico de chip** (lee chipkey de isd_config.ini y offsets
de la tabla; los ciphers son los mismos en BR30/BR35) → debería valer para el 697 con poco o ningún cambio,
una vez apuntado a un volcado/UFW del 697. (Depende de `jltech.chipkeybin.chipkeybin_decode`, vendored.)

## 2. Flujo recomendado para el 697 (wired, dado que aceptas sacrificar una unidad)
La ruta más robusta evita BLE/loader del 697 y opera sobre la imagen cruda de flash:

**A) Bucle de parcheo wired (recomendado):**
1. **Volcar** un 697 por UBOOT: `jl-uboot-tool read 0x0 0x400000 dump697.bin` (upstream ya trae BR30).
   Guardar copia = recuperación.
2. **Parchear** `dump697.bin`: localizar el chipkey en su `isd_config.ini`, descifrar la región CODE con
   `jl_sfc_cipher(chipkey)`, modificar los bytes de código, rehacer CRCs JLFS, recifrar. (Reusar la lógica
   de `ufw-repack`; aquí operamos sobre la flash cruda, no sobre un `.ufw`.)
3. **Escribir** de vuelta: `jl-uboot-tool write 0x0 dump697_patched.bin` + `reset`.
4. **Recuperación**: si algo falla, `write 0x0 dump697.bin` (original). Un equipo que no arranca **entra solo
   en UBOOT** (sin dongle), así que se puede reflashear siempre.

**B) Entrega por BLE (más difícil, para no abrir otras unidades):** requiere un `.ufw` OEM del 697 (con su
loader `ota.bin` del 697, que sale del volcado) + empaquetado fw-custom por Qix `0xC0`, y **nuestra auth
SAFER+** (no la suya). Más piezas; dejar para después del bucle wired.

## 3. La única puerta hardware que queda
Meter un 697 **pristino** en UBOOT para el primer volcado limpio necesita el **handshake key 0x16EF**
(dongle oficial barato, o terminar el de Pi-Pico) — ver `usb-dump-ac697n.md`. Truco con brick: un equipo ya
**bricked entra en UBOOT solo** (ROM, sin key) y es **escribible**, así que tras el primer volcado limpio se
puede brickear/recuperar sin dongle. El dongle hace falta **una vez**, sobre una unidad que arranca.

## 4. Incógnitas del 697 a resolver con el volcado en mano
- **chipkey** real (de su `isd_config.ini`; puede ser 0x0000 si no está quemado).
- **Tamaños/offsets** exactos (flash.bin, [0,0x17E000), SDFILE/VIRFAT) — reconfirmar en el dump del 697.
- Cadena `chip='AC697N'` en la cabecera UFW.
- Si el `blimit.bin`/particiones difieren del 707.

## Herramientas listas
- `tools/ufw_outer.py` (propio): parsea la tabla exterior de cualquier `.ufw` y valida hdrcrc/listcrc.
- `scratch/jl-uboot-tool/` (upstream, BR30): volcado/escritura wired.
- `scratch/jieli-ble-badge-research/tools/ufw-repack/` (referencia): parser/repacker JLFS + CRC + chipkey
  (vendored `jltech`), `jl-flash-decrypt` (descifra CODE SFC).
