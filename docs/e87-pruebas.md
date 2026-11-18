# E87: pruebas en el dispositivo (2026-11-15)

Entorno: ZRun 2.8.6 en el Rabbit R1 (root), E87 emparejado. Tráfico BLE leído del logcat de la app (logs `[Bluetooth]` / `[BTCommandManager]`).

## Hallazgo principal: no es un reloj, es una insignia con pantalla redonda
La pantalla de inicio (`HomeBadgeActivity`) no muestra el menú tipo reloj de `ip/h0.java`, sino una interfaz de insignia:
- **Pestaña de contenido** (`kp/p.java::f0`), con 5 modos (`o0.i`): VIDEO, DANMAKU ("Bullet comments"), GIF, SINGLE (imagen única) y MULTI (varias imágenes).
- **Pestaña de ajustes**: sonido del vídeo, calidad de vídeo (Media), frecuencia de fotogramas (Baja), actualizar firmware, desvincular dispositivo y feedback.
- La pestaña central (atajos rápidos) no aparece, como predecía `function_bytes`.

## Protocolo BLE observado (CONFIRMED)
- Servicio propietario `c2e6fdXX-e966-1000-8000-bef9c223df6a`:
  - `fd02`: escritura de comandos
  - `fd01`: notificaciones de datos
  - `fd03`: acuses (`FF`)
- Trama: `9E <crc?/seq 2B> <cmd> <len LE 2B> <payload>`. El segundo y tercer byte varían en cada trama.

| Cmd | Nombre (`CommandCode.java`) | Observado |
|---|---|---|
| C6 | COMMAND_REQ_BADGE_INFO | `C6 0100 01` (sondeo periódico); `C6 0200 2001` |
| C7 | COMMAND_REP_BADGE_INFO | `C7 0D00 01 6801 6801 7001 7001 <mem u32 LE>` → pantalla **360×360**, 368×368 (¿área de vídeo?) y **memoria libre en KB** |
| C7 | (respuesta a `C6 02`) | `C7 0500 2001 0001 00` |
| DC | COMMAND_SET_SEND_FILE_TYPE | `DC 0100 0C` (tipo 0x0C, el vídeo de texto) |
| FF | COMMAND_SEND_RESPONSE | `FF 0200 DC 00`: acepta el DC |

## Prueba 1: Bullet comments ("HOLA EBADGE", tamaño Large, blanco sobre negro, 5 s)
1. 1.ª pulsación de "Synchronous": FFmpeg genera `cache/danmaku_output/danmaku_<ts>.mp4` (73 714 B) y `.avi` (170 482 B ≈ 166,5 KB).
2. `DC 0C` → `FF DC 00` (OK). Se carga `libjl_crc.so`.
3. La 2.ª pulsación muestra un diálogo "Installing 0%" que se cierra solo en menos de 20 s.
4. Memoria libre del E87 en `C7`: 4156 → 3988 → 3820 KB, es decir, **−168 KB por intento ≈ tamaño del .avi**.
5. Los bytes del archivo no aparecen en el log de la app: el canal de transferencia no pasa por su wrapper `[Bluetooth]`. Por el `libjl_crc` cargado, probablemente es la transferencia de archivos de Jieli.

Estado: **CONFIRMED**. El usuario confirmó que el E87 muestra el texto.
Nota: se transfirió dos veces, así que puede haber dos copias ocupando memoria.

## Desconexión por inactividad (CONFIRMED)
- A las 15:15:18, unos 60 s después del último comando, el E87 cerró la conexión: `onClientConnectionState status=19` (GATT_CONN_TERMINATE_PEER_USER, iniciada por el periférico).
- La app reintenta cada ~30 s (`disconnect()` + escaneo). Un intento terminó con `status=147` (tiempo agotado). No reconecta sola mientras la insignia duerme.
- Implicación: la insignia entra en reposo o deja de anunciarse tras ~1 min sin tráfico.
- **Para reconectar hay que poner el E87 en modo pairing** (dato del usuario). Despertarlo no basta. Tras activarlo, la app reconectó sola: GATT conectado a las 15:18:57, MTU 517, respuestas `C7`.
- La etiqueta "Connected/Disconnected" de la pestaña no se refresca sola; cambiar de pestaña la actualiza.

## Prueba 2: imagen única (`ebadge_test_3.png`, azul/cian)
Flujo: tocar el círculo → selector de fotos del sistema → recorte cuadrado (`CropImageActivity`) → vista previa circular → "Synchronous" (más abajo) → diálogo "Processing…".
- Archivos: `cache/cropped*.jpg` (30 024 B), copia para el historial `files/my_images/h_*.jpg` (30 024 B) y **envío `files/my_images/f_*.jpg` (10 349 B)**.
- BLE: el mismo patrón que el texto. `DC 0100 0C` → `FF DC 00`, y `C6/C7` antes y después.
- Memoria libre del E87: 3820 → 3808 KB (−12 KB ≈ el JPG final).
- Nota: el tipo de archivo en `DC` también es `0x0C`. No distingue imagen de vídeo, o el byte significa otra cosa.
- La pestaña también ofrece **"Select Sticker"** (4 stickers predefinidos) y un historial ("+").

Estado: **CONFIRMED**. El usuario lo ve en el E87.

## Prueba 3: varias imágenes (3 PNG: azul, verde y rojo; 2 s por imagen)
Flujo: tocar el círculo → selector múltiple ("Añadir (3)") → **ruleta de duración 1–10 s por imagen** (`kp/n4.java:1446`; 3 s por defecto si falla el parseo) → la app lo convierte en vídeo → "Synchronous" → diálogo "Installing" **con progreso real** (9 % visto).
- Archivos en `/sdcard/Android/data/com.zijun.zrun/files/converted_video/`:
  - `slideshow_<ts>_preview.mp4` (741 688 B): solo vista previa en el R1.
  - **`slideshow_<ts>_push.avi` (46 784 B)**: lo que se envía.
- BLE: el mismo patrón, `DC 0100 0C` → `FF DC 00`.
- Memoria libre del E87: 3808 → 3760 KB (−48 KB ≈ el AVI).
- Conclusión: **todo lo que no es imagen única acaba como AVI** (texto y pase de diapositivas). La imagen única se envía como JPG. En ambos casos el tipo en `DC` es `0x0C`.

Estado: **CONFIRMED**. El usuario ve las tres imágenes alternándose.

## Prueba 4: GIF (`ebadge_test_anim.gif`, 6 frames)
Flujo: tocar el círculo → selector de fotos → se convierte en cuanto se elige (no hay más opciones) → vista previa animada → "Synchronous" → "Installing" con progreso.
- Archivos en `converted_video/`: `gif_<ts>_preview.mp4` (87 994 B) y **`gif_<ts>_push.avi` (150 378 B)**.
- BLE: `DC 0100 0C` → `FF DC 00`.
- Memoria libre del E87: 3760 → 3612 KB (−148 KB ≈ el AVI).
- El GIF también se envía como AVI.
- Nota: el selector mostró un aviso de copia de seguridad de Google Fotos con la cuenta del usuario. Lo cerré con "Cerrar", sin cambiar de cuenta.

Estado: **CONFIRMED**. El usuario ve la barra girando.

## Prueba 5: vídeo (`ebadge_test_video.mp4`, 5 s, "HOLA EBADGE")
Flujo: tocar el círculo → selector de vídeos → **"Video Edit"** (`ui.video.edit.VideoEditActivity`), con máscara circular para encuadrar, recorte temporal en una línea de tiempo, vista previa, Cancel/Confirm → vista previa en la pestaña → "Synchronous" → "Installing" con progreso.
- "Video capture duration" admite **3–15 s** (`kp/a7.java:1493`); por defecto 5 s.
- Archivos de la cadena:
  1. `cache/temp_video/selected_<ts>.mp4` (73 714 B, copia del original)
  2. `files/Videos/Edited/circle_crop_selected_<ts>.mp4` (63 916 B, recorte circular)
  3. `files/converted_video/v_<ts>_preview.mp4` (58 811 B, vista previa)
  4. **`files/converted_video/v_<ts>.avi` (163 790 B)**: lo que se envía
- BLE: `DC 0100 0C` → `FF DC 00`.
- Memoria libre del E87: 3612 → 3452 KB (−160 KB = el AVI).
- La pestaña guarda un **historial** de vídeos enviados (miniaturas con ✕ para borrar).

Estado: **CONFIRMED**. El usuario ve el vídeo en el E87.

## Resumen: los 5 modos funcionan
| Modo | Opciones en la app | Formato enviado | Tamaño de la prueba | Δ memoria E87 | Estado |
|---|---|---|---|---|---|
| Bullet comments | texto, 4 tamaños de fuente (16/24/32/64), 8 colores de fuente, 8 de fondo, duración | AVI (FFmpeg) | 170 482 B | −168 KB | CONFIRMED |
| Imagen única | recorte cuadrado, 4 stickers, historial | JPG | 10 349 B | −12 KB | CONFIRMED |
| Varias imágenes | selección múltiple, 1–10 s por imagen, historial | AVI (pase) | 46 784 B | −48 KB | CONFIRMED |
| GIF | ninguna, historial | AVI | 150 378 B | −148 KB | CONFIRMED |
| Vídeo | recorte circular, recorte temporal, duración 3–15 s, historial | AVI | 163 790 B | −160 KB | CONFIRMED |

Todos usan la misma secuencia BLE: `C6/C7` (información y memoria) → `DC 0C` → `FF DC 00` → transferencia por un canal que la app no registra (probablemente Jieli, por `libjl_crc`).

## Investigación: cómo liberar memoria (CONFIRMED salvo lo indicado)
- **La app nunca borra nada en la insignia.**
  - El ✕ del historial solo borra en el R1 los archivos de vista previa y de envío, y la fila de la base de datos (`kp/t5.java:920-946`, `xn.p().a(id)`).
- Si el archivo no cabe en la memoria libre (`BadgeInfoReturn.getMemory()`, en KB), la app aborta con "Memory is full, please delete files to continue" (`kp/o0.java:1964`). No ofrece forma de borrar.
- **Ruta de transferencia:**
  1. `DC 0C` (tipo `ko.x.BADGE` = 12).
  2. `xn.y.q()` → `com.jieli.jl_rcsp.task.TransferTask` (`WatchManager`) al almacenamiento **"SD Card 1"** (`devHandler=2`, `xn/y.java:245-272`).
- La raíz del almacenamiento es `/ROOT`. La app busca en ella una carpeta **`BAG`** (`kp/o0.java:925`).
- **Jieli sí sabe borrar:** `FileBrowseManager.deleteFile(sdCard, List<FileStruct>, …)` (`xn.y.f()`). En esta app solo lo usan Música (`ui/device/music/a.java`) y Álbum (`po/k.java`), nunca el flujo badge.
- La app tiene un log a archivo: Log Settings → "Enable Local Log". Escribe en `files/logs/log_*.log`; la pantalla se abre con `am start -n com.zijun.zrun/.ui.mine.log.LogSettingActivity`. **Está activado.** Con él se vio que `readFileList` arranca en `/ROOT`, pero la insignia no devolvió el listado.
- Opciones para liberar memoria, de menos a más arriesgada:
  1. Que el firmware recicle o sobrescriba él solo cuando se llena. **UNKNOWN**: no hemos llegado a llenarla.
  2. Un menú o botón en la propia insignia. **UNKNOWN**: hay que preguntarlo al usuario.
  3. Listar `/ROOT/BAG` y borrar con el `deleteFile` de Jieli RCSP desde una herramienta propia, por ejemplo la futura web. Para eso hace falta el protocolo RCSP real, que se puede capturar con el registro HCI de Bluetooth.
  4. Desvincular o restablecer de fábrica. **Sin probar**; puede no borrar nada o dejar la insignia inutilizable.

## Resumen de memoria del E87 durante las pruebas
4156 KB (al conectar) → 3452 KB tras 7 envíos, 704 KB consumidos. Nunca se liberó memoria, así que el contenido anterior parece quedarse almacenado en la insignia; cómo se libera está por averiguar.

## Medios de prueba
Generados con `tools/gen_media.py` (360×360, sin dependencias) y subidos a `/sdcard/Pictures/EBadgeTest/`:
- `ebadge_test_1..3.png` (rojo/blanco, verde/amarillo, azul/cian)
- `ebadge_test_anim.gif` (6 frames, barra naranja girando)
- `/sdcard/Movies/EBadgeTest/ebadge_test_video.mp4` (el mp4 que generó la app en la prueba 1)

## Pendiente
- Confirmación visual en el E87.
- GIF, imagen única, varias imágenes y vídeo.
- Ajustes de vídeo (sonido, calidad, fps). Son reversibles; se pueden probar.
- **No tocar**: "Firmware Upgrade" y "Unbind Device" (irreversible o rompe el emparejamiento).
