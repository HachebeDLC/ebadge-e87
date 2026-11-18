import sys
sys.path.insert(0, r'<RUTA>\Documents\EBadge\tools')
from arm64emu import Emu
from run_encrypt import keysched as py_ks

KEY = bytes.fromhex('06775f87918dd423005df1d8cf0c142b')
KEYADDR = 0x40000; SUBK = 0x60000

def native_ks(key):
    e = Emu()
    e.mem.w(KEYADDR, key)
    e.x[0] = KEYADDR; e.x[1] = SUBK
    e.run(0x15c4, 0x16c4)
    return e.mem.r(SUBK, 272)

nat = native_ks(KEY)
py = py_ks(KEY)
print('coinciden:', nat == py)
if nat != py:
    for r in range(17):
        a = nat[r * 16:(r + 1) * 16]; b = py[r * 16:(r + 1) * 16]
        print(f'  subkey[{r:2}] nat={a.hex()} {"==" if a==b else "!="}')
        if a != b:
            print(f'            py ={b.hex()}')
