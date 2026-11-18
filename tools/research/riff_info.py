"""Describe un AVI (RIFF): cabeceras avih/strh/strf, idx1 y tamaño de los frames, sin dependencias."""
import struct, sys

def chunks(data, start, end):
    i = start
    while i + 8 <= end:
        cid = data[i:i + 4]
        size = struct.unpack_from('<I', data, i + 4)[0]
        yield cid, i + 8, size
        i += 8 + size + (size & 1)

def walk(data, start, end, depth, info):
    for cid, off, size in chunks(data, start, end):
        name = cid.decode('latin1')
        if name in ('RIFF', 'LIST'):
            sub = data[off:off + 4].decode('latin1')
            print('  ' * depth + f'{name}({sub}) size={size}')
            if sub == 'movi':
                frames = [s for c, o, s in chunks(data, off + 4, off + size)]
                kinds = {}
                for c, o, s in chunks(data, off + 4, off + size):
                    k = c.decode('latin1'); kinds[k] = kinds.get(k, 0) + 1
                    if k.endswith('dc') and 'first' not in info:
                        info['first'] = data[o:o + 4].hex()
                print('  ' * (depth + 1) + f'movi: {len(frames)} chunks {kinds}; tamaño min/max/media = '
                      f'{min(frames)}/{max(frames)}/{sum(frames)//max(1,len(frames))}; primeros bytes del 1º vídeo: {info.get("first")}')
            else:
                walk(data, off + 4, off + size, depth + 1, info)
        elif name == 'avih':
            us, maxbps, pad, flags, total, init, streams, buf, w, h = struct.unpack_from('<10I', data, off)
            print('  ' * depth + f'avih: {1e6/us:.2f} fps ({us} µs/frame), frames={total}, streams={streams}, {w}x{h}, flags=0x{flags:x}')
        elif name == 'strh':
            typ = data[off:off + 4].decode('latin1'); handler = data[off + 4:off + 8].decode('latin1', 'replace')
            scale, rate = struct.unpack_from('<II', data, off + 20)
            length = struct.unpack_from('<I', data, off + 32)[0]
            print('  ' * depth + f'strh: type={typ} handler={handler!r} rate={rate}/{scale} length={length}')
        elif name == 'strf':
            if size >= 40:
                bw, bh = struct.unpack_from('<ii', data, off + 4)
                bits = struct.unpack_from('<H', data, off + 14)[0]
                comp = data[off + 16:off + 20].decode('latin1', 'replace')
                print('  ' * depth + f'strf(video): {bw}x{bh} bits={bits} compression={comp!r}')
            else:
                fmt, ch, sr = struct.unpack_from('<HHI', data, off)
                bits = struct.unpack_from('<H', data, off + 14)[0] if size >= 16 else 0
                print('  ' * depth + f'strf(audio): formatTag=0x{fmt:04x} canales={ch} {sr} Hz bits={bits}')
        elif name == 'idx1':
            print('  ' * depth + f'idx1: {size // 16} entradas')
        else:
            print('  ' * depth + f'{name} size={size}')

if __name__ == '__main__':
    for p in sys.argv[1:]:
        d = open(p, 'rb').read()
        print(f'== {p} ({len(d)} B)')
        walk(d, 0, len(d), 0, {})
