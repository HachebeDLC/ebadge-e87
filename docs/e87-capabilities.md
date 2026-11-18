# eBadge E87 — capacidades reales (leídas del dispositivo)

Fuente: MMKV `ZRunApp` de ZRun instalada en el Rabbit R1 (root vía `adb root`), tras emparejar el E87.
Volcado: `scratch/ZRunApp.mmkv`, `scratch/ZRunApp2.mmkv` (idénticos en `function_bytes`). Parser: `tools/mmkv_parse.py`.

## Identidad (CONFIRMED)
| Clave | Valor |
|---|---|
| device_name | E87 |
| device_mac / device_adv_mac | AA:BB:CC:DD:EE:FF |
| device_firmware_version | 11.1.0.2 |
| device_ui_version | 1.0.0 |
| pact_version (protocolo) | 2.7 → la app lo trata como 27 (< 28, ruta antigua de `requestData(191)`) |
| device_serial_num | 0x0C90 = 3216 (LE) |
| device_type | 0x01B3 = 435 (LE) |
| ai_function_config | **ausente** |

## function_bytes
`00 80 10 40 01 00 00 20` → 8 bytes / 64 bits. Bits a 1: **15, 20, 30, 32, 61**.
Lectura: `bit i = (b[i/8] >> (i%8)) & 1` (`ho/y0.java::h`).

### Origen de los bytes (CONFIRMED)
El SDK QIX arma `function_bytes` al emparejar (`com/qix/library/command/ReceiveCommandParse.java:296-400`) como enteros little-endian pegados:
- bytes 0–3 = `functionConfig` → E87: `0x40108000` (bits 15, 20, 30)
- bytes 4–7 = `functionConfig1` → E87: `0x20000001` (bits 0 y 29, es decir, globales 32 y 61)
- bytes 8–15 = `functionConfig2`, solo con protocolo ≥ 29. El E87 usa 2.7, así que el array tiene 8 bytes.
- El SDK solo consulta internamente `functionConfig1 & 64` (bit global 38: alarmas de 7 bytes), que en el E87 está a 0. Los getters `getFunctionConfig*()` no se usan fuera del bean.

### Bits activos
| Bit | Efecto en la app | Evidencia | Estado |
|---|---|---|---|
| 15 | Ninguno en ZRun 2.8.6 | ver "Búsqueda" abajo | CONFIRMED: no se usa en esta versión. El significado sigue siendo UNKNOWN |
| 20 | Ninguno en ZRun 2.8.6 | ídem | ídem |
| 30 | **Oculta "Levantar muñeca para encender"** (`raise_wrist_rl`). Es un flag invertido: 1 = no lo soporta | MoreSettingActivity.java:551; binding `jo/g2.java` campo d0; layout `activity_more_setting.xml` | CONFIRMED |
| 32 | Hasta 7 esferas personalizadas (3 si el bit es 0) | xn/j.java:5564 | CONFIRMED |
| 61 | Ninguno en ZRun 2.8.6 | ídem | ídem |

### Búsqueda de los bits 15, 20 y 61 (sin resultados)
- Los 38 lectores de `function_bytes` (grep de la clave) con `y0.h(arr, N)`, incluidas llamadas anidadas, para N ∈ {15, 20, 61}.
- El helper entero `y0.g(int, bit)` con los bits 15, 20, 29 y 30.
- Máscaras literales (`1 << n`, 0x8000, 0x100000, 0x20000000, 0x40000000) en la app y en el SDK QIX.
- Conclusión: el firmware los anuncia, pero esta versión de la app no los consume. Para saber qué significan haría falta otra versión de ZRun u otra app del mismo SDK que sí los lea, o pruebas en el propio dispositivo.

### Pantalla "Más ajustes" en el E87 (CONFIRMED, MoreSettingActivity.java:548-554)
| Fila (id) | Condición | E87 |
|---|---|---|
| raise_wrist_rl (levantar muñeca) | visible si bit 30 = 0 | oculta |
| time_mode_rl (12/24 h) | visible si bit 10 = 1 | oculta |
| length_unit_mode_rl (unidades) | visible si bit 9 = 1 | oculta |
| screen_time_rl (tiempo de pantalla) | visible si bit 17 = 1 | oculta |
| not_disturb_* (no molestar), device_upgrade_rl (actualizar firmware) | sin condición de bits | visibles |

### Mapa de bits conocidos (todos a 0 en el E87)
| Bit | Función |
|---|---|
| 0 | flag en `C` (j.java:5643) |
| 3 / 52 / 55 | push de notificaciones (55 = modo ampliado) |
| 9 | sistema métrico |
| 10 | formato 12/24 h |
| 11 / 47 | foto remota |
| 13 | datos de deporte |
| 16 | datos de esferas y temas |
| 17 | modo reposo / pasos por deporte |
| 19 | temperatura |
| 28 | presión arterial |
| 31 | función sin identificar (j.java:1753, 6839, 6971) |
| 33 | flag (j.java:5646) |
| 35 | álbum |
| 41 | navegación |
| 42 | esfera IA |
| 43–45, 64, 65 | flags de datos en tiempo real (solo protocolo ≥ 28) |
| 54 | `P3()` (salud, sin identificar) |
| 58 | tarjeta electrónica / NFC |
| 60 | SpO₂ |
| 62 | esfera de vídeo |
| 66 | altímetro (imposible con 64 bits) |
| 71 | configuración de IA / SparkChain (requiere ≥ 16 bytes) |
| 75, 76 | sin identificar (j.java:8217, 7607) |

## Opciones resultantes en el menú del E87
- **Visibles:** permisos, alarma, foto remota, push de notificaciones, buscar dispositivo, monitor de salud, recordatorio inteligente, más ajustes. Esta lista base sale siempre, sin depender de los bits.
- **Sincronizar contactos:** visible, porque el número de serie (3216) es distinto de 1367.
- **Recordatorio de WeChat:** depende de la build y la región (`ho.i.a() && qn.r.x()`); sin comprobar.
- **Ocultas por capacidades:** tarjeta electrónica, navegación, álbum, altímetro, esferas IA y de vídeo.
- **IA:** ninguna. No hay `ai_function_config` y el bit 71 no puede estar activo con solo 8 bytes.
- **Atajos rápidos de la pantalla badge:** vacíos, porque los bits 3/52/55, 11/47 y 58 están a 0. Por eso la pestaña central no aparece.

## Advertencia
Que el menú base sea visible no garantiza que el firmware responda a esas funciones: la app las muestra siempre. Hay que probarlas en el dispositivo.
