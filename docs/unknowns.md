# Preguntas abiertas — ZRun

- ¿Cuál es el `baseUrl` del cliente Retrofit propio? Hay muchos `api.` en librerías ofuscadas; falta localizar la interfaz de API de la app y confirmar el host. Pistas: `bo/i.java`, `bo/l.java`, `ag/*`, `aj/a.java`.
- Protocolo RCSP sobre BLE: UUIDs de servicio/característica y formato de trama de comandos. Leer `com/zijun/zrun/ui/device/connect/` y `com/jieli/jl_rcsp`.
- OTA: cómo se autentica/firma el firmware (`libjl_ota_auth.so`) y qué entrega `www.zgntec.com/hy-cloud/app/{id}/upgrade`.
- E87: significado de los bits 15, 20 y 61 de `function_bytes`. ZRun 2.8.6 no los lee; hace falta otra versión de la app o del SDK QIX que sí lo haga, o pruebas en el propio dispositivo.
- ¿Qué datos de salud/telemetría se suben a `admin.zgntec.com` y con qué frecuencia? (requiere captura con mitmproxy o leer la capa de red).
- E87: ¿acepta la auth por **reflexión** (`00 C` devuelto al badge)? Funciona en el ZNP Z01; en el E87 no se ha probado (`comparacion-znp-z01.md` §1).
- E87: ¿existen las ops de ficheros `1A` del Z01 (`05 01 path` borrar, `0B 00 path` comprobar, `01 01 off size` leer)? ¿Qué rutas usa? ¿`1A 01 01` lee solo el volumen FAT o la flash entera? (`comparacion-znp-z01.md` §2)
- E87: ¿basta un AVI de 12 frames o hace falta 60 como ZRun para que no se cuelgue? (`comparacion-znp-z01.md` §3)
- `uboot.boot` (707): ¿qué cifrado/rango cubre su CRC de datos (0xA597)? No cuadra en claro, enc 0xFFFF, crc_cipher, rxgp ni enc chipkey (`firmware-707-decodificado.md` §2).
- ¿El panel del E87 697 es de 368×368 y el del 707 de 360×360? (medios de ZRun vs JPEG huérfanos del volcado 707) (`firmware-707-decodificado.md` §4).
- ¿Qué son `YL-BR30` / `JL-BR22` en el `app.bin` del 707?
