#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate cute pink panda icons for the fnOS app (pure python, no deps)."""
import zlib, struct, os, math

def make_png(size, pixels):
    """pixels: list of rows, each row list of (r,g,b,a). Returns png bytes."""
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        c += struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
        return c
    raw = b""
    for row in pixels:
        raw += b"\x00"
        for (r, g, b, a) in row:
            raw += struct.pack("4B", r, g, b, a)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))

def draw_panda(size, bg="#FFB6C1", fg_ring="#FF69B4"):
    S = size / 256.0
    def c_hex(h):
        h = h.lstrip("#")
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    BG = c_hex(bg)
    RING = c_hex(fg_ring)
    WHITE = (255, 255, 255)
    BLACK = (44, 44, 46)
    BLUSH = (255, 174, 193)
    PINK = (255, 105, 180)
    NOSE = (60, 60, 62)

    def px(x, y):
        x, y = x / S, y / S  # canvas coords 0..256
        # rounded square background
        rad = 46.0
        cx = min(max(x, rad), 256 - rad)
        cy = min(max(y, rad), 256 - rad)
        d = math.hypot(x - cx, y - cy)
        if d <= rad:
            inside = True
        else:
            inside = False
        if not inside:
            return (0, 0, 0, 0)
        # pink ring
        ring = math.hypot(x - 128, y - 128)
        base = BG
        if 96 <= ring <= 104:
            base = RING
        # panda head
        hd = math.hypot(x - 128, y - 148)
        col = base
        if hd <= 66:
            col = WHITE
        # ears
        for (ex, ey, er) in ((78, 92, 26), (178, 92, 26)):
            if math.hypot(x - ex, y - ey) <= er:
                col = BLACK
        # eyes
        for (ex, ey, er, highlight) in ((100, 148, 13, True), (156, 148, 13, True)):
            if math.hypot(x - ex, y - ey) <= er:
                col = BLACK
                if highlight and math.hypot(x - (ex - 4), y - (ey - 4)) <= 4:
                    col = WHITE
        # nose
        if math.hypot(x - 128, y - 172) <= 9:
            col = NOSE
        # smile
        if abs(y - 184) <= 2.4 and 112 <= x <= 144 and y >= 180:
            col = (120, 70, 80)
        # blush
        for (bx, by, br) in ((76, 170, 11), (180, 170, 11)):
            if math.hypot(x - bx, y - by) <= br and hd <= 66:
                col = BLUSH
        # heart on chest-ish / cheek: small pink heart at bottom right of bg
        hx, hy = 128, 236
        if math.hypot(x - hx, y - hy) <= 12 and y >= hy:
            col = PINK
        return (col[0], col[1], col[2], 255)

    pixels = []
    for y in range(size):
        row = []
        for x in range(size):
            row.append(px(x + 0.5, y + 0.5))
        pixels.append(row)
    return make_png(size, pixels)

def main():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    www_icons = os.path.join(base, "app", "www", "icons")
    os.makedirs(www_icons, exist_ok=True)
    jobs = [
        (os.path.join(base, "ICON.PNG"), 64),
        (os.path.join(base, "ICON_256.PNG"), 256),
        (os.path.join(base, "app", "ui", "images", "icon_16.png"), 16),
        (os.path.join(base, "app", "ui", "images", "icon_24.png"), 24),
        (os.path.join(base, "app", "ui", "images", "icon_48.png"), 48),
        (os.path.join(base, "app", "ui", "images", "icon_64.png"), 64),
        (os.path.join(base, "app", "ui", "images", "icon_72.png"), 72),
        (os.path.join(base, "app", "ui", "images", "icon_96.png"), 96),
        (os.path.join(base, "app", "ui", "images", "icon_128.png"), 128),
        (os.path.join(base, "app", "ui", "images", "icon_256.png"), 256),
        # 字面文件名 icon_{0}.png（对齐官方应用，fnOS 可能直接按字面名取图标）
        (os.path.join(base, "app", "ui", "images", "icon_{0}.png"), 512),
        (os.path.join(www_icons, "icon-192.png"), 192),
        (os.path.join(www_icons, "icon-512.png"), 512),
        (os.path.join(www_icons, "apple-touch-icon.png"), 180),
        (os.path.join(www_icons, "favicon.png"), 64),
    ]
    for path, size in jobs:
        with open(path, "wb") as f:
            f.write(draw_panda(size))
        print("wrote", path, size)

if __name__ == "__main__":
    main()
