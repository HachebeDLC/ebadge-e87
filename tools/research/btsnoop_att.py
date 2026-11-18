"""Parser mínimo de btsnoop (H4) → ACL → L2CAP → ATT, sin dependencias.

Uso: python -I btsnoop_att.py btsnoop_hci.log [--mac AA:BB:CC:DD:EE:FF] [--json out.json]
Imprime cada PDU ATT con dirección, handle, UUID resuelto (si se vio el descubrimiento) y valor.
"""
import struct, sys, json, datetime

ATT_OPS = {
    0x01: 'ERROR_RSP', 0x02: 'MTU_REQ', 0x03: 'MTU_RSP', 0x04: 'FIND_INFO_REQ', 0x05: 'FIND_INFO_RSP',
    0x08: 'READ_BY_TYPE_REQ', 0x09: 'READ_BY_TYPE_RSP', 0x0A: 'READ_REQ', 0x0B: 'READ_RSP',
    0x10: 'READ_BY_GROUP_REQ', 0x11: 'READ_BY_GROUP_RSP', 0x12: 'WRITE_REQ', 0x13: 'WRITE_RSP',
    0x1B: 'NOTIFY', 0x1D: 'INDICATE', 0x1E: 'CONFIRM', 0x52: 'WRITE_CMD',
}

def uuid_str(b):
    if len(b) == 2:
        return '%04x' % struct.unpack('<H', b)[0]
    if len(b) == 16:
        h = b[::-1].hex()
        return f'{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}'
    return b.hex()

def records(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'btsnoop\x00', 'no es btsnoop'
    i = 16
    while i + 24 <= len(data):
        olen, ilen, flags, drops, ts = struct.unpack_from('>IIIIq', data, i)
        i += 24
        yield flags, ts, data[i:i + ilen]
        i += ilen

def ts_str(ts):
    # microsegundos desde 0000-01-01; offset estándar de btsnoop
    epoch_us = ts - 0x00dcddb30f2f8000
    return datetime.datetime.fromtimestamp(epoch_us / 1e6).strftime('%H:%M:%S.%f')[:-3]  # hora local

def parse(path, mac=None):
    want = None
    if mac:
        want = bytes.fromhex(mac.replace(':', ''))[::-1]
    conn_addr = {}          # handle ACL -> mac
    frag = {}               # (dir, handle) -> [expected_len, bytes]
    handles = {}            # (acl, att_handle) -> uuid
    out = []
    pending_group = {}
    for flags, ts, pkt in records(path):
        if not pkt:
            continue
        direction = 'RX' if flags & 1 else 'TX'
        ptype = pkt[0]
        if ptype == 0x04 and len(pkt) > 3 and pkt[1] == 0x3E:      # LE meta event
            sub = pkt[3]
            if sub in (0x01, 0x0A):
                status, h = pkt[4], struct.unpack_from('<H', pkt, 5)[0]
                addr = pkt[9:15]
                if status == 0:
                    conn_addr[h & 0x0FFF] = addr
            continue
        if ptype != 0x02:
            continue
        hf, alen = struct.unpack_from('<HH', pkt, 1)
        h, pb = hf & 0x0FFF, (hf >> 12) & 0x3
        body = pkt[5:5 + alen]
        key = (direction, h)
        if pb in (0x0, 0x2):   # inicio
            if len(body) < 4:
                continue
            l2len = struct.unpack_from('<H', body, 0)[0]
            frag[key] = [l2len, bytearray(body)]
        elif pb == 0x1 and key in frag:
            frag[key][1] += body
        else:
            continue
        l2len, buf = frag[key]
        if len(buf) < 4 + l2len:
            continue
        del frag[key]
        cid = struct.unpack_from('<H', buf, 2)[0]
        if cid != 0x0004:
            continue
        att = bytes(buf[4:4 + l2len])
        if want and conn_addr.get(h) not in (None, want):
            continue
        op = att[0]
        rec = {'t': ts_str(ts), 'dir': direction, 'acl': h, 'op': ATT_OPS.get(op, '0x%02x' % op)}
        # descubrimiento → mapa handle→uuid
        if op == 0x09 and len(att) > 2 and att[1] in (7, 21):   # READ_BY_TYPE_RSP (declaraciones de características)
            ln = att[1]
            for j in range(2, len(att) - ln + 1, ln):
                e = att[j:j + ln]
                vh = struct.unpack_from('<H', e, 3)[0]
                handles[(h, vh)] = uuid_str(e[5:])
        elif op == 0x05 and len(att) > 2:           # FIND_INFO_RSP (descriptores)
            fmt = att[1]; ln = 4 if fmt == 1 else 18
            for j in range(2, len(att) - ln + 1, ln):
                e = att[j:j + ln]
                dh = struct.unpack_from('<H', e, 0)[0]
                handles.setdefault((h, dh), uuid_str(e[2:]))
        elif op == 0x11 and len(att) > 2:           # servicios
            ln = att[1]
            for j in range(2, len(att) - ln + 1, ln):
                e = att[j:j + ln]
                s, en = struct.unpack_from('<HH', e, 0)
                rec.setdefault('services', []).append((s, en, uuid_str(e[4:])))
        if op in (0x12, 0x52, 0x1B, 0x1D, 0x0A, 0x0B) and len(att) >= 3:
            if op == 0x0B:
                rec['value'] = att[1:].hex()
            else:
                ah = struct.unpack_from('<H', att, 1)[0]
                rec['handle'] = ah
                rec['value'] = att[3:].hex()
        elif op == 0x02 or op == 0x03:
            rec['mtu'] = struct.unpack_from('<H', att, 1)[0]
        elif op == 0x01:
            rec['value'] = att[1:].hex()
        out.append(rec)
    for r in out:
        if 'handle' in r:
            r['uuid'] = handles.get((r['acl'], r['handle']), '?')
    return out, handles, conn_addr

if __name__ == '__main__':
    args = sys.argv[1:]
    mac = args[args.index('--mac') + 1] if '--mac' in args else None
    js = args[args.index('--json') + 1] if '--json' in args else None
    recs, handles, conns = parse(args[0], mac)
    print('conexiones ACL:', {h: a[::-1].hex(':') for h, a in conns.items()})
    print('handles:', len(handles))
    for (acl, hh), u in sorted(handles.items()):
        print(f'  acl={acl} handle=0x{hh:04x} {u}')
    for r in recs:
        if 'services' in r:
            for s in r['services']:
                print(f"  servicio 0x{s[0]:04x}-0x{s[1]:04x} {s[2]}")
    if js:
        json.dump(recs, open(js, 'w'), indent=0)
    print('PDUs ATT:', len(recs))
