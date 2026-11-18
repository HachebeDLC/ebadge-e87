#!/usr/bin/env python3
"""Descarga el firmware OEM del E87 desde el servidor del fabricante (sin autenticación).

La app ZRun pide la actualización a un servidor que NO autentica: devuelve el .ufw si le mandas
el `model` (número de adaptación del dispositivo) y una `version` MÁS BAJA que la instalada.

El número de adaptación y la versión de TU unidad salen de la app (prefs MMKV `device_serial_num`
y `device_firmware_version`), o del badge por RCSP GetTargetInfo. Para la unidad de referencia de
este repo eran model=1552 y versión instalada 1.0.2 (por eso se pide 1.0.0 o 1.0.1).

Uso:
  python -I tools/get_firmware.py --model 1552 --version 1.0.0 [--type OTA|UI] [--out fw.bin]

No envía ningún dato personal (solo model/version/appversion). Es la MISMA petición que hace la app.
"""
import argparse, json, sys, urllib.request

API = "https://www.zgntec.com/hy-cloud/app/prod/upgrade"


def post_json(url, payload, timeout=25):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json", "Accept": "application/json",
        "User-Agent": "okhttp/4.12.0",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", required=True, help="nº de adaptación (device_serial_num), p.ej. 1552")
    ap.add_argument("--version", required=True, help="versión A PEDIR, más baja que la instalada (p.ej. 1.0.0)")
    ap.add_argument("--type", default="OTA", choices=["OTA", "UI"])
    ap.add_argument("--out", help="archivo de salida (por defecto, el nombre del servidor)")
    a = ap.parse_args()

    body = {"model": a.model, "type": a.type, "version": a.version}
    if a.type == "OTA":
        body["appversion"] = "2.8.6"
    print(f"POST {API}  {body}")
    resp = post_json(API, body)
    print("respuesta:", json.dumps(resp, ensure_ascii=False))

    if resp.get("code") == "CD000004":
        sys.exit("El servidor dice 'ya es la última versión': pide una `--version` más baja que la instalada.")
    body_r = resp.get("body")
    if resp.get("code") != "CD000001" or not body_r:
        sys.exit("El servidor no ofreció descarga. Prueba otro `--model`/`--version`.")
    url = body_r.get("download_address") or (body_r.get("_info") or {}).get("address")
    if not url:
        sys.exit("No hay download_address en la respuesta.")
    name = a.out or url.rsplit("/", 1)[-1]
    print(f"descargando {url}\n  -> {name}")
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "okhttp/4.12.0"}),
                                timeout=120) as r:
        open(name, "wb").write(r.read())
    import os
    print(f"OK: {name} ({os.path.getsize(name)} bytes). Verifícalo con  python -I tools/ufw_outer.py {name}")


if __name__ == "__main__":
    main()
