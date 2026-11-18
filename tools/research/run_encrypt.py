"""Ejecuta el cifrado SAFER+ (0x16cc) emulado, con subclaves del keysched (0x15c4) en Python,
y lo valida contra los pares de autenticación del E87."""
import sys
sys.path.insert(0, r'<RUTA>\Documents\EBadge\tools')
from arm64emu import Emu

D = open(r'<RUTA>\Documents\EBadge\scratch\native\libjl_auth.so', 'rb').read()
BIASrow = [list(D[0x8d0 + r * 16:0x8d0 + (r + 1) * 16]) for r in range(17)]

def keysched(key):
    reg = list(key) + [0]
    p = 0
    for b in key:
        p ^= b
    reg[16] = p
    out = bytearray(key)            # subkey[0]
    for r in range(1, 17):
        reg = [((x << 3) | (x >> 5)) & 0xff for x in reg]
        row = BIASrow[r]
        for j in range(16):
            out.append((reg[(r + j) % 17] + row[15 - j]) & 0xff)
    return bytes(out)  # 272 B

BLOCK = 0x50000
SUBK = 0x60000

def encrypt(block16, key16, flag):
    e = Emu()
    sub = keysched(key16)
    e.mem.w(BLOCK, block16)
    e.mem.w(SUBK, sub)
    e.x[0] = BLOCK; e.x[1] = SUBK; e.x[2] = flag
    # tpidr_el0 -> stack canary: e.mem en [x8+0x28]; mrs devuelve 0 por defecto -> leeremos 0
    e.run(0x16cc, 0x1b08)   # hasta el ret final
    return e.mem.r(BLOCK, 16)

if __name__ == '__main__':
    KEY = bytes.fromhex('06775f87918dd423005df1d8cf0c142b')
    PAIRS = [('a0a7cdb366d01ff8e3b4d0157423ce73', '024767f9cd4bc12513740315d5fccc8f'),
             ('ab8b759428aa824de5cd668a276393c8', '418aecb43bceb2bc4fe763c61ce20b16')]
    for flag in (0, 1):
        print(f'--- flag={flag} ---')
        for p, c in PAIRS:
            out = encrypt(bytes.fromhex(p), KEY, flag).hex()
            print(f'  {p} -> {out}   esperado {c}   {"OK" if out==c else ""}')
