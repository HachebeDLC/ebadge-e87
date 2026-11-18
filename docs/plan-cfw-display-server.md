# Plan: firmware "display/control server" para el E87 + app Python

Objetivo del usuario: convertir el E87 en **pantalla remota + panel de control por BLE**: mandar imágenes casi
en tiempo real, mostrar estados/widgets (estilo *busy-bar* de Flipper), y recibir eventos (botón/táctil/batería)
para "control" remoto, manejado desde una app Python.

## 0. Base ya montada (de esta sesión)
- Ciclo **compilar (WSL, SDK 707) → injertar en nuestro OEM (`tools/jl_ufw_repack.py swapapp`) → flashear por BLE
  (web, OTA Qix) → recuperar** funcionando y probado en hardware.
- Protocolo BLE conocido: auth SAFER+ (`tools/e1_e87.py`, `scratch/web/e1.js`), canal RCSP (AE00) y **Qix (FD00:
  FD02 write, FD01/FD03 notify)**, subida de ficheros, texto en pantalla (DF98).

## 1. Hechos del chip/SDK (confirmados 2026-11-18)
- AC707N/BR35, core pi32v2, **LVGL v8** (`SDK/apps/common/ui/lvgl_v8`).
- **Sin PSRAM** (`sdk.ld`: `PSRAM_SIZE = 0`), SRAM limitada → **no hay framebuffer completo**. LVGL pinta en
  **tiras** (`CONFIG_LCD_BUF_STATIC_RAM_LEN = LCD_WIDTH*2*32*2` = RGB565, 32 líneas, doble buffer) y vuelca por SPI.
- Pantalla SPI, **resolución configurable** (el SDK referencia 360 y 368; fijar la de nuestro panel).
- **Decodificador JPEG** en firmware (reproduce MJPEG) → se le pueden mandar frames JPEG a decodificar.
- **Punto de enganche BLE**: el patch de EC rutea las escrituras de FD02 a `qix_ota_server_rx_feed()`
  (`qix_ota_server.c`). Ahí añadimos el dispatcher de comandos propios, junto a los opcodes OTA 0xC0+.

## 2. Realidad de rendimiento (honesto, para no vender humo)
- BLE efectivo: de pocos KB/s a ~30–50 KB/s (nativo/bleak, tuneando MTU + intervalo de conexión).
- Imagen a **pantalla completa** JPEG (~8–15 KB) → **~2–5 fps**: bien para imagen en vivo / pase / "now playing",
  NO vídeo fluido.
- **Región pequeña / estado** (busy-bar, iconos, texto, progreso): datos mínimos → **fluido en tiempo real**.
- ⇒ el diseño prioriza **actualizaciones parciales** y compresión. "Tiempo real" = regiones; pantalla entera = unos fps.

## 3. Protocolo (opcodes Qix propios, namespace p.ej. 0xE0–0xEF, sobre FD02)
- `IMG_FULL <jpeg>`: frame de pantalla completa → decodifica y vuelca (sin pasar por flash).
- `IMG_REGION x y w h <jpeg|RGB565>`: actualiza solo un rectángulo (el caso rápido).
- `TEXT id x y <utf8>` / `LABEL_SET id <text>`: etiquetas persistentes (LVGL).
- `BAR id val` / `ICON id <bitmap>`: progreso / iconos (widgets LVGL que se refrescan solos).
- `CLEAR`, `MODE display|watch`: limpiar / entrar-salir del modo pantalla-remota.
- **Eventos → notify FD01/FD03**: `EV_BUTTON`, `EV_TOUCH x y`, `EV_BATTERY %`.
Formato: trama Qix normal (`9E chk flags cmd len payload`), reusando el framing que ya tenemos.

## 4. Firmware (sobre el badge-menu de EC, que ya compilamos e injertamos)
1. **Modo "display server"**: una pantalla LVGL que es un `lv_img`/`lv_canvas` pequeño + widgets, gobernada por
   los opcodes. Añadir como una entrada más del menú de EC.
2. Enganchar el **dispatcher** en/junto a `qix_ota_server_rx_feed`: rutar 0xE0–0xEF a nuestro handler.
3. `IMG_FULL`: reusar el **decodificador JPEG** del firmware → `lv_img` / volcado por tiras al LCD.
4. **Eventos**: publicar botón/táctil/batería por notify (FD01/FD03).
5. Recompilar (WSL) → `swapapp` en nuestro OEM → flashear por la web. Cada iteración es recuperable.

## 5. Host = la WEB (JS), no Python (decisión del usuario 2026-11-18)
Para iterar rápido, el host es la app web que ya tenemos (`scratch/web/`), que ya habla Qix/OTA y autentica SAFER+.
Se añade un módulo "display client" (opcodes IMG_FULL/REGION/TEXT/BAR + lectura de eventos). El firmware se compila
de vez en cuando; la web se toca y despliega al instante. (Una librería Python queda como opción futura.)
- `connect()`: scan + GATT + **auth SAFER+** (`scratch/web/e1.js`) + bootstrap Qix.
- `show_image(PIL.Image)` → JPEG 368² → `IMG_FULL`.
- `show_region(x,y,img)`, `set_text(id,s)`, `set_bar(id,v)`, `set_icon(id,bitmap)`.
- `on_event(cb)` → botón/táctil/batería.
- **Ejemplos**: busy-bar (estado de CPU/descargas/CI), espejo de una región de la pantalla del Mac, "now playing",
  notificador de avisos, mando a distancia (el botón del badge dispara acciones en el PC).

## 6. Fases (incrementales; cada una flasheable y recuperable)
0. **Sonda de throughput** (sin tocar firmware): mandar N KB por FD02 y cronometrar → fijar fps esperables.
1. **MVP imagen**: `IMG_FULL` en firmware + `show_image` en Python. Ver una imagen enviada, sin flash.
2. **Parciales + widgets**: `IMG_REGION` + una busy-bar/labels LVGL. El caso "Flipper" de verdad.
3. **Eventos de vuelta**: botón/táctil/batería → control bidireccional.
4. **Pulido**: librería Python limpia + ejemplos + el modo pantalla-remota integrado en el menú.

## 7. Riesgos / a confirmar
- **RAM**: sin PSRAM, un `lv_canvas` 368² (271 KB) NO cabe → usar `lv_img` con decodificación por tiras y/o
  buffers pequeños + regiones. Confirmar en el SDK el tamaño máximo de buffer disponible.
- **Resolución** real del panel (360 vs 368): fijarla en la config de placa; si el menú de EC se ve bien, ese valor vale.
- **Throughput**: cerrar expectativas con la fase 0 antes de prometer fps.
- **Aparte — modo ratón HID no engancha con el Mac**: es un tema de descriptores HID/bonding BLE del firmware de EC,
  independiente de este plan. Se puede mirar por separado (revisar el report-map HID y el bonding en su patch).
