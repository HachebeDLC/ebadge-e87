"""E1 de Bluetooth (SAFER+) para la autenticacion del eBadge E87 / libjl_auth.so.
Implementacion limpia en Python puro, VALIDADA contra 2 vectores reales del dispositivo.

getEncryptedAuthData(msg17) -> 17 bytes = 0x01 || E1(R),  con R = msg17[1:17].

Constantes extraidas por desensamblado de libjl_auth.so:
  KEY  (@0xa3e0) = 06775f87918dd423005df1d8cf0c142b   (clave SAFER+ fija)
  ADDR (@0xa3f0) = 112233332211                       (direccion para E1)
  getEncryptedAuthData @ 0x1f44 -> function_E1 @ 0x10cc
"""

KEY  = bytes.fromhex('06775f87918dd423005df1d8cf0c142b')
ADDR = bytes.fromhex('112233332211')

# tablas SAFER+ : EXP[i] = 45^i mod 257 (256 -> 0), LOG su inversa
EXP = [0] * 256
_v = 1
for _i in range(256):
    EXP[_i] = _v & 0xff
    _v = (_v * 45) % 257
LOG = [0] * 256
for _i in range(256):
    LOG[EXP[_i]] = _i

XOR_IDX = (0, 3, 4, 7, 8, 11, 12, 15)          # XOR en mixing1 / exp en no-lineal
P = (8, 11, 12, 15, 2, 1, 6, 5, 10, 9, 14, 13, 0, 7, 4, 3)   # Armenian Shuffle

def _e257(x):
    return pow(45, x, 257) & 0xff

def keysched(key16):
    """16 bytes -> 17 subkeys de 16 bytes (272 B). SAFER+ estandar."""
    k = list(key16) + [0]
    for b in key16:
        k[16] ^= b
    out = bytearray(key16)                      # K1 = clave
    for i in range(2, 18):                       # K2..K17
        for j in range(17):
            k[j] = ((k[j] << 3) | (k[j] >> 5)) & 0xff
        bias = (_e257(_e257(17 * i + j + 1)) for j in range(16))
        out += bytes((k[(i - 1 + j) % 17] + b) & 0xff for j, b in enumerate(bias))
    return bytes(out)

def _linear(b):
    """Capa lineal SAFER+: 4x (PHT ; permutacion), sin permutar tras el 4o PHT."""
    for it in range(4):
        o = [0] * 16
        for j in range(8):
            x, y = b[2 * j], b[2 * j + 1]
            o[2 * j] = (2 * x + y) & 0xff
            o[2 * j + 1] = (x + y) & 0xff
        b = [o[P[i]] for i in range(16)] if it < 3 else o
    return b

def _round(b, k1, k2):
    b = list(b)
    for j in range(16):
        if j in XOR_IDX: b[j] ^= k1[j]
        else:            b[j] = (b[j] + k1[j]) & 0xff
    for j in range(16):
        b[j] = EXP[b[j]] if j in XOR_IDX else LOG[b[j]]
    for j in range(16):
        if j in XOR_IDX: b[j] = (b[j] + k2[j]) & 0xff
        else:            b[j] ^= k2[j]
    return _linear(b)

def _encrypt(block16, sk, feedfwd):
    """SAFER+ 8 rondas. feedfwd=True -> Ar' (suma la entrada de la ronda 1 antes de la ronda 3)."""
    b = list(block16)
    saved = list(block16)
    for r in range(8):
        if feedfwd and r == 2:
            for j in range(16):
                if j in XOR_IDX: b[j] ^= saved[j]
                else:            b[j] = (b[j] + saved[j]) & 0xff
        b = _round(b, sk[32 * r:32 * r + 16], sk[32 * r + 16:32 * r + 32])
    k17 = sk[256:272]
    for j in range(16):
        if j in XOR_IDX: b[j] ^= k17[j]
        else:            b[j] = (b[j] + k17[j]) & 0xff
    return bytes(b)

def _ktilde(k):
    off = ((233, 0), (229, 1), (223, 0), (193, 1), (179, 0), (167, 1), (149, 0), (131, 1),
           (233, 1), (229, 0), (223, 1), (193, 0), (179, 1), (167, 0), (149, 1), (131, 0))
    return bytes((k[i] ^ c) & 0xff if x else (k[i] + c) & 0xff for i, (c, x) in enumerate(off))

def e1(rand16, key=KEY, addr=ADDR):
    """E1 de Bluetooth: dos pasadas SAFER+ con realimentacion de direccion."""
    aexp = bytes(addr[i % len(addr)] for i in range(16))
    a = _encrypt(rand16, keysched(key), False)
    tmp = bytes((aexp[i] + (a[i] ^ rand16[i])) & 0xff for i in range(16))
    return _encrypt(tmp, keysched(_ktilde(key)), True)

def get_encrypted_auth_data(msg17):
    """Equivalente a getEncryptedAuthData(0x1f44): 0x01 || E1(msg17[1:17])."""
    return b'\x01' + e1(bytes(msg17[1:17]))


if __name__ == '__main__':
    VEC = [('00a0a7cdb366d01ff8e3b4d0157423ce73', '01024767f9cd4bc12513740315d5fccc8f'),
           ('00ab8b759428aa824de5cd668a276393c8', '01418aecb43bceb2bc4fe763c61ce20b16')]
    allok = True
    for inp, exp in VEC:
        out = get_encrypted_auth_data(bytes.fromhex(inp)).hex()
        ok = out == exp
        allok &= ok
        print(f'{inp} -> {out}  {"OK" if ok else "FALLO esperado "+exp}')
    print('TODOS OK' if allok else 'HAY FALLOS')
