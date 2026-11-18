"""SAFER+ del E87 reconstruido del desensamblado de libjl_auth.so. Busca la capa lineal exacta."""
import itertools

D = open(r'<RUTA>\Documents\EBadge\scratch\native\libjl_auth.so', 'rb').read()
EXP = list(D[0x9e0:0x9e0 + 256])
LOG = list(D[0xae0:0xae0 + 256])
# BIAS: fila r (1..16) -> bytes row_r[15], row_r[14], ... row_r[0]  (lectura inversa del binario)
BIASrow = [list(D[0x8d0 + r * 16:0x8d0 + (r + 1) * 16]) for r in range(17)]
KEY = bytes.fromhex('06775f87918dd423005df1d8cf0c142b')
PAIRS = [(bytes.fromhex('a0a7cdb366d01ff8e3b4d0157423ce73'), bytes.fromhex('024767f9cd4bc12513740315d5fccc8f')),
         (bytes.fromhex('ab8b759428aa824de5cd668a276393c8'), bytes.fromhex('418aecb43bceb2bc4fe763c61ce20b16'))]
EXPPOS = [i for i in range(16) if (0x9999 >> i) & 1]  # 0,3,4,7,8,11,12,15

def keysched(key):
    reg = list(key) + [0]
    p = 0
    for b in key:
        p ^= b
    reg[16] = p
    sub = [list(key)]
    for r in range(1, 17):
        reg = [((x << 3) | (x >> 5)) & 0xff for x in reg]
        row = BIASrow[r]
        sk = [(reg[(r + j) % 17] + row[15 - j]) & 0xff for j in range(16)]
        sub.append(sk)
    return sub  # 17 subclaves

def pht(v, order):
    o = [0] * 16
    for i in range(0, 16, 2):
        a, b = v[i], v[i + 1]
        o[i], o[i + 1] = ((2 * a + b) & 0xff, (a + b) & 0xff) if order else ((a + b) & 0xff, (a + 2 * b) & 0xff)
    return o

def apply_perm(v, perm):
    return [v[perm[i]] for i in range(16)]

PERMS = {
    'armenian': [8, 11, 12, 15, 2, 1, 6, 5, 10, 9, 14, 13, 0, 3, 4, 7],
    'interleave': [0, 8, 1, 9, 2, 10, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15],
    'saferk': [8, 0, 9, 1, 10, 2, 11, 3, 12, 4, 13, 5, 14, 6, 15, 7],
    'rev_interleave': [0, 2, 4, 6, 8, 10, 12, 14, 1, 3, 5, 7, 9, 11, 13, 15],
}

def linear(v, nlayers, order, perm, inv, shuf_first):
    for _ in range(nlayers):
        if shuf_first:
            v = apply_perm(v, perm) if not inv else _inv_perm(v, perm)
            v = pht(v, order)
        else:
            v = pht(v, order)
            v = apply_perm(v, perm) if not inv else _inv_perm(v, perm)
    return v

def _inv_perm(v, perm):
    o = [0] * 16
    for i in range(16):
        o[perm[i]] = v[i]
    return o

def enc(block, key, flag, cfg):
    nlayers, order, permname, inv, shuf_first, last_perm = cfg
    K = keysched(key)
    X = list(block)
    orig = list(block)
    for r in range(8):
        if flag and r == 2:
            for i in EXPPOS:
                X[i] = (X[i] + orig[i]) & 0xff
        k1 = K[2 * r]; k2 = K[2 * r + 1]
        for i in range(16):
            X[i] = (X[i] ^ k1[i]) if i in EXPPOS else (X[i] + k1[i]) & 0xff
        for i in range(16):
            X[i] = EXP[X[i]] if i in EXPPOS else LOG[X[i]]
        for i in range(16):
            X[i] = (X[i] + k2[i]) & 0xff if i in EXPPOS else (X[i] ^ k2[i])
        nl = nlayers if not last_perm else (nlayers + (1 if r == 7 else 0))
        X = linear(X, nlayers, order, PERMS[permname], inv, shuf_first)
    k16 = K[16]
    for i in range(16):
        X[i] = (X[i] ^ k16[i]) if i in EXPPOS else (X[i] + k16[i]) & 0xff
    return bytes(X)

def search():
    grids = itertools.product((3, 4), (True, False), list(PERMS), (True, False), (True, False), (False,))
    for cfg in grids:
        for flag in (0, 1):
            for tweak in ('none', 'xor6'):
                k = bytearray(KEY)
                if tweak == 'xor6':
                    k[15] ^= 6
                if all(enc(p, bytes(k), flag, cfg) == c for p, c in PAIRS):
                    print('MATCH  cfg:', cfg, 'flag:', flag, 'tweak:', tweak)
                    return
    # mejor aproximación
    best = (-1, None)
    for cfg in itertools.product((3, 4), (True, False), list(PERMS), (True, False), (True, False), (False,)):
        for flag in (0, 1):
            s = sum(a == b for p, c in PAIRS for a, b in zip(enc(p, KEY, flag, cfg), c))
            if s > best[0]:
                best = (s, (cfg, flag))
    print('sin match. mejor', best, '/32')

if __name__ == '__main__':
    print('EXPPOS', EXPPOS)
    search()
