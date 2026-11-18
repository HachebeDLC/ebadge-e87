# E87 badge — reverse engineering, web app & custom firmware

Independent, interoperability-focused reverse engineering of the **E87 e-badge** (the cheap
clip-on BLE badge with a round touchscreen, sold under names like "E87 smart badge" and driven by
the **ZRun** app). It runs a **JieLi AC707N (BR35)** Bluetooth SoC.

This repo contains **only our own work**: a standalone Web Bluetooth app that replaces ZRun, a set
of isolated Python tools for the firmware container, a custom-firmware source patch (a "display
server"), and our research notes. **No proprietary material is redistributed** — not the ZRun APK,
not the JieLi SDK, not any OEM or third-party firmware binary. Those are linked and explained
instead (see *What's not here*).

> ⚠️ For interoperability and education, on hardware you own. Not affiliated with or endorsed by the
> badge vendor, JieLi, ZNP, or ElectronicCats. See [DISCLAIMER](#disclaimer).

---

## What we found (short version)

- **The chip is a JieLi AC707N / BR35**, not AC697N as the app's SDK code string suggested. Confirmed
  from the unit's own OEM firmware (`AC707N` in the UFW header, chipkey `0x9847`). Our board is
  `QX7413` (an E87 variant distinct from ElectronicCats' `QX7613`). The cheap E87 is **display only**
  — no microphone, no speaker (the audio stack in the firmware is shared with pricier variants).
- **The OEM firmware can be downloaded from the vendor's OTA server with no authentication**, over the
  network, with no hardware at all: POST the device's model (adaptation number) and a version *lower*
  than the installed one, and the server returns the `.ufw` download URL. See
  [`docs/firmware-descarga-servidor.md`](docs/firmware-descarga-servidor.md) and
  [`tools/get_firmware.py`](tools/get_firmware.py).
- **The whole flash/container format is understood** (Qix wrapper → UFW → JLFS → SFC cipher keyed by
  the chipkey). Reimplemented from scratch in isolated Python (`tools/`), validated byte-for-byte
  against real images.
- **Custom firmware works, flashed over BLE from the browser**, with a safe recovery path. We added a
  **"display server"**: BLE opcodes that paint the LCD directly (fill, blit), read the button and
  battery, and suspend the menu — so a host can use the badge as a live remote screen and controller.
- **Auth** on our unit is Bluetooth **SAFER+/E1** (reimplemented in `web/e1.js` / `tools/e1_e87.py`),
  with a **reflection** fallback for other variants.

The detailed, evidence-tagged write-ups are in [`docs/`](docs) (in Spanish).

---

## Layout

```
web/        Standalone Web Bluetooth app (no build step). Connect, authenticate, send media,
            flash firmware (OTA), and drive the display server (screen, widgets, dashboard, presets).
            Deployed as a static site; see web/README.md.
tools/      Isolated Python reimplementations of the JieLi container/flash crypto + helpers:
              ufw_outer.py       parse/validate a .ufw container (outer table + CRCs)
              jl_flash_decode.py decrypt a flash image / flash.bin (SFC + JLFS), recover chipkey
              jl_ufw_repack.py   patch app.bin or swap it, recompute every CRC, repack a flashable .ufw
              e1_e87.py          SAFER+/E1 authentication
              targetinfo_decode.py / get_firmware.py
            tools/research/      exploratory scripts used while reversing (unpolished)
firmware/   display-opcodes.patch — our source patch adding the display-server BLE opcodes.
            Build instructions in firmware/README.md (needs the SDK + the ElectronicCats build; we
            ship the diff, not binaries).
docs/       Research notes (Spanish), each finding tagged CONFIRMED / LIKELY / UNKNOWN.
```

## Quick start — the web app

No build, no install. Web Bluetooth needs Chrome or Edge on desktop over HTTPS (or `localhost`):

```sh
cd web
python -m http.server 8777
# open http://localhost:8777 in Chrome/Edge
```

Offline self-tests (no device needed):

```sh
cd web
node test_upload.mjs     # subida de ficheros: "reconstruccion identica: OK"
node test_auth.mjs       # auth SAFER+ + reflexión
node test_ota.mjs        # protocolo OTA Qix contra un badge simulado
node test_display.mjs    # fill/blit/busy-bar
node test_state.mjs      # consulta de estado
node test_dashboard.mjs  # diff de regiones del dashboard
```

## What's **not** here (and how to get it)

To keep this repo free of proprietary code, these are referenced, not included:

- **The OEM firmware for your unit** — download it yourself from the vendor OTA server with
  [`tools/get_firmware.py`](tools/get_firmware.py) (it's served unauthenticated).
- **The JieLi AC707N / BR35 SDK** — anonymous clone from JieLi's GitLab
  (`gitlab.zh-jieli.com/e_badge/e_badge_707_sdk_200`); needed to build custom firmware.
- **The ElectronicCats badge research** — [ElectronicCats/jieli-ble-badge-research](https://github.com/ElectronicCats/jieli-ble-badge-research):
  the badge-menu custom firmware, OEM dumps, the `jl-uboot-tool` fork, and the `ufw-repack` tooling.
  Our `firmware/display-opcodes.patch` is applied on top of their build.
- **The ZRun Android APK** and anything decompiled from it.
- **The ZNP Z01** (a *different*, pricier badge that does have a mic + speaker):
  [devniz/znp-re](https://github.com/devniz/znp-re).

## Building the custom firmware (outline)

1. Set up the ElectronicCats build (clones the JieLi SDK, applies their badge-menu patch, fetches the
   toolchain) — see their `docs/build-badge-firmware.md`.
2. Apply our [`firmware/display-opcodes.patch`](firmware/display-opcodes.patch) on top.
3. Build `app.bin` (Linux; for the BLE path no Windows tools are needed).
4. Download **your** unit's OEM `.ufw` (`tools/get_firmware.py`) and splice the new `app.bin` into it:
   `python -I tools/jl_ufw_repack.py swapapp your-oem.ufw out.ufw --app app.bin`
5. Flash `out.ufw` over BLE from the web app. Keep your OEM `.ufw` as the recovery image.

Full detail in [`docs/firmware-descarga-servidor.md`](docs/firmware-descarga-servidor.md),
[`docs/patch-path-697.md`](docs/patch-path-697.md) and [`firmware/README.md`](firmware/README.md).

## Credits

Built on the shoulders of [ElectronicCats/jieli-ble-badge-research](https://github.com/ElectronicCats/jieli-ble-badge-research)
(Andrés Sabas, Heikki Perea), [devniz/znp-re](https://github.com/devniz/znp-re), and
[kagaimiq/jl-uboot-tool](https://github.com/kagaimiq/jl-uboot-tool). The firmware-download approach
was shown by Andrés Sabas in his DragonJAR talk.

## Disclaimer

Independent interoperability research by owners of the device. Not affiliated with or endorsed by the
badge vendor, JieLi, ZNP, Anthropic, or ElectronicCats. No firmware, SDK, app, or key is redistributed
here. Flashing firmware can brick a device; a recovery image of **your own** unit is required. Use at
your own risk, and only on hardware you own and in compliance with your local law.

## License

[MIT](LICENSE) for our own code (the `web/`, `tools/`, and `firmware/` patch). The referenced upstream
projects keep their own licenses.
