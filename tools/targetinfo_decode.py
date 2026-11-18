"""Decodifica la respuesta RCSP 0x03 (GetTargetInfo) de un dispositivo Jieli.

Port de com/jieli/jl_rcsp/model/response/TargetInfoResponse.java::parse y de los
sub-parsers de com/jieli/jl_rcsp/model/response/device/*.java (ver notes/cfw-e87.md).
Uso: python -I tools/targetinfo_decode.py <hex de la trama FEDCBA...EF>
"""
import struct, sys

NAMES = {0: 'protocolVersion', 1: 'systemInfo', 2: 'classicBtInfo', 3: 'aiPlatform',
         4: 'functionConfiguration', 5: 'version', 6: 'sdkType', 7: 'uBootVersion',
         8: 'otaSettings', 9: 'otaState', 10: 'productInfo', 11: 'authKey', 12: 'projectCode',
         13: 'protocolMtu', 14: 'allowConnectFlag', 16: 'name', 17: 'bleInfo',
         18: 'transmitterInfo', 19: 'expandFunc', 21: 'fileConfiguration', 31: 'customVersionMsg'}

def ver4(v): return f'{(v >> 12) & 15}.{(v >> 8) & 15}.{(v >> 4) & 15}.{v & 15}'

def decode(t, d):
    if t == 0: return f'{d[0] >> 4}.{d[0] & 15}'
    if t == 1:
        s = f'bateria={d[0]} vol={d[1]} maxVol={d[2]}'
        if len(d) > 3: s += f' volSync={d[3] & 1}'
        if len(d) > 4: s += f' lowPowerLimit={d[4]}'
        return s
    if t == 2: return 'edrAddr=' + ':'.join(f'{x:02X}' for x in d[:6]) + (f' resto={d[6:].hex()}' if len(d) > 6 else '')
    if t in (5, 7): return f'0x{struct.unpack(">H", d[:2])[0]:04x} = {ver4(struct.unpack(">H", d[:2])[0])}'
    if t == 6: return str(d[0])
    if t == 8:
        s = f'doubleBackup={d[0] == 1}'
        if len(d) > 1: s += f' needBootLoader={d[1] == 1}'
        if len(d) > 2: s += f' singleBackupOtaWay={d[2]}'
        if len(d) > 3: s += f' reuseSpaceOTA={d[3] & 1}'
        return s
    if t == 9:
        s = f'mandatoryUpgrade={d[0]}'
        if len(d) > 1: s += f' requestOta={d[1]}'
        if len(d) > 2: s += f' expandMode={d[2]}'
        return s
    if t == 10:
        if len(d) == 4: uid, pid = struct.unpack('>HH', d); return f'vid=0x05d6(1494, por defecto) uid=0x{uid:04x} pid=0x{pid:04x}'
        vid, pid, uid = struct.unpack('>HHH', d[:6]); return f'vid=0x{vid:04x} pid=0x{pid:04x} uid=0x{uid:04x}'
    if t in (11, 12, 16, 31): return repr(d.decode('latin1'))
    if t == 13:
        if len(d) == 2: return f'mtu={struct.unpack(">H", d)[0]}'
        return 'send={} recv={}'.format(*struct.unpack('>HH', d[:4]))
    if t == 14: return str(d[0])
    return d.hex()

def main(h):
    b = bytes.fromhex(h)
    assert b[:3] == b'\xfe\xdc\xba' and b[-1] == 0xef, 'no es trama RCSP'
    flag, op, ln = b[3], b[4], struct.unpack('>H', b[5:7])[0]
    p = b[7:7 + ln]
    print(f'flag=0x{flag:02x} op=0x{op:02x} len={ln} status={p[0]} sn=0x{p[1]:02x}')
    d, i = p[2:], 0
    while i < len(d):
        L = d[i]
        if L == 0: break
        t, v = d[i + 1], d[i + 2:i + 1 + L]
        print(f'  [{t:2d}] {NAMES.get(t, "?"):22s} {v.hex():40s} -> {decode(t, v)}')
        i += 1 + L

if __name__ == '__main__':
    main(sys.argv[1])
