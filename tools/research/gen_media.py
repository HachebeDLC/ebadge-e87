"""Genera medios de prueba 360x360 sin dependencias: PNG (zlib) y GIF animado (LZW mínimo)."""
import struct, zlib, sys, os, math

W = H = 360

def frame(bg, fg, k):
    """Imagen RGB: fondo bg, aro fg y una barra que gira según k (0..n)."""
    px = bytearray(W * H * 3)
    cx = cy = W / 2
    ang = k * math.pi / 3
    for y in range(H):
        for x in range(W):
            dx, dy = x - cx, y - cy
            r = math.hypot(dx, dy)
            c = bg
            if 140 <= r <= 170:
                c = fg
            else:
                # barra radial que gira
                a = math.atan2(dy, dx)
                d = (a - ang + math.pi) % (2 * math.pi) - math.pi
                if r < 130 and abs(d) < 0.18:
                    c = fg
            i = (y * W + x) * 3
            px[i:i + 3] = bytes(c)
    return px

def write_png(path, px):
    raw = b''.join(b'\x00' + bytes(px[y * W * 3:(y + 1) * W * 3]) for y in range(H))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0)))
        f.write(chunk(b'IDAT', zlib.compress(raw, 9)))
        f.write(chunk(b'IEND', b''))

def lzw_gif(indices, min_code=8):
    """LZW 'sin compresión': códigos de 9 bits y CLEAR cada 254 símbolos."""
    clear, eoi = 1 << min_code, (1 << min_code) + 1
    out, bitbuf, nbits = bytearray(), 0, 0
    def emit(code):
        nonlocal bitbuf, nbits
        bitbuf |= code << nbits; nbits += 9
        while nbits >= 8:
            out.append(bitbuf & 0xff); bitbuf >>= 8; nbits -= 8
    emit(clear)
    for n, v in enumerate(indices):
        if n and n % 254 == 0:
            emit(clear)
        emit(v)
    emit(eoi)
    if nbits:
        out.append(bitbuf & 0xff)
    blocks = bytearray()
    for i in range(0, len(out), 255):
        seg = out[i:i + 255]
        blocks += bytes([len(seg)]) + seg
    return bytes([min_code]) + bytes(blocks) + b'\x00'

def write_gif(path, frames, palette, delay_cs=15):
    pal = bytearray()
    for c in palette + [(0, 0, 0)] * (256 - len(palette)):
        pal += bytes(c)
    lut = {tuple(c): i for i, c in enumerate(palette)}
    with open(path, 'wb') as f:
        f.write(b'GIF89a' + struct.pack('<HHBBB', W, H, 0xF7, 0, 0) + pal)
        f.write(b'\x21\xFF\x0BNETSCAPE2.0\x03\x01\x00\x00\x00')  # bucle infinito
        for px in frames:
            idx = bytes(lut[tuple(px[i:i + 3])] for i in range(0, len(px), 3))
            f.write(b'\x21\xF9\x04\x04' + struct.pack('<H', delay_cs) + b'\x00\x00')
            f.write(b'\x2C' + struct.pack('<HHHHB', 0, 0, W, H, 0))
            f.write(lzw_gif(idx))
        f.write(b'\x3B')

if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    colors = [((200, 0, 0), (255, 255, 255)), ((0, 140, 0), (255, 255, 0)), ((0, 0, 200), (0, 255, 255))]
    for n, (bg, fg) in enumerate(colors, 1):
        write_png(os.path.join(out, f'ebadge_test_{n}.png'), frame(bg, fg, n))
    palette = [(0, 0, 0), (255, 128, 0)]
    write_gif(os.path.join(out, 'ebadge_test_anim.gif'), [frame((0, 0, 0), (255, 128, 0), k) for k in range(6)], palette)
    for fn in sorted(os.listdir(out)):
        print(fn, os.path.getsize(os.path.join(out, fn)))
