"""Decodificador propio (aislado) de un volcado de flash JieLi (BR30/BR35).

No importa codigo de terceros: reimplementa jl_enc_cipher, jl_sfc_cipher, jl_crc16 y la
decodificacion del chipkey-bin a partir de la especificacion entendida en
notes/patch-path-697.md y notes/firmware-707-decodificado.md. Solo LEE el volcado que se le pasa.

Pasos:
  1. Cabecera de flash (0x20 B) y entradas JLFS de primer nivel: cifradas con key 0xFFFF.
  2. isd_config.ini (datos en claro): 32 B chipkey-bin + CRC16 -> chipkey.
  3. Area de app (app_dir_head): cifrado SFC (bloques de 32 B, key = chipkey ^ ((off-base)>>2)).
  4. Valida TODOS los CRC (cabecera + datos) de cada entrada: si cuadran, el descifrado es correcto.
  5. Opcional --brute: recupera el chipkey por entropia, sin isd_config (comprobacion independiente).

Uso:  python -I tools/jl_flash_decode.py <dump.bin> <carpeta_salida> [--brute]
"""
import json, math, struct, sys
from pathlib import Path

ENT = struct.Struct("<HHIIBBH16s")   # hcrc, dcrc, off, size, flags, resvd, index, name


def enc_cipher(buf, off, size, key):
    for i in range(off, off + size):
        buf[i] ^= key & 0xFF
        key = ((key << 1) ^ (0x1021 if key & 0x8000 else 0)) & 0xFFFF


def sfc_cipher(buf, off, size, base, key):
    i = 0
    while i < size:
        n = min(32, size - i)
        enc_cipher(buf, off + i, n, (key ^ ((off + i - base) >> 2)) & 0xFFFF)
        i += n


def crc16(data, crc=0):
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def chipkeybin_decode(d):
    s = sum(d[:16]) & 0xFF
    s = 0xAA if s >= 0xE0 else 0x55 if s <= 0x10 else s
    return sum(1 << i for i in range(16) if (d[16 + i] ^ d[15 - i]) < s)


def entropy(b):
    if not b:
        return 0.0
    h = [0] * 256
    for x in b:
        h[x] += 1
    n = len(b)
    return -sum(c / n * math.log2(c / n) for c in h if c)


def parse_ent(buf, off):
    hcrc, dcrc, eoff, esize, flags, resvd, idx, name = ENT.unpack_from(buf, off)
    return dict(hdr_off=off, hcrc=hcrc, dcrc=dcrc, off=eoff, size=esize, flags=flags,
                index=idx, name=name.split(b"\0")[0].decode("ascii", "replace"),
                hcrc_ok=crc16(buf[off + 2:off + 32]) == hcrc)


def decode(raw):
    buf = bytearray(raw)
    rep = {"size": len(raw)}
    enc_cipher(buf, 0, 0x20, 0xFFFF)                         # cabecera de flash
    rep["flash_header_hex"] = bytes(buf[:0x20]).hex()

    # --- entradas de primer nivel ---
    top, cur, chipkey, appbase = [], 0x20, None, None
    while cur + 32 <= len(buf):
        enc_cipher(buf, cur, 32, 0xFFFF)
        e = parse_ent(buf, cur)
        data = bytes(buf[e["off"]:e["off"] + e["size"]]) if e["off"] + e["size"] <= len(buf) else b""
        e["dcrc_ok"] = None if e["dcrc"] == 0xFFFF else (crc16(data) == e["dcrc"])
        top.append(e)
        if e["name"] == "isd_config.ini":
            ck = bytes(buf[e["off"]:e["off"] + 32])
            ckcrc = struct.unpack_from("<H", buf, e["off"] + 32)[0]
            rep["chipkey_bin_crc_ok"] = crc16(ck) == ckcrc
            chipkey = chipkeybin_decode(ck)
        if e["flags"] == 0x81 and e["name"] == "app_dir_head" and appbase is None:
            appbase = e["off"]
        if e["index"] != 0 or not e["hcrc_ok"]:
            break
        cur += 32
    rep["top"] = top
    rep["chipkey"] = chipkey
    rep["appbase"] = appbase
    if chipkey is None or appbase is None:
        return buf, rep

    # --- area de app (SFC) ---
    al = lambda x: (x + 31) & ~31
    app, cur, dec, first, over = [], appbase, appbase, True, False
    while not over and cur + 32 <= len(buf):
        tgt = al(cur + 32)
        if dec < tgt:
            sfc_cipher(buf, dec, tgt - dec, appbase, chipkey); dec = tgt
        e = parse_ent(buf, cur)
        e["data_off"], e["data_size"] = cur + 32, e["size"] - 32
        over = e["index"] != 0 or not e["hcrc_ok"]
        nxt = cur + e["size"]
        npos = nxt if over else al(nxt + 32)
        if dec < min(npos, len(buf)):
            sfc_cipher(buf, dec, min(npos, len(buf)) - dec, appbase, chipkey); dec = min(npos, len(buf))
        e["dcrc_ok"] = None if e["dcrc"] == 0xFFFF else \
            crc16(bytes(buf[e["data_off"]:e["data_off"] + e["data_size"]])) == e["dcrc"]
        app.append(e)
        if first:                                              # hijos de app_area_head (ya en claro)
            first, ic = False, cur + 32
            while ic + 32 <= len(buf):
                c = parse_ent(buf, ic)
                c["data_off"], c["data_size"], c["child"] = cur + c["off"], c["size"], True
                d = bytes(buf[c["data_off"]:c["data_off"] + c["data_size"]])
                c["dcrc_ok"] = None if c["dcrc"] == 0xFFFF else crc16(d) == c["dcrc"]
                app.append(c)
                if c["index"] != 0 or not c["hcrc_ok"]:
                    break
                ic += 32
        cur = nxt
    rep["app"] = app
    rep["sfc_end"] = dec
    return buf, rep


def brute_chipkey(raw, base, start, nblocks=128):
    """Prueba los 65536 chipkeys sobre nblocks bloques de 32 B y puntua por entropia."""
    import numpy as np
    ks = np.zeros((65536, 32), dtype=np.uint8)               # flujo de 32 B por semilla
    k = np.arange(65536, dtype=np.uint32)
    for i in range(32):
        ks[:, i] = k & 0xFF
        k = ((k << 1) ^ np.where(k & 0x8000, 0x1021, 0)) & 0xFFFF
    blk = np.frombuffer(raw[start:start + nblocks * 32], dtype=np.uint8).reshape(nblocks, 32)
    seeds = np.array([((start + j * 32 - base) >> 2) & 0xFFFF for j in range(nblocks)], dtype=np.uint32)
    cand = np.arange(65536, dtype=np.uint32)
    scores = np.zeros(65536)
    for c0 in range(0, 65536, 4096):
        c = cand[c0:c0 + 4096]
        plain = blk[None, :, :] ^ ks[(c[:, None] ^ seeds[None, :]) & 0xFFFF]   # (4096, nblocks, 32)
        flat = plain.reshape(len(c), -1)
        hist = np.zeros((len(c), 256))
        for v in range(256):
            hist[:, v] = (flat == v).sum(1)
        p = hist / flat.shape[1]
        with np.errstate(divide="ignore", invalid="ignore"):
            scores[c0:c0 + 4096] = -(np.where(p > 0, p * np.log2(p), 0)).sum(1)
    order = np.argsort(scores)
    base_ent = entropy(raw[start:start + nblocks * 32])
    return [(int(i), float(scores[i])) for i in order[:4]], base_ent


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    raw = src.read_bytes()
    out.mkdir(parents=True, exist_ok=True)
    buf, rep = decode(raw)

    print(f"volcado {src.name}: {len(raw)} B")
    print(f"cabecera flash (descifrada): {rep['flash_header_hex']}")
    print("\n-- JLFS primer nivel (key 0xFFFF) --")
    for e in rep["top"]:
        print(f"  @{e['hdr_off']:#07x} {e['name']:<16} off={e['off']:#09x} size={e['size']:#09x} "
              f"flags={e['flags']:#04x} hcrc={'OK' if e['hcrc_ok'] else 'MAL'} "
              f"dcrc={'-' if e['dcrc_ok'] is None else 'OK' if e['dcrc_ok'] else 'MAL'}")
    print(f"\nchipkey (isd_config.ini) = {rep['chipkey'] and hex(rep['chipkey'])}  "
          f"crc del chipkey-bin {'OK' if rep.get('chipkey_bin_crc_ok') else 'MAL'};  appbase = "
          f"{rep['appbase'] and hex(rep['appbase'])}")
    if "app" in rep:
        print("\n-- area de app (SFC con chipkey) --")
        for e in rep["app"]:
            tag = "  hijo " if e.get("child") else "  "
            print(f"{tag}@{e['hdr_off']:#07x} {e['name']:<16} datos={e['data_off']:#09x} "
                  f"size={e['data_size']:#09x} flags={e['flags']:#04x} hcrc={'OK' if e['hcrc_ok'] else 'MAL'} "
                  f"dcrc={'-' if e['dcrc_ok'] is None else 'OK' if e['dcrc_ok'] else 'MAL'}")
        print(f"\nfin del area descifrada: {rep['sfc_end']:#x}")
        ab, end = rep["appbase"], rep["sfc_end"]
        print(f"entropia area app: cifrada {entropy(raw[ab:end]):.3f} -> descifrada {entropy(buf[ab:end]):.3f}")

    if "--brute" in sys.argv and rep.get("appbase"):
        ab = rep["appbase"]
        top4, be = brute_chipkey(raw, ab, ab + 0x2000)
        rep["brute"] = {"top": top4, "baseline_entropy": be}
        print(f"\nfuerza bruta (entropia, 4 KB desde {ab + 0x2000:#x}; sin descifrar = {be:.3f}):")
        for k, s in top4:
            print(f"  {k:#06x}  {s:.3f}")

    (out / (src.stem + "_plain.bin")).write_bytes(bytes(buf))
    files = out / "files"; files.mkdir(exist_ok=True)
    for e in rep["top"] + rep.get("app", []):
        o = e.get("data_off", e["off"]); n = e.get("data_size", e["size"])
        if e["name"] and 0 < n <= len(buf) - o:
            safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in e["name"])
            (files / f"{o:07x}_{safe}").write_bytes(bytes(buf[o:o + n]))
    (out / "report.json").write_text(json.dumps(rep, indent=1, default=str), encoding="utf-8")
    print(f"\nsalida: {out}")


if __name__ == "__main__":
    main()
