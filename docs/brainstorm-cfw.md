# Brainstorming: opciones de CFW para el E87 (2026-11-18)

Qué tenemos ya desbloqueado (lo que hace realista todo esto):
- **Ciclo completo**: compilar (SDK 707 en WSL) → injertar en TU OEM → flashear por BLE (web) → recuperar. Probado.
- **Canal de comandos propio** por BLE (Qix FD00/FD02), con opcodes que definimos nosotros + respuestas (FD01).
- **Pantalla** 360×360 táctil redonda, LVGL v8, **decodificador JPEG por HW**, almacenamiento FAT, reproduce MJPEG.
- **Audio** por Bluetooth clásico (altavoz "E87_Audio"). **Sin micrófono** en el E87.
- **Sensores/entradas**: G-sensor (AXS5106L), batería (ADC), botón lateral, táctil.
- **USB**: UDISK + HID (el "modo ratón" ya existe). Auth SAFER+ nuestra. Recuperación asegurada.

Leyenda de esfuerzo: 🟢 solo host/JS (ya se puede) · 🟡 opcode/firmware pequeño · 🔴 firmware profundo.

---

## A. Pantalla remota / panel (host empuja datos) — la categoría más jugosa
El "display server" (opcodes FILL_RECT/BLIT ya hechos) habilita TODO esto desde el PC/móvil con JS:
- 🟢 **Busy-bar / estado estilo Flipper**: barra de progreso + texto (build/CI, descargas, CPU, batería del portátil).
- 🟢 **Monitor de sistema**: CPU/RAM/red en vivo como gráficos pequeños (regiones que cambian = rápido).
- 🟢 **Ticker**: cripto/bolsa, clima, próximas reuniones, hora de bus/metro.
- 🟢 **Espejo de región**: refleja un trozo de la pantalla del Mac (un widget, un chat) en el badge.
- 🟢 **Notificador**: avisos del móvil/PC (icono + texto) en la muñeca/solapa.
- 🟢 **"Now playing"**: carátula + título de lo que suena.
- 🟡 **Imagen rápida (JPEG)**: opcode que decodifica JPEG por HW y vuelca → ~2–5 fps a pantalla completa
  (en vez de RGB565 crudo lento). Vía futura: API `jljpeg_decode` existe pero es de bajo nivel.
- 🟡 **Modo "pantalla remota" en el menú**: una entrada LVGL dedicada que cede la pantalla al host (sin que el
  menú repinte encima).

## B. Dispositivo de entrada (HID por BLE/USB) — "mando"
- 🟡 **Teclado de macros**: el botón/táctil manda atajos al PC (silenciar, siguiente pista, pegar snippet).
- 🟡 **Mando a distancia multimedia**: play/pausa/volumen por BT (ya hay audio BT).
- 🟡 **Clicker de presentaciones**: adelante/atrás + temporizador en pantalla.
- 🟡 **Ratón giroscópico**: mover el cursor con el G-sensor (arreglando antes el HID con el Mac, ver §F).
- 🔴 **Gamepad/stream deck**: rejilla de botones táctiles → acciones en el PC.

## C. Utilidades autónomas (corren solas en el badge)
- 🟡 **Relojes/esferas** propias, con tus imágenes/animaciones.
- 🟡 **Pomodoro / cuenta atrás / temporizador** con aviso por el altavoz.
- 🟡 **Podómetro / nivel de burbuja / dado / brújula-sin-norte** con el G-sensor.
- 🟡 **Tarjeta/identidad**: nombre animado, **QR** (contacto, wifi, URL) que rota.
- 🟡 **Badge de evento**: agenda de charlas, tu nick, animaciones.

## D. Audio (altavoz)
- 🟡 **Altavoz BT con VU-meter** en pantalla.
- 🟡 **Soundboard**: toca un icono → suena un efecto.
- 🟡 **Alarma/temporizador sonoro**, ruido blanco para dormir.

## E. Juguete / fun
- 🔴 **Juegos táctiles**: snake, pong, breakout, 2048, un "fidget".
- 🟡 **Mascota/Tamagotchi** reactiva al movimiento (G-sensor) y a toques.
- 🟢 **Magic-8-ball / ruleta / tragaperras** (host o firmware).

## F. Investigación / seguridad (uso autorizado, hardware propio)
- 🟡 **Escáner BLE**: lista dispositivos cercanos + RSSI (radar de señal) en la pantalla.
- 🟡 **Beacon/anunciante** configurable (iBeacon/Eddystone) para pruebas propias.
- 🟡 **Arreglar el HID↔Mac** del modo ratón (descriptores/bonding) — es un bug acotado, buen primer "fix".
- ⚠️ Nada de ataques a dispositivos de terceros; solo pruebas sobre lo tuyo.

## G. IoT / control
- 🟢 **Superficie de control domótica**: tiles táctiles → el móvil/PC traduce a MQTT/HomeKit.
- 🟢 **Botón de mute** para videollamadas (toque → el PC silencia).
- 🟢 **Disparador de cámara** remoto.

---

## Recomendaciones (por relación valor/esfuerzo, con lo que ya hay)
1. **Terminar el display server + busy-bar (🟢, en curso)**: entrega ya tu caso "tiempo real/estado/Flipper"
   sin más firmware. Es el multiplicador: media docena de ideas de la sección A salen gratis en JS.
2. **Opcode de eventos (🟡)**: que el botón/táctil/batería lleguen al host por FD01 → convierte el badge en
   "mando" y cierra el lazo de control. Firmware pequeño.
3. **Imagen por JPEG (🟡/🔴)**: el salto a imágenes fluidas de verdad. Más trabajo, pero la API existe.
4. **Arreglar el ratón↔Mac (🟡)**: bug acotado, y deja el HID usable para las ideas de §B.

Siguiente paso natural: elegir 1–2 de estas y las monto. Mi voto: **busy-bar/estado (ya casi) + eventos de botón**,
porque juntas te dan "pantalla remota + control" en un fin de semana y todo verificable.
