# Tools

Isolated Python (standard library only, except `get_firmware` which uses `urllib`). These reimplement
the JieLi container/flash crypto **from the spec we reverse-engineered** — they do not import any
third-party code. Run untrusted inputs with `python -I`.

| tool | what it does |
|----|----|
| `ufw_outer.py` | Parse a `.ufw` container: strip the Qix wrapper, decrypt the header + entry table, recompute `hdrcrc`/`listcrc` (prints whether they match). `python -I tools/ufw_outer.py file.ufw` |
| `jl_flash_decode.py` | Decrypt a flash image or a `flash.bin`: flash header + top JLFS (`jl_enc_cipher`, key 0xFFFF), app area (`jl_sfc_cipher`, keyed by the chipkey from `isd_config.ini`), validate every CRC, extract files. `--brute` recovers the chipkey by entropy. |
| `jl_ufw_repack.py` | Repack a flashable `.ufw`: `roundtrip` (lossless check), `patch` (edit bytes/strings in a JLFS file), `swapapp` (replace `app.bin`, pad to slot). Recomputes the full CRC chain (JLFS data+hcrc → flash.bin dcrc → listcrc/hdrcrc → Qix wrapper). |
| `get_firmware.py` | Download your unit's OEM firmware from the vendor OTA server (unauthenticated). See `--help`. |
| `e1_e87.py` | SAFER+/E1 authentication (the scheme our unit uses). |
| `targetinfo_decode.py` | Decode the RCSP GetTargetInfo (0x03) response (chip/project/battery TLVs). |
| `research/` | Unpolished scripts used while reversing (SAFER+ recovery, btsnoop/RCSP/MMKV parsers, media generators). Kept for the record, not maintained. |

### Typical flow

```sh
python -I tools/get_firmware.py --model 1552 --version 1.0.0          # -> QX7413_..._V11.1.0.2.bin
python -I tools/ufw_outer.py QX7413_..._V11.1.0.2.bin                 # chip, CRCs OK
python -E tools/jl_flash_decode.py <flash.bin> out/ --brute          # descifra + chipkey (necesita numpy para --brute)
python -I tools/jl_ufw_repack.py swapapp oem.ufw custom.ufw --app app.bin
```
