# Research notes

Working notes from reversing the E87 (AC707N/BR35). In Spanish. Each claim is tagged **CONFIRMED**,
**LIKELY** or **UNKNOWN**, with evidence (file/offset/capture). Device MAC scrubbed.

| file | topic |
|----|----|
| `findings.md` | Inventario inicial de la app ZRun + resumen de hallazgos. |
| `protocolo-e87.md` | Protocolo BLE del E87: servicios/características, RCSP, Qix, subida de ficheros. |
| `e87-capabilities.md` | Capacidades del dispositivo (pantalla, audio compartido, sensores). |
| `cfw-e87.md` | Primeras notas de CFW y OTA. |
| `ec-badge-research.md` | El repo de ElectronicCats (mismo badge, variante 707) y qué aporta. |
| `comparacion-qix.md` | Nuestro cliente Qix vs el de ElectronicCats + estado del SDK. |
| `comparacion-znp-z01.md` | Comparación con el ZNP Z01 (otro badge JieLi): auth por reflexión, ops de ficheros. |
| `firmware-descarga-servidor.md` | **Descarga del firmware OEM del servidor sin hardware**; identidad del chip; **CFW completo** (compilar→injertar→flashear→recuperar); **display server** (opcodes, web, dashboard, presets); rediseño. |
| `firmware-707-decodificado.md` | Formato de flash descifrado byte a byte (chipkey, JLFS, SFC). |
| `patch-path-697.md` | Vía de CFW por parcheo del firmware OEM + cadena de CRC. |
| `usb-dump-ac697n.md` | Volcado por USB/UBOOT (red de seguridad por cable). |
| `plan-cfw-display-server.md` | Diseño del "display server" (firmware + host). |
| `brainstorm-cfw.md` | Lluvia de ideas de CFW por categoría y esfuerzo. |
| `e87-pruebas.md`, `ebadge-options.md` | Pruebas y opciones varias. |
| `unknowns.md` | Preguntas abiertas. |

Highlights worth reading first: `firmware-descarga-servidor.md` (the whole end-to-end story) and
`firmware-707-decodificado.md` (the container/flash format).
