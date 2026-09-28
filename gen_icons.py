#!/usr/bin/env python3
"""Generate simple flat icons (record/vinyl motif) for the extension: 16/48/128 PNG."""
import struct, zlib, os

def png(path, size, bg, fg, accent):
    # RGBA rows, top-down; two circles (record + hole), a highlight arc
    rows = []
    cx = cy = size / 2.0
    r_out = size * 0.46
    r_in = size * 0.14
    for y in range(size):
        row = bytearray()
        for x in range(size):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            d = (dx * dx + dy * dy) ** 0.5
            if d <= r_out:
                col = fg
                if d <= r_in:
                    col = bg
                # accent groove highlights
                elif abs(d - r_out * 0.62) < 1.2:
                    col = accent
                elif abs(d - r_out * 0.85) < 1.0:
                    col = accent
            else:
                col = bg
            row += bytes(col)
        rows.append(bytes(row))
    raw = b''.join(b'\x00' + r for r in rows)  # filter type 0 per scanline
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    png_bytes = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
                 + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png_bytes)
    print('wrote', path, os.path.getsize(path), 'bytes')

os.makedirs('icons', exist_ok=True)
BG = (18, 18, 32, 255)
FG = (240, 240, 240, 255)
ACC = (72, 200, 140, 255)
for s in (16, 48, 128):
    png(f'icons/icon{s}.png', s, BG, FG, ACC)