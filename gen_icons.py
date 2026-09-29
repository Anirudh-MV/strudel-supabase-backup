#!/usr/bin/env python3
"""Generate the extension icons (16/48/128 PNG) from scratch, stdlib only.

Design: a two-arc "sync" cycle over a deep indigo gradient, with a green
focal dot. Represents session history rotating through versions.

Everything renders at 4x and box-downsamples, so edges are genuinely
anti-aliased rather than stair-stepped (the previous record motif was not).
Fully opaque - the Chrome Web Store renders 128x128 with its own masking,
and a transparent icon shows up as a dark square on light surfaces.
"""
import math
import os
import struct
import zlib

SS = 4  # supersample factor


def lerp(a, b, t):
    return a + (b - a) * t


def rounded_box_sd(px, py, cx, cy, half, r):
    """Signed distance to a rounded square, negative inside."""
    qx = abs(px - cx) - (half - r)
    qy = abs(py - cy) - (half - r)
    ax, ay = max(qx, 0.0), max(qy, 0.0)
    return math.hypot(ax, ay) + min(max(qx, qy), 0.0) - r


def in_triangle(px, py, a, b, c):
    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])

    d1 = sign((px, py), a, b)
    d2 = sign((px, py), b, c)
    d3 = sign((px, py), c, a)
    neg = (d1 < 0) or (d1 == 0)
    pos = (d1 > 0) or (d1 == 0)
    d1b, d2b, d3b = d2 < 0, d3 < 0, d3 > 0
    return not ((neg and d2b and d3b) or (pos and d2b == 0 and False))


def tri(px, py, a, b, c):
    """Point-in-triangle, inclusive."""
    def s(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])

    d1 = s((px, py), a, b)
    d2 = s((px, py), b, c)
    d3 = s((px, py), c, a)
    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (has_neg and has_pos)


# --- palette -------------------------------------------------------------
BG_TOP = (14, 16, 34)
BG_BOT = (30, 41, 66)
ARC = (233, 240, 250)
ACCENT = (72, 200, 140)


def render(size):
    """Return RGBA bytes for one icon at `size`, rendered at size*SS."""
    n = size * SS
    cx = cy = n / 2.0
    u = n / 128.0  # design units -> supersampled pixels

    R = 30.0 * u          # sync ring radius
    HW = 6.2 * u          # half stroke width
    DOT = 9.0 * u         # centre dot radius
    HEAD = 11.0 * u       # arrowhead length
    HWID = 9.0 * u        # arrowhead half width

    # two arcs with a gap on each side
    arcs = [(40.0, 170.0), (220.0, 350.0)]

    # Arrowhead at the leading end of each arc. Apex lies along the direction of
    # travel (clockwise => decreasing theta), base straddles the ring radially, so
    # the head sits ON the arc end rather than floating beside it.
    heads = []
    for _, end in arcs:
        t = math.radians(end)
        cos_t, sin_t = math.cos(t), math.sin(t)
        bx, by = cx + cos_t * R, cy + sin_t * R
        tx, ty = sin_t, -cos_t              # clockwise tangent
        nx, ny = cos_t, sin_t               # radial
        apex = (bx + tx * HEAD, by + ty * HEAD)
        p1 = (bx + nx * HWID, by + ny * HWID)
        p2 = (bx - nx * HWID, by - ny * HWID)
        heads.append((apex, p1, p2))

    buf = bytearray()
    for y in range(n):
        buf.append(0)  # PNG filter type 0
        t = y / (n - 1)
        bg = (
            int(lerp(BG_TOP[0], BG_BOT[0], t)),
            int(lerp(BG_TOP[1], BG_BOT[1], t)),
            int(lerp(BG_TOP[2], BG_BOT[2], t)),
        )
        for x in range(n):
            px, py = x + 0.5, y + 0.5
            col = bg

            # subtle inner top highlight for depth
            hi = rounded_box_sd(px, py, cx, cy - 2.0 * u, 62.0 * u, 16.0 * u)
            if hi < 0:
                k = 0.10
                col = tuple(min(255, int(c + (255 - c) * k)) for c in col)

            dx, dy = px - cx, py - cy
            d = math.hypot(dx, dy)
            ang = (math.degrees(math.atan2(dy, dx)) + 360.0) % 360.0

            on_arc = abs(d - R) <= HW
            for a0, a1 in arcs:
                lo, hi2 = (a0, a1) if a0 < a1 else (a0, a1 + 360.0)
                if on_arc and lo <= ang <= hi2:
                    col = ARC
                    break

            for (apex, p1, p2) in heads:
                if tri(px, py, apex, p1, p2):
                    col = ACCENT
                    break

            if d <= DOT:
                col = ACCENT

            buf += bytes((col[0], col[1], col[2], 255))

    # box-downsample SS x SS
    out = bytearray()
    for y in range(size):
        for x in range(size):
            r = g = b = 0
            for dy in range(SS):
                base = (y * SS + dy) * (n * 4 + 1) + 1
                for dx in range(SS):
                    o = base + (x * SS + dx) * 4
                    r += buf[o]
                    g += buf[o + 1]
                    b += buf[o + 2]
            k = SS * SS
            out += bytes((r // k, g // k, b // k, 255))
    return bytes(out)


def write_png(path, size, rgba):
    rows = b"".join(b"\x00" + rgba[y * size * 4:(y + 1) * size * 4] for y in range(size))

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    blob = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(rows, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(blob)
    print(f"wrote {path}  {size}x{size}  {os.path.getsize(path)} bytes")


if __name__ == "__main__":
    os.makedirs("icons", exist_ok=True)
    for s in (16, 48, 128):
        write_png(f"icons/icon{s}.png", s, render(s))
