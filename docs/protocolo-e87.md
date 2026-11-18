# Protocolo BLE del eBadge E87: especificación para una app web propia

Fuentes: captura HCI completa del R1 (`scratch/btsnoop_sticker.log`, envío de un sticker de 11 600 B el 2026-11-15 15:58), parseada con `tools/btsnoop_att.py` y `tools/rcsp_decode.py`, y código decompilado de ZRun 2.8.6 (SDK QIX `com.qix.library` y SDK Jieli `com.jieli.jl_rcsp`).
**Validación:** el archivo reconstruido desde la captura es idéntico byte a byte al JPG que envió la app (`scratch/reconstruido_f_1794754703.jpg`).

## 1. GATT (CONFIRMED, descubrimiento de servicios en la captura)
| Servicio | Característica | Handle | Propiedad / uso |
|---|---|---|---|
| `1800` GAP | `2a00` | 0x0003 | nombre ("E87") |
| **`ae00` Jieli RCSP** | **`ae01`** | 0x0006 | write without response: app → insignia |
| | **`ae02`** | 0x0008 (CCCD 0x0009) | notify: insignia → app |
| **`c2e6fd00-e966-1000-8000-bef9c223df6a` QIX** | `…fd02…` | 0x000c | escritura de comandos |
| | `…fd01…` | 0x000e (CCCD 0x000f) | notify: respuestas |
| | `…fd03…` | 0x0011 (CCCD 0x0012) | notify: acuses `FF` |
| | `…fd04…` / `…fd05…` | 0x0014 / 0x0016 | sin uso observado |
| `180f` batería | `2a19` | 0x001a | nivel, notify |
- MTU negociado: **517**. ZRun no usa Bluetooth clásico ("不支持经典蓝牙"); todo va por BLE.

## 2. Canal QIX (comandos de la insignia) (CONFIRMED)
Trama: `9E | chk | flags | cmd | len_lo | len_hi | payload…`
- `chk` = suma de 8 bits de `flags..payload` (`BTCommandManager.getCheck`). Ejemplo: `9E 22 5A C6 01 00 01` → `5A+C6+01+00+01 = 0x122` → `0x22`.
- `flags` = `(resp<<7) | (seq<<3) | (multi<<2) | (b1<<1) | b0`; `seq` va de 0 a 15 y es cíclico; `multi` = 1 si `len+6 > 20` (`getFlagStatus`).

| Cmd | Nombre | Payload TX | Respuesta |
|---|---|---|---|
| `C6` | REQ_BADGE_INFO | `01` | `C7`: `01 | w u16 LE | h u16 LE | w2 | h2 | memoria_libre_KB u32 LE` → 360×360, 368×368, p. ej. 3440 KB |
| `C6` | REQ_BADGE_INFO (config) | `20 01` | `C7`: `20 01 00 01 00` (por descifrar) |
| `DC` | SET_SEND_FILE_TYPE | `0C` (= BADGE; enum `ko.x`) | acuse en fd03: `FF 02 00 DC 00` |
| `FF` | SEND_RESPONSE | (de la insignia) | `<cmd acusado> <status>` |
Otros tipos de `DC` (enum `ko.x`): 1 AUDIO, 2 IMAGE_PREVIEW, 3 IMAGE_DIAL, 4 E_BOOK, 5/6 AI_IMAGE, 7 MAP_IMAGE, 8 IMAGE_CAPTURE, 9 MUSIC, 10 LYRICS, 11 VIDEO, **12 BADGE**, 13 NAVIGATION_IMAGE_DIAL.

## 3. Canal Jieli RCSP (archivos) (CONFIRMED salvo la autenticación)
Trama: `FE DC BA | flags | opcode | len u16 BE | payload | EF`
- `flags`: `C0` = orden que espera respuesta, `80` = orden sin respuesta, `00` = respuesta.
- Payload de una orden: `sn | parámetros…`. Payload de una respuesta: `status | sn | datos…` (0 = OK).

### 3.1 Autenticación al conectar — SAFER+ con clave fija (**CONFIRMADO y VALIDADO** — E1 de Bluetooth)
> **CERRADO (2026-11-15).** Implementación limpia en Python puro `tools/e1_e87.py` y port JS `scratch/web/e1.js`, ambos **idénticos byte a byte a los 2 vectores reales del dispositivo** (`024767f9…` y `418aecb4…`). Es **E1 de Bluetooth estándar** (SAFER+ de dos pases con clave de enlace fija). El emulador ARM64 (`tools/arm64emu.py`) queda obsoleto: tenía un bug puntual, pero ya no se necesita.
Analizado `libjl_auth.so` (ARM64, 11 528 B) con `tools/elf_syms.py`:
- Símbolos: `function_E1test`, **`function_E21`** (396 B, la cripto principal), `function_xiaomi`, `register_xm_bluetooth`. Son las primitivas de emparejamiento **Bluetooth SAFER+**.
- Tablas extraídas del binario (CONFIRMADO):
  - **EXP** (45ˣ mod 257) en offset de fichero `0x9e0`, 256 B.
  - **LOG** (inversa de EXP) en `0xae0`, 256 B.
  - **BIAS** del calendario de claves (17×16 = 272 B) en `0x8d0`.
- **Clave de enlace fija** en `.data` (`0x23e0`): `06 77 5f 87 91 8d d4 23 00 5d f1 d8 cf 0c 14 2b`. La app nunca llama a `setDeviceConnectionLinkKey`, así que usa esta clave compilada.
- **Vectores de prueba** (de la captura, para validar cualquier implementación):
  - E(`a0a7cdb366d01ff8e3b4d0157423ce73`) = `024767f9cd4bc12513740315d5fccc8f`
  - E(`ab8b759428aa824de5cd668a276393c8`) = `418aecb43bceb2bc4fe763c61ce20b16`
### Estructura exacta (DESENSAMBLADA con capstone, `tools/disasm.py`)
- `function_E1` @ 0x10cc, `function_E21` @ 0x1438: construcciones Bluetooth estándar. La auth RCSP usa el **cifrado base SAFER+** `encrypt` @ **0x16cc** con **flag=0** (E1 lo llama con `w2=0`, sin realimentación Ar').
- **Calendario de claves** @ 0x15c4 (CONFIRMADO): registro de 17 bytes = clave(16) + paridad(XOR de los 16). `subkey[0]=clave`. Para r=1..16: rotar cada byte del registro 3 bits a la izquierda; `subkey[r][j] = reg[(r+j) mod 17] + BIAS[fila r][15-j]` (la fila se lee **invertida**; fila r = bytes en 0x8d0+r·16). 17 subclaves de 16 B.
- **Ronda** r=0..7 (CONFIRMADO del desensamblado): posiciones exp = {0,3,4,7,8,11,12,15} (máscara 0x9999).
  1. (sólo con flag=1, r==2) realimentación: `X[i]+=orig[i]` en posiciones exp. En la auth NO se usa.
  2. mezcla clave `K[2r]`: exp → `X[i]^=K`; resto → `X[i]+=K`.
  3. no lineal: exp → `EXP[X[i]]`; resto → `LOG[X[i]]`.
  4. mezcla clave `K[2r+1]`: exp → `X[i]+=K`; resto → `X[i]^=K`.
  5. capa lineal PHT (bloque 0x172c–0x18b8).
- **Transformación final** con `K[16]`: exp → `X[i]^=K`; resto → `X[i]+=K`.
### E1 completo (DESENSAMBLADO, 0x10cc) — es E1 de Bluetooth de DOS pases
`getEncryptedAuthData(msg)` (@0x1f44): toma `R = msg[1..16]` (salta el prefijo), y llama a `function_E1(ADDR, R, KEY, OUT)` con constantes de `.data`:
- **ADDR** (6 B) @0xa3f0 = `11 22 33 33 22 11`
- **KEY** (16 B) @0xa3e0 = `06 77 5f 87 91 8d d4 23 00 5d f1 d8 cf 0c 14 2b`
- devuelve `01 || E1(R)` (17 B).

`function_E1(ADDR, DATA, K, OUT)`:
1. `X = DATA`; `sub = keysched(K)`; `X = encrypt(X, sub, flag=0)`.
2. Realimentación con la dirección: `X[i] = ADDRexp[i] + (X[i] ^ DATA[i])`, donde `ADDRexp = ADDR repetido` (`A0..A5,A0..A5,A0..A3`).
3. Deriva K̃ del K **original**, por byte (constantes del binario 0x1324–0x13e4):
   `K̃ = [K0-0x17, K1^0xe5, K2-0x21, K3^0xc1, K4-0x4d, K5^0xa7, K6-0x6b, K7^0x83, K8^0xe9, K9-0x1b, K10^0xdf, K11-0x3f, K12^0xb3, K13-0x59, K14^0x95, K15-0x7d]` (todo mod 256).
4. `sub2 = keysched(K̃)`; `X = encrypt(X, sub2, flag=1)` (Ar': realimenta `X[i]+=orig[i]` en posiciones exp en la ronda índice 2).
5. `OUT = X`.

`encrypt(X, sub, flag)` @0x16cc: 8 rondas (mezcla1 ⊕/+, no lineal EXP/LOG, mezcla2 +/⊕, PHT) + transformación final con sub[16]. `keysched` @0x15c4: ya documentado arriba.

### Implementación final VALIDADA (`tools/e1_e87.py`, `scratch/web/e1.js`)
Detalles concretos que cierran SAFER+ (lo que faltaba era la **capa lineal exacta**):
- **Tablas:** `EXP[i] = 45^i mod 257` (256→0); `LOG` su inversa.
- **Calendario de claves** (SAFER+ estándar): registro de 17 = clave(16)+paridad(XOR). `K1=clave`. Para i=2..17: rotar los 17 bytes 3 bits a la izquierda; `Ki[j] = reg[(i-1+j) mod 17] + bias(i,j)` con `bias(i,j) = EXP[EXP[(17·i+j+1) mod 257]]`. (Equivale a la tabla BIAS del binario leída invertida.)
- **Ronda** (8): mezcla1 (⊕ en {0,3,4,7,8,11,12,15}, + en el resto), no lineal (EXP/LOG), mezcla2 (+ /⊕), y **capa lineal**.
- **Capa lineal (clave):** 4 iteraciones de `PHT` + **permutación Armenian Shuffle** `P=[8,11,12,15,2,1,6,5,10,9,14,13,0,7,4,3]` (gather: `nuevo[i]=b[P[i]]`), **SIN** permutar tras el 4º PHT. PHT por pares: `(2x+y, x+y) mod 256`.
- **Transformación final** con K17 (⊕/+).
- **Ar' (2º pase, flag=1):** antes de la ronda índice 2, `X[i] += orig[i]` (⊕ en posiciones exp) con `orig` = entrada de la ronda 1.
- **E1:** `A=encrypt(R,ks(KEY),Ar)`; `tmp[i]=ADDRexp[i]+(A[i]^R[i])`; `OUT=encrypt(tmp,ks(K̃),Ar')`; `ADDRexp=ADDR repetido mod 6`.
- Vectores (PASAN los 2): `getEncryptedAuthData(00‖a0a7…ce73)=01‖024767f9…`; `(00‖ab8b…93c8)=01‖418aecb4…`.

Herramientas de RE (histórico): `tools/disasm.py` (capstone) sigue siendo útil; `tools/arm64emu.py`/`run_jni.py`/`run_auth.py` (emulador) quedan obsoletos tras la implementación limpia.

Flujo del protocolo (Java `RcspAuth.java`, CONFIRMADO):
Va **sin trama** RCSP, en crudo por `ae01`/`ae02`:
```
TX 00 + 16 B aleatorios          (reto de la app)
RX 01 + 16 B                     (respuesta de la insignia)
TX 02 "pass"                     (la app la acepta)
RX 00 + 16 B                     (reto de la insignia)
TX 01 + 16 B                     (respuesta de la app)
RX 02 "pass"
```
`libjl_auth.so` exporta `getRandomAuthData`, `getEncryptedAuthData`, `setLinkKey` y `function_E1test`: es **E1 (SAFER+) con link key fija**. **RESUELTO:** clave extraída (`06775f87…142b`) y E1 reimplementado y validado (`tools/e1_e87.py` / `scratch/web/e1.js`). La web **ya puede autenticarse sola** por `ae01`/`ae02` con el flujo de abajo.

### 3.2 Arranque observado tras autenticar
| Op | Nombre (SDK) | Payload TX | Notas |
|---|---|---|---|
| 0x03 | GetTargetInfo | `sn FF FF FF FF 00` | la respuesta (125 B) incluye la MAC `46 8C 00 00 F6 F2` y versiones |
| 0x06 | ? | `00 01` | |
| 0xD9 | ? | `sn` | respuesta de 16 B |
| 0x08 | ? (¿hora?) | `sn 02 08 00 07 EA 0B 0F 0F 36 0F` | `07EA`=2026, `0B`=11, `0F`=15, `0F:36:0F`=15:54:15, así que **es la fecha y hora** |
| 0x07 | GetSysInfo | `sn FF 00 00 00 04` | |

### 3.3 Listar archivos (CONFIRMED a nivel de raíz)
```
TX C0 0C  sn 00 0A 00 01 00 00 00 02 00 04 00 00 00 00    (navegar: devHandler=2, raíz)
RX 00 0C  00 sn
RX 80 01  d0 0C 0A 00 00 00 02 00 01 03 'B' 'A' 'G'          (entrada: carpeta "BAG")
RX C0 0D  sn 01                                            (fin del listado)
TX 00 0D  00 sn 01
```
Almacenamiento: "SD Card 1", `devHandler=2`, raíz `/ROOT`; la raíz solo contiene `BAG`. Falta capturar cómo se entra en `BAG`: el SDK hace `appenBrowse` usando el `cluster` de la carpeta.

### 3.4 Subir un archivo (CONFIRMED, reconstrucción exacta)
```
TX C0 21  sn 00                       → RX 00 21 00 sn               (preparar)
TX C0 27  sn 00 00 00 00 02 01        → RX 00 27 00 sn 00 01         (DeviceExtendParam: devHandler=2, app con CRC16 por paquete)
TX C0 1B  sn | tamaño u32 BE | crc16 u16 BE | "4bc7de43.tmp" 00
                                      → RX 00 1B 00 sn | mtu u16 BE (0x01EA = 490 B de datos por paquete)
— la insignia pide bloques, en el orden que quiera —
RX 80 1D  sn 00 | len u16 BE | offset u32 BE
TX 80 01  sn 1D idx crc16 u16 BE | datos (≤490 B)    × N, idx = 0..7; un bloque son como mucho 8 paquetes (3920 B)
   … se repite: offsets 490, 4410, 8330 y por último 0 (la cabecera va al final) …
RX C0 20  sn                                          (pide el nombre final)
TX 00 20  00 sn | "\U" | nombre UTF-16LE | 00 00      (p. ej. "f_1794754703.jpg"; los nombres 8.3 cortos van en GBK sin "\U")
RX C0 1C  sn 00                                       (fin: OK)
TX 00 1C  00 sn
```
- `crc16` del archivo y de cada paquete: **CRC-16/XMODEM** (poly 0x1021, init 0, sin reflejar). La tabla está en `libjl_crc.so`, offset 0x5E0. Ejemplo: archivo de 11 600 B → `0x6778`.
- Antes, en el canal QIX, va `DC 0C` (BADGE). La app comprueba con `C6` que `tamaño_KB ≤ memoria_libre`.
- Duración: unos 5 s para 11,6 KB.

### 3.5 Borrar archivos (PENDIENTE)
El SDK tiene `FileBrowseManager.deleteFile(sdCard, List<FileStruct>, …)` y ZRun nunca lo usa para la insignia. Para implementarlo hay que sacar el opcode del SDK (`com.jieli.jl_filebrowse` / `jl_rcsp`) o capturar un borrado desde Música o Álbum.

## 4. Formato de los medios (CONFIRMED)
- **Imagen única:** JPEG baseline (SOF0, JFIF), **368×368**, unos 10–12 KB.
- **Texto, GIF, vídeo y varias imágenes:** **AVI RIFF con MJPEG**, **368×368**, 24 bits, sin audio, con índice `idx1`.
  - 12 fps en texto, GIF y vídeo (fps "Low" en ajustes).
  - Pase de imágenes: `rate=1/N` (N segundos por imagen), 1 frame por imagen.
  - Cada frame es un JPEG completo (`FFD8FFE0`); el `ISFT` indica "Lavf60.3.100".
- Todo esto se puede generar en el navegador: canvas → `toBlob('image/jpeg')` → empaquetar en RIFF.

## 5. Qué falta para la web
1. ~~Autenticación Jieli~~ **HECHO**: E1 validado en `tools/e1_e87.py` y `scratch/web/e1.js` (2/2 vectores). Ya no bloquea.
2. Opcodes de navegar o entrar en carpeta y de borrar, para gestionar la memoria.
3. Probar si la insignia acepta archivos subidos sin el `DC 0C` previo y qué nombres admite.
4. Web Bluetooth necesita Chrome o Edge, en HTTPS o localhost; los UUID de 16 bits `ae00` y `180f` deben declararse en `optionalServices`.
