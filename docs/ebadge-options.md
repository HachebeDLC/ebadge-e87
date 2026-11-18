# Opciones del eBadge (menú de funciones del dispositivo)

Cómo se construye el menú de funciones que la app muestra para el dispositivo conectado.
Fuentes (CONFIRMED):
- Enum de tipos de opción: `ko/z.java` (30 valores).
- Rejilla principal del dispositivo: `ip/h0.java` → `T(boolean)` (lista base) + bloque condicional (líneas ~2402–2592).
- Pantalla "badge" rápida (home, 3 pestañas): `com/zijun/zrun/ui/main/badge/a.java` (`BadgeFunctionViewModel`).
- Lectura de capacidades: `ho/y0.java::h(byte[] function_bytes, int bit)` lee el bit `bit` del array de capacidades.
- Almacén: `ho/b0.java` (MMKV). Claves: `function_bytes` (capacidades del dispositivo, byte[]), `ai_function_config` (JSON `AIFunctionReturn` del servidor), `device_serial_num`.

## De dónde salen las opciones
1. **Capacidades del propio dispositivo** → bitmask `function_bytes` que el reloj reporta por BLE (SDK `com.qix.library.sdk` / Jieli RCSP). Cada bit activa una opción.
2. **Config de IA del servidor** → objeto `AIFunctionReturn` (`com.qix.library.bean`) guardado en `ai_function_config`; sus flags `isSupportX()` activan las opciones de IA.
3. **Base fija** → siempre presentes salvo filtros de build/serie.

## Lista base — siempre presente (`T()`, h0.java:3699)
- APP_PERMISSION, ALARM_CLOCK, SMART_TAKE_PHOTO, NOTIFICATION_PUSH, FIND_DEVICE, HEALTH_MONITORING, SMART_REMINDER, MORE_SETTING.
- WECHAT_REMIND: solo si `ho.i.a()` (build con WeChat) **y** `qn.r.x()`.

## Opciones condicionadas por `function_bytes` (CONFIRMED)
| Opción (enum `z`) | Condición | Evidencia |
|---|---|---|
| ELECTRONIC_CARD (tarjeta/NFC) | bit **58** ≠ 0 | h0.java:2402 |
| NAVIGATION | bit **41** ≠ 0 | h0.java:2418 |
| ALTITUDE (altímetro) | bit **66** ≠ 0 | h0.java:2430 |
| ALBUM | bit **35** ≠ 0 | h0.java:2442 |
| AI dial (esfera IA) | bit **42** == 1 | h0.java:2116 |
| VIDEO dial (esfera vídeo) | bit **62** == 1 | h0.java:2130 |
| MASSIVE / FIXED / CUSTOM dial | siempre / según catálogo | h0.java:2133+ |

Otros bits usados en la pantalla rápida `badge/a.java` (`BadgeFunctionViewModel`):
- NOTIFICATION_PUSH rápido: bit **3** o **52** o **55** == 1 (`a.java:455 d()`).
- SMART_TAKE_PHOTO rápido: bit **11** o **47** == 1 (`a.java:421`).
- ELECTRONIC_CARD rápido: bit **58** ≠ 0 (`a.java:426`).

## Opciones de IA — condicionadas por `AIFunctionReturn` (CONFIRMED, h0.java:2455+)
| Opción | Flag del servidor |
|---|---|
| INTERPRETATION | isSupportInterpretation() |
| AI_RECORD | isSupportAIRecord() |
| AI_CHAT | isSupportAIChat() |
| CHATGPT | isSupportChatgpt() |
| DEEPSEEK | isSupportDeepSeek() |
| DOUBAO | isSupportDoubao() |
| SCHEDULE | isSupportSchedule() |
| QWEN | isSupportQwen() |
| NEW_AI_RECORD | isSupportNewAIRecord() |

## Otras reglas (CONFIRMED)
- SYC_CONTACT (sincronizar contactos): se añade salvo si `device_serial_num == 1367` (h0.java:2572). O sea, una serie concreta de dispositivo lo oculta.

## Enum completo `ko.z` (30 tipos posibles)
ALARM_CLOCK, SMART_TAKE_PHOTO, NOTIFICATION_PUSH, FIND_DEVICE, SYC_CONTACT, ELECTRONIC_CARD, MUSIC, ALBUM, SOUND_RECORDING, NAVIGATION, STOCK, E_BOOK, SCHEDULE_REMINDER, HEALTH_MONITORING, SMART_REMINDER, MORE_SETTING, FEEDBACK, ABOUT, ALTITUDE, AI_CHAT, INTERPRETATION, AI_RECORD, CHATGPT, DEEPSEEK, DOUBAO, SCHEDULE, QWEN, NEW_AI_RECORD, WECHAT_REMIND, APP_PERMISSION.

## UNKNOWN / siguiente
- Valor real de `function_bytes` para TU dispositivo (son las capacidades que decide qué opciones aparecen). Se puede volcar con el dispositivo conectado: leer la clave MMKV `function_bytes`, o capturar la trama BLE de capacidades del SDK QIX.
- Mapeo exacto bit→función para TODOS los bits (solo tenemos los usados arriba; faltan los no referenciados). El resto de bits los define el firmware/QIX SDK.
- MUSIC, STOCK, E_BOOK, SOUND_RECORDING, SCHEDULE_REMINDER existen en el enum pero su gating no aparece en `T()`/bloque condicional revisado: probablemente se añaden en otra ruta (verificar `ip/t.java`, `jp/w.java`).
