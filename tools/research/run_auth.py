"""E(R) = keysched(clave_fija)+encrypt(R,flag) ejecutado ENTERO en el emulador nativo."""
import sys
sys.path.insert(0, r'<RUTA>\Documents\EBadge\tools')
from arm64emu import Emu

KEYADDR = 0x40000; BLOCK = 0x50000; SUBK = 0x60000

def E(block16, key16, flag):
    e = Emu()
    e.mem.w(KEYADDR, key16)
    e.x[0] = KEYADDR; e.x[1] = SUBK
    e.run(0x15c4, 0x16c4)          # keysched -> SUBK (272 B)
    e.mem.w(BLOCK, block16)
    e.x[0] = BLOCK; e.x[1] = SUBK; e.x[2] = flag
    e.run(0x16cc, 0x1b08)          # encrypt -> BLOCK
    return e.mem.r(BLOCK, 16)

if __name__ == '__main__':
    KEY = bytes.fromhex('06775f87918dd423005df1d8cf0c142b')
    PAIRS = [('a0a7cdb366d01ff8e3b4d0157423ce73', '024767f9cd4bc12513740315d5fccc8f'),
             ('ab8b759428aa824de5cd668a276393c8', '418aecb43bceb2bc4fe763c61ce20b16')]
    for flag in (0, 1):
        print(f'--- flag={flag} ---')
        for p, c in PAIRS:
            o = E(bytes.fromhex(p), KEY, flag).hex()
            print(f'  {p} -> {o}  {"<<< OK" if o == c else "esperado "+c}')
