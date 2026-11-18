"""Decodifica tramas Jieli RCSP (FE DC BA ... EF) de un JSON de btsnoop_att.py y reconstruye
archivos enviados con la transferencia de 'archivo grande' (0x1B / 0x1D / 0x01 / 0x20).

Uso: python -I rcsp_decode.py att.json [--out carpeta] [--ref archivo_original]
"""
import json, sys, struct, os

AE01, AE02 = 0x06, 0x08

def frames(hexval):
    b = bytes.fromhex(hexval)
    i = 0
    while True:
        j = b.find(b'\xfe\xdc\xba', i)
        if j < 0 or j + 7 > len(b):
            return
        flag, op = b[j + 3], b[j + 4]
        ln = struct.unpack_from('>H', b, j + 5)[0]
        payload = b[j + 7:j + 7 + ln]
        end = b[j + 7 + ln:j + 8 + ln]
        yield flag, op, payload, end == b'\xef'
        i = j + 8 + ln

def crc16_variants(data):
    def ccitt(d, init):
        c = init
        for x in d:
            c ^= x << 8
            for _ in range(8):
                c = ((c << 1) ^ 0x1021) & 0xffff if c & 0x8000 else (c << 1) & 0xffff
        return c
    def arc(d):
        c = 0
        for x in d:
            c ^= x
            for _ in range(8):
                c = (c >> 1) ^ 0xA001 if c & 1 else c >> 1
        return c
    def modbus(d):
        c = 0xffff
        for x in d:
            c ^= x
            for _ in range(8):
                c = (c >> 1) ^ 0xA001 if c & 1 else c >> 1
        return c
    return {'xmodem': ccitt(data, 0), 'ccitt-false': ccitt(data, 0xffff), 'arc': arc(data), 'modbus': modbus(data)}

def main():
    args = sys.argv[1:]
    recs = json.load(open(args[0]))
    out = args[args.index('--out') + 1] if '--out' in args else '.'
    ref = args[args.index('--ref') + 1] if '--ref' in args else None
    size = name = None
    chunks = {}           # offset -> bytes
    pending = None        # (offset, length) pedido por 0x1D
    packets = []
    for r in recs:
        if r.get('handle') not in (AE01, AE02) or 'value' not in r:
            continue
        for flag, op, p, ok in frames(r['value']):
            kind = {0xC0: 'CMD+R', 0x80: 'CMD', 0x00: 'RSP'}.get(flag, f'{flag:02x}')
            if op == 0x1B and flag & 0x80:
                size = struct.unpack_from('>I', p, 1)[0]
                name = p[5:].split(b'\x00')[0].decode('latin1')
                print(f"{r['t']} {r['dir']} 0x1B INICIO archivo: tamaño={size} nombre_tmp={name!r}")
            elif op == 0x1D and flag & 0x80:
                ln, off = struct.unpack_from('>HI', p, 2)
                if size is not None:
                    ln = min(ln, size - off)     # el último bloque puede ser más corto de lo pedido
                pending = (off, ln, [])
                print(f"{r['t']} {r['dir']} 0x1D PIDE bloque offset={off} len={ln}")
            elif op == 0x01 and flag & 0x80 and pending and len(p) > 5:
                # payload = sn | 0x1D | índice | CRC16 (2 B) | datos
                sn, ref_op, idx = p[0], p[1], p[2]
                data = p[5:]
                crc_be, crc_le = struct.unpack_from('>H', p, 3)[0], struct.unpack_from('<H', p, 3)[0]
                v = crc16_variants(data)
                hit = [k for k, x in v.items() if x == crc_be] or [k + '(LE)' for k, x in v.items() if x == crc_le]
                packets.append(hit)
                pending[2].append(data)
                if sum(len(d) for d in pending[2]) >= pending[1]:
                    blob = b''.join(pending[2])[:pending[1]]
                    chunks[pending[0]] = blob
                    print(f"           bloque @ {pending[0]}: {len(pending[2])} paquetes, {len(blob)} B, CRC16 del paquete = {hit or '?'}")
                    pending = None
            elif op == 0x20:
                if flag & 0x80:
                    print(f"{r['t']} {r['dir']} 0x20 FIN pedido por la insignia: {p.hex()}")
                else:
                    crc = struct.unpack_from('>H', p, 2)[0]
                    fn = p[4:].decode('utf-16-le', 'replace').rstrip('\x00')
                    print(f"{r['t']} {r['dir']} 0x20 RESPUESTA: crc_archivo=0x{crc:04x} nombre_final={fn!r}")
                    final_crc, final_name = crc, fn
            else:
                print(f"{r['t']} {r['dir']} {kind} op=0x{op:02x} len={len(p)} {p[:40].hex()}{'…' if len(p) > 40 else ''}{'' if ok else ' (sin EF)'}")
    if size and chunks:
        buf = bytearray(size)
        for off, d in chunks.items():
            buf[off:off + len(d)] = d
        covered = sum(len(d) for d in chunks.values())
        path = os.path.join(out, 'reconstruido_' + (final_name if 'final_name' in dir() else 'archivo.bin'))
        open(path, 'wb').write(buf)
        print(f'\nReconstruido {path}: {covered}/{size} B cubiertos')
        print('CRC16 del archivo completo:', {k: hex(x) for k, x in crc16_variants(bytes(buf)).items()})
        if ref:
            r = open(ref, 'rb').read()
            print('Igual al original:', r == bytes(buf), f'(original {len(r)} B)')

if __name__ == '__main__':
    main()
