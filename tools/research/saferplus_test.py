"""SAFER+ (128-bit) y variantes Bluetooth Ar/Ar', probadas contra los pares de autenticación del E87."""

# Tabla exp: 45^i mod 257 (257 -> 0). Tabla log = inversa.
EXP = [0] * 256
_x = 1
for _i in range(256):
    EXP[_i] = _x % 257 % 256 if _x != 256 else 0
    EXP[_i] = (_x if _x != 256 else 0) & 0xff
    _x = (_x * 45) % 257
LOG = [0] * 256
for _i in range(256):
    LOG[EXP[_i]] = _i

def _exp(x): return EXP[x & 0xff]
def _log(x): return LOG[x & 0xff]

def key_schedule(key16):
    # SAFER+ 128-bit: 17 subclaves de 16 bytes
    bias = _biases()
    K = [bytearray(16) for _ in range(17)]
    bk = bytearray(key16)
    # byte de paridad
    par = 0
    for b in bk:
        par ^= b
    words = list(bk) + [par]
    K[0] = bytearray(bk)
    for r in range(1, 17):
        for j in range(17):
            words[j] = ((words[j] << 3) | (words[j] >> 5)) & 0xff
        sel = [words[(r + j) % 17] for j in range(16)]
        K[r] = bytearray((sel[j] + bias[r][j]) & 0xff for j in range(16))
    return K

def _biases():
    B = [[0] * 16 for _ in range(17)]
    for i in range(1, 17):
        for j in range(16):
            B[i][j] = _exp(_exp((17 * i + j + 1) % 256))
    return B

def _pht(a, b):
    a &= 0xff; b &= 0xff
    x = (2 * a + b) & 0xff
    y = (a + b) & 0xff
    return x, y

def _ar_round(blk, k_odd, k_even):
    out = bytearray(16)
    for i in range(16):
        if i in (0, 3, 4, 7, 8, 11, 12, 15):
            out[i] = _exp(blk[i] ^ k_odd[i])
        else:
            out[i] = (_log(blk[i]) + k_even[i]) & 0xff if False else (_log(blk[i]) ^ k_even[i]) & 0xff
    # tipo correcto: posiciones exp usan ^, log usan +; aquí mezclamos — ver variante abajo
    return out

def saferplus_encrypt(key16, block16, rounds=8, bt_ar=False):
    K = key_schedule(key16)
    b = bytearray(block16)
    for r in range(rounds):
        k1 = K[2 * r + 1]; k2 = K[2 * r + 2]
        # capa no lineal (orden estándar SAFER+: E,L,L,E repetido)
        nb = bytearray(16)
        pat = [0, 1, 1, 0] * 4   # 0=exp(x^k), 1=log(x)+k
        for i in range(16):
            if pat[i] == 0:
                nb[i] = _exp(b[i] ^ k1[i])
            else:
                nb[i] = (_log(b[i]) + k1[i]) & 0xff
        # suma de subclave par
        for i in range(16):
            nb[i] = ((nb[i] + k2[i]) & 0xff) if pat[i] == 0 else (nb[i] ^ k2[i])
        # 4 capas PHT con permutaciones (Armenian shuffle)
        b = _linear(nb)
        if bt_ar and r == 2:  # Ar': realimenta la entrada en la ronda 3
            for i in range(16):
                b[i] ^= block16[i]
    for i in range(16):
        b[i] = (b[i] + K[2 * rounds][i]) & 0xff if (i in (0,3,4,7,8,11,12,15)) else (b[i] ^ K[2 * rounds][i])
    return bytes(b)

def _linear(x):
    # 3 niveles PHT con el shuffle SAFER+ entre ellos (versión estándar)
    def pht_layer(v):
        o = bytearray(16)
        for i in range(0, 16, 2):
            a, bb = _pht(v[i], v[i + 1])
            o[i] = a; o[i + 1] = bb
        return o
    SHUF = [8, 11, 12, 15, 2, 1, 6, 5, 10, 9, 14, 13, 0, 3, 4, 7]
    x = pht_layer(x)
    x = bytearray(x[SHUF[i]] for i in range(16))
    x = pht_layer(x)
    x = bytearray(x[SHUF[i]] for i in range(16))
    x = pht_layer(x)
    return x

if __name__ == '__main__':
    key = bytes.fromhex('06775f87918dd423005df1d8cf0c142b')
    pairs = [('a0a7cdb366d01ff8e3b4d0157423ce73', '024767f9cd4bc12513740315d5fccc8f'),
             ('ab8b759428aa824de5cd668a276393c8', '418aecb43bceb2bc4fe763c61ce20b16')]
    print('EXP[0:8]', EXP[:8], '(SAFER+ espera 1,45,226,147,60,237,28,105)')
    for name, kw in [('plain', dict(bt_ar=False)), ('bt_ar', dict(bt_ar=True))]:
        ok = all(saferplus_encrypt(key, bytes.fromhex(p)).hex() == c for p, c in pairs)
        print(name, 'coincide ambos:', ok)
        print('   ', saferplus_encrypt(key, bytes.fromhex(pairs[0][0]), **kw).hex(), 'esperado', pairs[0][1])
