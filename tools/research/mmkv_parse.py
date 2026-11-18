import struct, sys, json

# Minimal MMKV parser (no encryption). MMKV layout:
#  [0:4] total size (uint32 LE) of used payload after the 8-byte header
#  [4:8] ? (actual: 4 bytes = 0 / version)  -- header is 8 bytes
# Then a sequence of (key, value) entries. Each is:
#   varint keyLen, key bytes, varint valueLen, value bytes
# For putBytes/putString the value bytes themselves start with a varint length
# wrapper (MMKV wraps containers). We expose raw value bytes per key and let
# caller interpret. Last-write-wins: later duplicate keys override earlier.

def read_varint(buf, i):
    shift = 0; result = 0
    while True:
        b = buf[i]; i += 1
        result |= (b & 0x7f) << shift
        if not (b & 0x80): break
        shift += 7
    return result, i

def parse(path):
    data = open(path,'rb').read()
    total = struct.unpack_from('<I', data, 0)[0]
    i = 8
    end = min(8 + total, len(data))
    out = {}
    while i < end:
        try:
            klen, i = read_varint(data, i)
            if klen == 0 or i+klen > end: break
            key = data[i:i+klen].decode('utf-8','replace'); i += klen
            vlen, i = read_varint(data, i)
            val = data[i:i+vlen]; i += vlen
            out[key] = val  # last wins
        except Exception:
            break
    return out

def as_bytes_value(raw):
    # containers (bytes/string) are stored as: varint innerLen, innerBytes
    try:
        inner_len, j = read_varint(raw, 0)
        if j + inner_len == len(raw):
            return raw[j:]
    except Exception:
        pass
    return raw

if __name__ == '__main__':
    kv = parse(sys.argv[1])
    print("TOTAL KEYS:", len(kv))
    interesting = ['function_bytes','ai_function_config','device_serial_num',
                   'device_name','device_mac','device_version','deviceName','deviceMac']
    for k in sorted(kv):
        raw = kv[k]
        low = k.lower()
        show = k in interesting or any(t in low for t in ['function','device','serial','mac','name','ai_','version','addr','fw','firmware'])
        if show:
            bv = as_bytes_value(raw)
            hexs = bv.hex()
            printable = bv.decode('utf-8','replace') if all(32<=c<127 or c in (0,) for c in bv[:1]) else ''
            print(f"\n[{k}] rawlen={len(raw)} innerlen={len(bv)}")
            print("  hex:", hexs[:400])
            # try text
            txt = bv.decode('utf-8','ignore')
            if sum(1 for c in txt if c.isprintable()) > len(txt)*0.6 and len(txt)>1:
                print("  text:", txt[:300])

    # Always dump function_bytes bit analysis if present
    if 'function_bytes' in kv:
        bv = as_bytes_value(kv['function_bytes'])
        print("\n==== function_bytes BIT ANALYSIS ====")
        print("bytes(hex):", bv.hex())
        print("len:", len(bv), "=>", len(bv)*8, "bits")
        set_bits = [b for b in range(len(bv)*8) if (bv[b//8] >> (b%8)) & 1]
        print("bits SET (1):", set_bits)
