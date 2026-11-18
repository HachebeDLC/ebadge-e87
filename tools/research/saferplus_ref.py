"""SAFER+ / Bluetooth E1 de referencia (puro Python).
Validacion por etapas contra el emulador nativo (nat) y los vectores del dispositivo.
Permutacion Armenian Shuffle confirmada por fuentes: 8 11 12 15 2 1 6 5 10 9 14 13 0 7 4 3
"""

# --- tablas exp/log (45^x mod 257) ---
EXP = [0]*256
_v = 1
for i in range(256):
    EXP[i] = _v & 0xff          # 45^i mod 257, y 256->0
    _v = (_v * 45) % 257
LOG = [0]*256
for i in range(256):
    LOG[EXP[i]] = i

# indices que usan XOR en el primer mixing (exp en no-lineal): 0,3,4,7,8,11,12,15
XOR_IDX = {0, 3, 4, 7, 8, 11, 12, 15}

# --- bias del key schedule: B_i[j] = EXP[EXP[(17*i + j + 1) mod 257]] ---
def _e257(x):
    return pow(45, x, 257) & 0xff   # 45^x mod 257, 256->0

def _bias(i, j):
    return _e257(_e257(17 * i + j + 1))

def keysched(key16):
    """Devuelve 17 subkeys de 16 bytes (K1..K17) concatenadas (272 bytes)."""
    k = list(key16) + [0]
    k[16] = 0
    for b in key16:
        k[16] ^= b
    out = bytearray()
    out += bytes(k[0:16])               # K1 = clave
    for i in range(2, 18):              # K2..K17
        # rotar cada uno de los 17 bytes a la izquierda 3 bits
        for j in range(17):
            k[j] = ((k[j] << 3) | (k[j] >> 5)) & 0xff
        sub = bytes((k[(i - 1 + j) % 17] + _bias(i, j)) & 0xff for j in range(16))
        out += sub
    return bytes(out)

# --- capa lineal: variantes a probar ---
P = [8, 11, 12, 15, 2, 1, 6, 5, 10, 9, 14, 13, 0, 7, 4, 3]

def pht(b):
    o = [0] * 16
    for j in range(8):
        x = b[2 * j]; y = b[2 * j + 1]
        o[2 * j] = (2 * x + y) & 0xff
        o[2 * j + 1] = (x + y) & 0xff
    return o

def perm_gather(b):      # new[i] = b[P[i]]
    return [b[P[i]] for i in range(16)]

def perm_scatter(b):     # new[P[i]] = b[i]
    o = [0] * 16
    for i in range(16):
        o[P[i]] = b[i]
    return o

def linear(b, order, perm, last_perm):
    """order: 'pht_perm' o 'perm_pht'; perm: fn; last_perm: aplicar perm en la 4a iter."""
    b = list(b)
    for it in range(4):
        if order == 'pht_perm':
            b = pht(b)
            if it < 3 or last_perm:
                b = perm(b)
        else:
            if it < 3 or last_perm:
                b = perm(b)
            b = pht(b)
    return b

def round_fn(b, k1, k2, lin):
    b = list(b)
    # mixing 1
    for j in range(16):
        if j in XOR_IDX: b[j] ^= k1[j]
        else:            b[j] = (b[j] + k1[j]) & 0xff
    # no-lineal
    for j in range(16):
        if j in XOR_IDX: b[j] = EXP[b[j]]
        else:            b[j] = LOG[b[j]]
    # mixing 2
    for j in range(16):
        if j in XOR_IDX: b[j] = (b[j] + k2[j]) & 0xff
        else:            b[j] ^= k2[j]
    pre_pht = bytes(b)
    b = lin(b)
    return b, pre_pht

def encrypt(block16, subkeys, flag, lin):
    b = list(block16)
    saved = None
    for r in range(8):
        if flag and r == 2 and saved is not None:
            # feedforward Ar': sumar/xor el bloque de entrada de la ronda 1
            for j in range(16):
                if j in XOR_IDX: b[j] ^= saved[j]
                else:            b[j] = (b[j] + saved[j]) & 0xff
        k1 = subkeys[(2 * r) * 16:(2 * r) * 16 + 16]
        k2 = subkeys[(2 * r + 1) * 16:(2 * r + 1) * 16 + 16]
        b, pre = round_fn(b, k1, k2, lin)
        if r == 0 and flag == 0:
            encrypt.pre0 = pre
        if r == 0:
            saved = list(block16)  # entrada de la ronda 1 (se guarda tras usarla)
    # transformacion final con K17
    k17 = subkeys[16 * 16:17 * 16]
    for j in range(16):
        if j in XOR_IDX: b[j] ^= k17[j]
        else:            b[j] = (b[j] + k17[j]) & 0xff
    return bytes(b)


if __name__ == '__main__':
    KEY = bytes.fromhex('06775f87918dd423005df1d8cf0c142b')
    sk = keysched(KEY)
    nat1 = '014082d2b2ec5f4630d50cc4a6e69f46'   # subkey[1] del emulador
    print('subkey[0]:', sk[0:16].hex())
    print('subkey[1]:', sk[16:32].hex(), ' nat:', nat1,
          '==' if sk[16:32].hex() == nat1 else '!=')
    print('subkey[2]:', sk[32:48].hex(), ' nat: c3cd504f21b4ec436822dfeff1b6ec6d')
