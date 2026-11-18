"""E1 completo sobre SAFER+ limpio; busca la variante de capa lineal que iguala
los vectores del dispositivo. KEY/ADDR fijos del desensamblado de libjl_auth.so."""
import sys
sys.path.insert(0, r'<RUTA>\Documents\EBadge\tools')
import saferplus_ref as S

KEY  = bytes.fromhex('06775f87918dd423005df1d8cf0c142b')
ADDR = bytes.fromhex('112233332211')

# K~ estandar Bluetooth E1 (confirmado = desensamblado)
def ktilde(k):
    add = [233, None, 223, None, 179, None, 149, None, None, 229, None, 193, None, 167, None, 131]
    xor = [None, 229, None, 193, None, 167, None, 131, 233, None, 223, None, 179, None, 149, None]
    o = bytearray(16)
    for i in range(16):
        o[i] = (k[i] ^ xor[i]) & 0xff if xor[i] is not None else (k[i] + add[i]) & 0xff
    return bytes(o)

def addr_exp(addr, mode):
    if mode == 'mod6':
        return bytes(addr[i % 6] for i in range(16))
    if mode == 'rep664':   # addr||addr||addr[0:4]
        return bytes((addr + addr + addr[:4])[i] for i in range(16))
    raise ValueError

def e1(rand16, lin, aexp):
    sk = S.keysched(KEY)
    A = S.encrypt(rand16, sk, 0, lin)
    tmp = bytes((aexp[i] + (A[i] ^ rand16[i])) & 0xff for i in range(16))
    sk2 = S.keysched(ktilde(KEY))
    return S.encrypt(tmp, sk2, 1, lin)

PAIRS = [('a0a7cdb366d01ff8e3b4d0157423ce73', '024767f9cd4bc12513740315d5fccc8f'),
         ('ab8b759428aa824de5cd668a276393c8', '418aecb43bceb2bc4fe763c61ce20b16')]

if __name__ == '__main__':
    best = None
    for order in ('pht_perm', 'perm_pht'):
        for permfn, pname in ((S.perm_gather, 'gather'), (S.perm_scatter, 'scatter')):
            for last in (True, False):
                lin = lambda b, o=order, p=permfn, l=last: S.linear(b, o, p, l)
                for amode in ('mod6', 'rep664'):
                    aexp = addr_exp(ADDR, amode)
                    outs = [e1(bytes.fromhex(p), lin, aexp).hex() for p, c in PAIRS]
                    ok = sum(outs[i] == PAIRS[i][1] for i in range(2))
                    tag = f'{order}/{pname}/last={last}/{amode}'
                    if ok:
                        print(f'[{ok}/2] {tag}  ->  {outs}')
                    # tambien cuenta bytes correctos del primer vector
                    exp0 = bytes.fromhex(PAIRS[0][1]); got0 = bytes.fromhex(outs[0])
                    nb = sum(exp0[i] == got0[i] for i in range(16))
                    if best is None or nb > best[0]:
                        best = (nb, tag, outs[0])
    print('mejor por bytes:', best)
