# Comparación con `devniz/znp-re` (badge ZNP Z01, también JieLi/RCSP)

Fuente: https://github.com/devniz/znp-re (MIT, creado 2026-11-17). Leído por `gh api` (solo lectura, no se
ejecutó nada). Documentos: `docs/PROTOCOL.md`, `docs/FILE-FORMATS.md`. Es **otro dispositivo** (Z01: pantalla
redonda 360×360, micro Opus, altavoz BT clásico; servicio de texto `DF97/DF98`), pero el mismo **RCSP de JieLi**
en `AE00/AE01/AE02` que el E87. Todo lo de aquí sobre el E87 es LIKELY hasta probarlo en el badge.

## 1. Auth por "reflexión" — implementado como respaldo (2026-11-17)
- Z01 (PROTOCOL.md §4): el handshake es el mismo de 6 pasos que el nuestro (`00‖reto`, `01‖E`, `02 "pass"`).
  No conocen E: cuando el badge nos reta con `00 C`, le mandan `00 C` como reto suyo, el badge responde
  `01 E(C)` y eso se le devuelve como respuesta. CONFIRMED en Z01 según su doc; **UNKNOWN en el E87**.
- Por qué importa: la auth es justo donde difieren las variantes del E87 (SAFER+ en nuestro 697, cifrado propio
  de `libjl_auth.so` en el 707 de ElectronicCats, `comparacion-qix.md` §1), y la serigrafía `AC7074A5` del
  SoC dejó abierta qué variante tenemos (`usb-dump-ac697n.md` §2b). La reflexión no depende del cifrado.
- Hecho en `scratch/web/rcsp.js` `authenticate()`: el paso 1 ya comprueba si el badge responde con SAFER+.
  Si **cuadra** → camino validado de siempre (sin cambios). Si **no cuadra** → se refleja el reto.
  Prueba offline `scratch/web/test_auth.mjs`: SAFER+ (sin reflejar), otro cifrado (reflexión OK) y reflexión
  rechazada (error limpio): `auth SAFER+ / reflexion / rechazo: OK`. Desplegado en Netlify.

## 2. Gestión de ficheros: op RCSP `1A` — candidato para el "borrar memoria" que falta
Z01 (PROTOCOL.md §12–13), todo con flag `C0`, respuesta `status sn data`:
| data de `1A` | hace |
|---|---|
| `05 01 path` | **borrar un fichero** |
| `0B 00 path` | comprobar fichero → `00 size(4,BE) crc16(2,BE)` o `FF 00 path EF` si no existe |
| `01 01 offset(4,BE) size(2,BE)` | leer flash cruda, máx. 192 B; offset 0 = sector de arranque FAT16 |
| `03 04 path` | mostrar una imagen guardada |
| `02 01 size(4) path` / `02 00` | abrir / cerrar fichero destino de una subida |
- En el Z01 el volumen es FAT16 sin carpetas, raíz en `0x8000` (`0x1000` B) → leyendo la raíz se **listan**
  todos los ficheros. Con eso + `05 01 path` se puede vaciar la memoria.
- E87: nuestra subida (validada) no usa `1A`; el nombre final va en la respuesta a `0x20` con prefijo `5C 55`
  (en `qix-ble`: carácter U+555C). Rutas reales del E87: UNKNOWN. **No se ha metido en la web**: es una
  escritura destructiva sin probar. Orden de prueba propuesto con el badge: (1) `1A 01 01 0 192` (solo lectura)
  para ver si hay FAT16; (2) leer la raíz y sacar nombres; (3) `1A 0B 00 path` sobre uno; (4) solo entonces
  `1A 05 01 path`.
- ¿Sirve `1A 01 01` para volcar el firmware sin cable? UNKNOWN y LIKELY que no: en el Z01 el offset es
  relativo al volumen FAT (offset 0 = boot sector FAT16), no a la flash entera; el código del E87 está fuera
  de ese volumen (`patch-path-697.md`: CODE en [0,0x17E000), recursos desde 0x17E000). Lo que lo
  distinguiría: leer offsets por encima del tamaño del volumen y ver si devuelve error o datos de código.
  Es solo lectura → barato de probar.

## 3. AVI: corrobora la causa del cuelgue del E87
- FILE-FORMATS.md: en el Z01 "clips muy cortos (un frame) pueden congelar el badge"; sus vídeos llevan 36–60
  frames. Nuestro primer AVI tenía **1 frame** y congeló el E87 (`findings.md`). Refuerza esa causa (LIKELY).
- Nuestra web ahora manda el texto en **12 frames**; ZRun manda **60**. Si en la reprueba pendiente el E87
  vuelve a colgarse con 12, lo siguiente es subir a 60 (como ZRun) antes de sospechar de otra cosa.
- Formatos del Z01 que NO aplican tal cual al E87: imágenes RU50 (ETC2/RLE), paquete `/AVI` de 7 nombres,
  vídeo 357/20 fps con pista PCM. El E87 recibe JPEG y AVI MJPEG 368×368 de ffmpeg (validado byte a byte).

## 4. Otros datos útiles
- Pantalla por RCSP op `FF` con `FF F7 F1 xx`; micro por op `04 02 10 00` / `05 00`; batería en
  GetTargetInfo TLV tipo `01`. El E87 no tiene micro; la pantalla/estados no se han probado en él.
- Cancelar subida: op `1E`. Vigilancia: 10 s sin progreso = fallo. Útil para la web (UNKNOWN en E87).
