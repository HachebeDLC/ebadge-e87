"""Busca la variante exacta de SAFER+ del E87 usando las tablas del binario y 2 pares conocidos."""
import itertools

D = open(r'<RUTA>\Documents\EBadge\scratch\native\libjl_auth.so', 'rb').read()
EXP = list(D[0x9e0:0x9e0 + 256])
LOG = list(D[0xae0:0xae0 + 256])
BIAS = [list(D[0x8d0 + r * 16:0x8d0 + (r + 1) * 16]) for r in range(17)]
KEY = bytes.fromhex('06775f87918dd423005df1d8cf0c142b')
PAIRS = [(bytes.fromhex('a0a7cdb366d01ff8e3b4d0157423ce73'), bytes.fromhex('024767f9cd4bc12513740315d5fccc8f')),
         (bytes.fromhex('ab8b759428aa824de5cd668a276393c8'), bytes.fromhex('418aecb43bceb2bc4fe763c61ce20b16'))]
EXPPOS = {0, 3, 4, 7, 8, 11, 12, 15}
PERM = [8, 11, 12, 15, 2, 1, 6, 5, 10, 9, 14, 13, 0, 3, 4, 7]

def keysched(key, bias_off):
    reg = list(key) + [0]
    p = 0
    for b in key:
        p ^= b
    reg[16] = p
    sub = [list(key)]
    for i in range(1, 17):
        reg = [((x << 3) | (x >> 5)) & 0xff for x in reg]
        row = BIAS[(i - 1 + bias_off) % 17]
        sub.append([(reg[(i + j) % 17] + row[j]) & 0xff for j in range(16)])
    return sub

def pht(v, order):
    o = [0] * 16
    for i in range(0, 16, 2):
        a, b = v[i], v[i + 1]
        if order:
            o[i] = (2 * a + b) & 0xff; o[i + 1] = (a + b) & 0xff
        else:
            o[i] = (a + b) & 0xff; o[i + 1] = (a + 2 * b) & 0xff
    return o

def shuf(v, inv):
    if inv:
        o = [0] * 16
        for i in range(16):
            o[PERM[i]] = v[i]
        return o
    return [v[PERM[i]] for i in range(16)]

def linear(v, nlayers, order, inv, shuf_first):
    for _ in range(nlayers):
        if shuf_first:
            v = shuf(v, inv); v = pht(v, order)
        else:
            v = pht(v, order); v = shuf(v, inv)
    return v

def enc(block, key, cfg):
    bias_off, nlayers, order, inv, shuf_first, rounds = cfg
    K = keysched(key, bias_off)
    X = list(block)
    for r in range(rounds):
        k1 = K[2 * r + 1]; k2 = K[2 * r + 2]
        Y = [0] * 16
        for j in range(16):
            if j in EXPPOS:
                Y[j] = EXP[(X[j] ^ k1[j])]
                Y[j] = (Y[j] + k2[j]) & 0xff
            else:
                Y[j] = LOG[(X[j] + k1[j]) & 0xff]
                Y[j] = (Y[j] ^ k2[j])
        X = linear(Y, nlayers, order, inv, shuf_first)
    kf = K[2 * rounds] if 2 * rounds < len(K) else K[-1]
    out = [0] * 16
    for j in range(16):
        out[j] = (X[j] ^ kf[j]) if j in EXPPOS else (X[j] + kf[j]) & 0xff
    return bytes(out)

def search():
    grid = itertools.product(range(17), (3, 4), (True, False), (True, False), (True, False), (8,))
    for cfg in grid:
        if all(enc(p, KEY, cfg) == c for p, c in PAIRS):
            print('MATCH cfg (bias_off,nlayers,phtOrder,shufInv,shufFirst,rounds):', cfg)
            return cfg
    print('sin coincidencia en esta rejilla')
    # muestra el mejor número de bytes acertados
    best = (-1, None)
    for cfg in itertools.product(range(17), (3, 4), (True, False), (True, False), (True, False), (8,)):
        s = sum(a == b for p, c in PAIRS for a, b in zip(enc(p, KEY, cfg), c))
        if s > best[0]:
            best = (s, cfg)
    print('mejor:', best, '/ 32 bytes')
    return None

if __name__ == '__main__':
    search()
