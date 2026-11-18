"""Re-empaquetador propio (aislado) de un .ufw JieLi: parchea app.bin y rehace TODA la cadena de CRC.

No ejecuta código de terceros. Reutiliza mi propio descifrador `jl_flash_decode` (enc/sfc/crc,
chipkey, parse JLFS) y añade el camino de RE-EMPAQUETADO, reimplementado a partir de la cadena de CRC
ya entendida (notes/patch-path-697.md §1 + notes/firmware-descarga-servidor.md):

Orden de recomputo (de dentro afuera):
 1. CRC de datos (data_crc) + hcrc de la entrada JLFS hoja parcheada y de CADA padre cuyo rango la cubra
    (saltando las de data_crc == 0xFFFF: placeholders PRCT/VM/key_mac/otp_cfg…).
 2. Re-cifrar flash.bin: cabecera 0x20 y cada entrada top con key 0xFFFF; área de app [appbase, sfc_end)
    con jl_sfc_cipher(chipkey). (No-op => debe reproducir el flash.bin original byte a byte.)
 3. data_crc del flash.bin en el UFW = crc16 sobre el flash.bin RE-CIFRADO.
 4. listcrc (sobre las entradas UFW cifradas) y hdrcrc (sobre hdr[2:64]).
 5. CRC del wrapper Qix (CRC-CCITT-false) en el byte 25, sobre el UFW interior.

Uso:
  python -I tools/jl_ufw_repack.py roundtrip <in.ufw>                      # no-op: debe salir identico
  python -I tools/jl_ufw_repack.py patch <in.ufw> <out.ufw> \
         --find <ascii_viejo> --repl <ascii_nuevo> [--file app.bin]        # parche de igual longitud
  python -I tools/jl_ufw_repack.py patch <in.ufw> <out.ufw> \
         --at <jlfs_file> <off_hex> <hexbytes>                              # parche crudo
"""
import argparse, struct, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jl_flash_decode as J   # propio

QIX_MAGIC = b"\xbc\xaf"
QIX_HEADER_LEN = 27
KEY = 0xFFFF


def crc16_ccitt_false(data, crc=0xFFFF):
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def parse_ufw(raw):
    """Devuelve (inner_off, header_plain(0x40), entries[list dict], flash_idx)."""
    assert raw[:2] == QIX_MAGIC, "falta el magic Qix bc af (se espera .ufw con wrapper)"
    inner_off = QIX_HEADER_LEN
    inner = raw[inner_off:]
    hdr = bytearray(inner[:0x40]); J.enc_cipher(hdr, 0, 0x40, KEY)
    hdrcrc, listcrc, imgsize, numents, _, _ = struct.unpack_from("<HHIHHI", hdr, 0)
    entries, flash_idx = [], -1
    for i in range(numents):
        off = 0x40 + i * 0x50
        pe = bytearray(inner[off:off + 0x50]); J.enc_cipher(pe, 0, 0x50, KEY)
        etype, eindex, edcrc, _, eoff, esize, _, _, ename = struct.unpack_from("<HHHHIII44s16s", pe, 0)
        name = ename.split(b"\0")[0].decode("ascii", "replace")
        entries.append(dict(i=i, plain=bytes(pe), etype=etype, edcrc=edcrc, eoff=eoff, esize=esize, name=name))
        if etype == 0:
            flash_idx = i
    assert flash_idx >= 0, "sin entrada flash.bin (etype=0)"
    return inner_off, bytes(hdr), entries, flash_idx


def reencrypt_flash(plain, rep):
    """Re-cifra el flash.bin descifrado (simetrico): cab 0x20 + tops @0xFFFF, app area SFC(chipkey)."""
    buf = bytearray(plain)
    J.enc_cipher(buf, 0, 0x20, KEY)
    for e in rep["top"]:
        J.enc_cipher(buf, e["hdr_off"], 32, KEY)
    ab = rep["appbase"]
    J.sfc_cipher(buf, ab, rep["sfc_end"] - ab, ab, rep["chipkey"])
    return bytes(buf)


def recompute_jlfs(flash, rep, patches):
    """flash = bytearray PLANO ya parcheado. Rehace data_crc+hcrc de hojas y padres que cubran el parche."""
    allents = rep["top"] + rep["app"]
    todo = {}
    for (name, off, nb) in patches:
        leaf = next((e for e in rep["app"] if e["name"] == name), None) or \
               next((e for e in rep["top"] if e["name"] == name), None)
        if leaf is None:
            raise SystemExit(f"entrada JLFS {name!r} no encontrada")
        lo = leaf.get("data_off", leaf.get("off")) + off
        hi = lo + len(nb)
        for e in allents:
            if e["dcrc"] == 0xFFFF:
                continue  # placeholder: no tocar
            do = e.get("data_off", e.get("off")); ds = e.get("data_size", e.get("size"))
            if lo < do + ds and hi > do:
                todo[e["hdr_off"]] = e
    for e in sorted(todo.values(), key=lambda x: -x.get("data_off", x.get("off"))):
        do = e.get("data_off", e.get("off")); ds = e.get("data_size", e.get("size"))
        new_dcrc = J.crc16(bytes(flash[do:do + ds]))
        struct.pack_into("<H", flash, e["hdr_off"] + 2, new_dcrc)
        new_hcrc = J.crc16(bytes(flash[e["hdr_off"] + 2:e["hdr_off"] + 32]))
        struct.pack_into("<H", flash, e["hdr_off"], new_hcrc)
        print(f"  JLFS {e['name']:<14} data_crc {e['dcrc']:#06x} -> {new_dcrc:#06x}"
              f"{'' if any(p[0]==e['name'] for p in patches) else '  (padre)'}")


def repack(raw, patches):
    inner_off, header_plain, entries, flash_idx = parse_ufw(raw)
    fe = entries[flash_idx]
    inner = raw[inner_off:]
    flash_scr = inner[fe["eoff"]:fe["eoff"] + fe["esize"]]
    plain, rep = J.decode(flash_scr)            # mi descifrador (valida CRCs al parsear)
    flash = bytearray(plain)

    # aplicar parches (sobre el plano)
    for (name, off, nb) in patches:
        leaf = next((e for e in rep["app"] if e["name"] == name), None) or \
               next((e for e in rep["top"] if e["name"] == name), None)
        if leaf is None:
            raise SystemExit(f"entrada {name!r} no encontrada")
        base = leaf.get("data_off", leaf.get("off")); size = leaf.get("data_size", leaf.get("size"))
        if off + len(nb) > size:
            raise SystemExit(f"el parche se sale de {name!r} (size {size})")
        flash[base + off:base + off + len(nb)] = nb

    if patches:
        recompute_jlfs(flash, rep, patches)

    flash_reenc = reencrypt_flash(flash, rep)

    if not patches:
        if flash_reenc != flash_scr:
            for i, (a, b) in enumerate(zip(flash_reenc, flash_scr)):
                if a != b:
                    raise SystemExit(f"round-trip flash.bin DIFIERE @ {i:#x}: {a:#04x} vs {b:#04x}")
            raise SystemExit("round-trip: longitudes distintas")

    # dcrc del flash.bin en el UFW (sobre el re-cifrado)
    new_flash_dcrc = J.crc16(flash_reenc)
    # reconstruir entradas UFW (parchear dcrc de flash.bin en +4)
    ents_plain = bytearray()
    for e in entries:
        ph = bytearray(e["plain"])
        if e["i"] == flash_idx:
            struct.pack_into("<H", ph, 4, new_flash_dcrc)
        ents_plain += ph
    enc_ents = bytearray()
    for i in range(len(entries)):
        blk = bytearray(ents_plain[i * 0x50:(i + 1) * 0x50]); J.enc_cipher(blk, 0, 0x50, KEY); enc_ents += blk
    new_listcrc = J.crc16(bytes(enc_ents))
    new_header = bytearray(header_plain)
    struct.pack_into("<H", new_header, 2, new_listcrc)
    new_hdrcrc = J.crc16(bytes(new_header[2:64]))
    struct.pack_into("<H", new_header, 0, new_hdrcrc)
    old_lc, old_hc, old_dc = struct.unpack_from("<H", header_plain, 2)[0], \
        struct.unpack_from("<H", header_plain, 0)[0], fe["edcrc"]
    print(f"  UFW flash.bin dcrc {old_dc:#06x} -> {new_flash_dcrc:#06x}")
    print(f"  UFW listcrc {old_lc:#06x} -> {new_listcrc:#06x} ; hdrcrc {old_hc:#06x} -> {new_hdrcrc:#06x}")
    enc_header = bytearray(new_header); J.enc_cipher(enc_header, 0, 0x40, KEY)

    headersize = 0x40 + len(entries) * 0x50
    final_inner = bytearray(inner)
    final_inner[:0x40] = enc_header
    final_inner[0x40:headersize] = enc_ents
    final_inner[fe["eoff"]:fe["eoff"] + fe["esize"]] = flash_reenc

    out = bytearray(raw[:QIX_HEADER_LEN]) + final_inner
    qix_crc = crc16_ccitt_false(bytes(final_inner))
    struct.pack_into("<H", out, 25, qix_crc)
    print(f"  Qix wrapper CRC -> {qix_crc:#06x}")
    return bytes(out)


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    r = sp.add_parser("roundtrip"); r.add_argument("inp")
    p = sp.add_parser("patch"); p.add_argument("inp"); p.add_argument("out")
    p.add_argument("--file", default="app.bin")
    p.add_argument("--find"); p.add_argument("--repl")
    p.add_argument("--at", nargs=3, metavar=("JLFS", "OFFHEX", "HEX"))
    sw = sp.add_parser("swapapp"); sw.add_argument("inp"); sw.add_argument("out")
    sw.add_argument("--app", required=True); sw.add_argument("--name", default="app.bin")
    a = ap.parse_args()
    raw = Path(a.inp).read_bytes()

    if a.cmd == "swapapp":
        newapp = Path(a.app).read_bytes()
        _, rep = J.decode(_flashbin_of(raw))
        e = next((x for x in rep["app"] if x["name"] == a.name), None)
        if not e:
            raise SystemExit(f"{a.name!r} no está en el área de app")
        slot = e["data_size"]
        if len(newapp) > slot:
            raise SystemExit(f"el app.bin nuevo ({len(newapp)} B) no cabe en el slot ({slot} B)")
        padded = newapp + b"\xff" * (slot - len(newapp))
        print(f"  swap {a.name}: {len(newapp)} B + relleno 0xFF -> {slot} B (holgura {slot-len(newapp)} B)")
        out = repack(raw, [(a.name, 0, padded)])
        Path(a.out).write_bytes(out)
        print(f"escrito {a.out} ({len(out)} B)")
        return

    if a.cmd == "roundtrip":
        out = repack(raw, [])
        print("round-trip identico:", "OK" if out == raw else "FALLO")
        sys.exit(0 if out == raw else 1)

    patches = []
    if a.find is not None:
        old = a.find.encode(); new = a.repl.encode()
        if len(old) != len(new):
            raise SystemExit("--find y --repl deben tener la MISMA longitud")
        # localizar en el app.bin plano
        _, rep = J.decode(_flashbin_of(raw))
        plain, _ = J.decode(_flashbin_of(raw))
        e = next((x for x in rep["app"] if x["name"] == a.file), None)
        if not e:
            raise SystemExit(f"{a.file!r} no esta en el area de app")
        region = bytes(plain[e["data_off"]:e["data_off"] + e["data_size"]])
        idx = region.find(old)
        if idx < 0:
            raise SystemExit(f"cadena {a.find!r} no encontrada en {a.file}")
        print(f"  encontrado {a.find!r} en {a.file} @ +{idx:#x}")
        patches.append((a.file, idx, new))
    if a.at:
        patches.append((a.at[0], int(a.at[1], 16), bytes.fromhex(a.at[2])))
    if not patches:
        raise SystemExit("nada que parchear")
    out = repack(raw, patches)
    Path(a.out).write_bytes(out)
    print(f"escrito {a.out} ({len(out)} B)")


def _flashbin_of(raw):
    inner_off, _, entries, fi = parse_ufw(raw)
    fe = entries[fi]; inner = raw[inner_off:]
    return inner[fe["eoff"]:fe["eoff"] + fe["esize"]]


if __name__ == "__main__":
    main()
