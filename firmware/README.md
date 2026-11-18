# Firmware — display server

`display-opcodes.patch` adds a small **"display server"** to the badge firmware: a handful of BLE
opcodes on the Qix channel (service `C2E6FD00`, write `FD02`, notify `FD01`) that let a host paint the
LCD directly and read the badge's state. It is a diff on **one file** of the ElectronicCats badge-menu
build (`qix_ota_server.c`), applied on top of their patch — **no binary is shipped here**.

## Opcodes added

| cmd | dir | payload | does |
|----|----|----|----|
| `0xE1` FILL_RECT | host→badge | `x y w h` (u16 LE) + `color` (u32 LE, 0x00RRGGBB) | fill a rectangle (`lcd->clear_screen`) |
| `0xE0` BLIT | host→badge | `x y w h` (u16 LE) + RGB565 pixels (LE) | blit raw pixels (`lcd->draw`) |
| `0xE9` QUERY | host→badge | — | reply `0xEA [battery%, key]` (`get_vbat_percent` + published key global) |
| `0xE7` TAKEOVER | host→badge | `[v]` | `lvgl_ui_task_suspend_resume(v)` — suspend(1)/resume(0) the menu so direct draws persist |

It also bumps the Qix reassembly buffer (`qix_rx_buf` 1100 → 4096) so a BLIT frame can carry several
lines. The panel is **360×360**. All handlers run in the BLE RX context (same safe pattern as the
existing battery/info replies); nothing touches flash.

## Build

1. Set up the ElectronicCats build so a plain `app.bin` compiles — see their
   [`docs/build-badge-firmware.md`](https://github.com/ElectronicCats/jieli-ble-badge-research/blob/main/docs/build-badge-firmware.md)
   (it clones the JieLi BR35 SDK, applies their `badge-menu.patch`, fetches the pi32v2 toolchain). Linux.
2. Apply this patch into the SDK worktree:
   ```sh
   cd <sdk>   # the e_badge_707_sdk_200 checkout the EC build uses
   git apply /path/to/display-opcodes.patch     # or: patch -p1 < display-opcodes.patch
   ```
   The file it touches is created by the EC patch, so apply ours *after* theirs.
3. Build `app.bin` (for the BLE OTA path you only need `app.bin`; no Windows post-build tools).
4. Splice the new `app.bin` into **your** unit's OEM `.ufw` and flash over BLE:
   ```sh
   python -I ../tools/get_firmware.py --model <your-model> --version <lower>   # -> your-oem.ufw
   python -I ../tools/jl_ufw_repack.py swapapp your-oem.ufw custom.ufw --app app.bin
   ```
   Then load `custom.ufw` in the web app → *Firmware → Grabar*. **Keep your OEM `.ufw` as the recovery
   image**; if the display misbehaves, re-flash it (the web app has a no-auth recovery mode).

## Notes / unknowns

- `clear_screen` takes an RGB888 color; `draw` takes the panel's RGB565. Byte order is assumed and easy
  to flip host-side if colors come out swapped.
- TAKEOVER passes the raw value through, so if the polarity is inverted on your build you flip it from
  the web, no reflash.
- A real-time JPEG opcode (hardware decoder) is feasible but not done — see
  [`../docs/plan-cfw-display-server.md`](../docs/plan-cfw-display-server.md).
