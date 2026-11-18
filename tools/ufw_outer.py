"""Parser propio (aislado) de la tabla EXTERIOR de un .ufw JieLi.

No importa nada del repo de terceros: reimplementa jl_enc_cipher (XOR stream,
poly 0x1021) y jl_crc16 a partir de la especificacion ya entendida
(notes/comparacion-qix.md). Solo LEE los ficheros que se le pasan como args.

Uso:  python -I tools/ufw_outer.py <fichero.ufw> [mas.ufw ...]
"""
import struct, sys
from pathlib import Path

QIX_MAGIC = b"\xbc\xaf"
QIX_HEADER_LEN = 27
KEY = 0xFFFF


def jl_enc_cipher(buf, key=KEY):
    out = bytearray(buf)
    for i in range(len(out)):
        out[i] ^= key & 0xFF
        key = ((key << 1) ^ (0x1021 if key & 0x8000 else 0)) & 0xFFFF
    return bytes(out)


def jl_crc16(data, crc=0):
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def parse(path):
    raw = Path(path).read_bytes()
    has_qix = raw[:2] == QIX_MAGIC
    inner = raw[QIX_HEADER_LEN:] if has_qix else raw
    hdr = jl_enc_cipher(inner[:0x40])
    hdrcrc, listcrc, imgsize, numents, wa3, wa4 = struct.unpack_from("<HHIHHI", hdr, 0)
    chip = hdr[0x10:0x40].split(b"\0")[0].decode("ascii", "replace")
    print(f"FILE {path}")
    print(f"  total={len(raw)}  qix={has_qix}  inner={len(inner)}")
    print(f"  hdrcrc={hdrcrc:#06x} listcrc={listcrc:#06x} imgsize={imgsize} "
          f"numents={numents} chip={chip!r}")
    # recomputa hdrcrc para validar que entendemos el formato
    print(f"  hdrcrc recomputado={jl_crc16(hdr[2:64]):#06x} (debe coincidir)")
    enc_ents = inner[0x40:0x40 + numents * 0x50]
    print(f"  listcrc recomputado={jl_crc16(enc_ents):#06x} (debe coincidir)")
    for i in range(numents):
        pe = jl_enc_cipher(inner[0x40 + i * 0x50:0x40 + (i + 1) * 0x50])
        etype, eindex, edcrc, _, eoff, esize, _, _, ename = \
            struct.unpack_from("<HHHHIII44s16s", pe, 0)
        name = ename.split(b"\0")[0].decode("ascii", "replace")
        print(f"    [{i}] type={etype:3d} idx={eindex} dcrc={edcrc:#06x} "
              f"off={eoff:9d}(={eoff:#09x}) sz={esize:9d}(={esize:#09x}) name={name!r}")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        parse(p)
        print()
