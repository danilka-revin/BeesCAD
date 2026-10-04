#!/usr/bin/env python3
"""Generate the mod's pixel-art well sprite using only the Python standard library."""

from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
SIZE = 32
TRANSPARENT = (0, 0, 0, 0)

class Canvas:
    def __init__(self, width, height):
        self.width = width
        self.height = height
        self.pixels = [[TRANSPARENT for _ in range(width)] for _ in range(height)]

    def rect(self, x, y, width, height, color):
        for py in range(max(0, y), min(self.height, y + height)):
            for px in range(max(0, x), min(self.width, x + width)):
                self.pixels[py][px] = color

    def polygon(self, points, color):
        """Fill a polygon at pixel centers; crisp, aliased edges suit the game sprite."""
        min_y = max(0, min(y for _, y in points))
        max_y = min(self.height - 1, max(y for _, y in points))
        for py in range(min_y, max_y + 1):
            scan_y = py + 0.5
            intersections = []
            for index, (x1, y1) in enumerate(points):
                x2, y2 = points[(index + 1) % len(points)]
                if (y1 <= scan_y < y2) or (y2 <= scan_y < y1):
                    intersections.append(x1 + (scan_y - y1) * (x2 - x1) / (y2 - y1))
            intersections.sort()
            for left, right in zip(intersections[0::2], intersections[1::2]):
                start = max(0, int(left + 0.5))
                end = min(self.width, int(right + 0.5))
                for px in range(start, end):
                    self.pixels[py][px] = color

    def png(self, path, scale=1):
        width, height = self.width * scale, self.height * scale
        scanlines = bytearray()
        for row in self.pixels:
            expanded = [pixel for pixel in row for _ in range(scale)]
            encoded_row = bytes(channel for pixel in expanded for channel in pixel)
            for _ in range(scale):
                scanlines.append(0)  # PNG filter: None
                scanlines.extend(encoded_row)

        def chunk(kind, data):
            payload = kind + data
            return struct.pack(">I", len(data)) + payload + struct.pack(">I", zlib.crc32(payload) & 0xffffffff)

        data = bytearray(b"\x89PNG\r\n\x1a\n")
        data.extend(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
        data.extend(chunk(b"IDAT", zlib.compress(bytes(scanlines), 9)))
        data.extend(chunk(b"IEND", b""))
        Path(path).write_bytes(data)


def rgb(hex_color):
    value = hex_color.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def make_sprite():
    c = Canvas(SIZE, SIZE)
    rect, poly = c.rect, c.polygon

    dark = rgb("#151c23")
    outline = rgb("#202a32")
    body_dark = rgb("#26323b")
    steel = rgb("#596670")
    steel_light = rgb("#74818a")
    steel_mid = rgb("#89959a")
    inset = rgb("#38454f")
    shadow = rgb("#101c24")
    water_dark = rgb("#14617d")
    water = rgb("#42c5df")
    water_highlight = rgb("#b4f3ee")

    # Four pipes and their bright inner channels, all kept within the 4x4 sprite.
    rect(13, 0, 6, 7, outline); rect(14, 0, 4, 7, steel); rect(15, 0, 2, 7, rgb("#39a9c6"))
    rect(13, 25, 6, 7, outline); rect(14, 25, 4, 7, steel); rect(15, 25, 2, 7, rgb("#39a9c6"))
    rect(0, 13, 7, 6, outline); rect(0, 14, 7, 4, steel); rect(0, 15, 7, 2, rgb("#39a9c6"))
    rect(25, 13, 7, 6, outline); rect(25, 14, 7, 4, steel); rect(25, 15, 7, 2, rgb("#39a9c6"))

    # Heavy, chamfered casing and inset top plate.
    poly([(5, 3), (27, 3), (27, 5), (30, 5), (30, 27), (27, 27), (27, 29), (5, 29), (5, 27), (2, 27), (2, 5), (5, 5)], dark)
    poly([(5, 1), (27, 1), (27, 3), (30, 3), (30, 25), (27, 25), (27, 28), (5, 28), (5, 25), (2, 25), (2, 3), (5, 3)], body_dark)
    poly([(5, 3), (27, 3), (27, 5), (30, 5), (30, 23), (27, 23), (27, 26), (5, 26), (5, 23), (2, 23), (2, 5), (5, 5)], steel)
    poly([(6, 4), (26, 4), (26, 6), (29, 6), (29, 22), (26, 22), (26, 25), (6, 25), (6, 22), (3, 22), (3, 6), (6, 6)], inset)
    rect(6, 4, 20, 2, steel_light)
    rect(4, 6, 2, 16, steel_light)
    rect(27, 8, 2, 15, outline)
    rect(6, 24, 20, 2, outline)

    # Corner mounting plates and metal bolts.
    for x, y in ((6, 7), (22, 7), (6, 21), (22, 21)):
        rect(x, y, 4, 4, outline)
        rect(x + 1, y + 1, 2, 2, steel_mid)
        rect(x + 1, y + 1, 1, 1, rgb("#e0e3df"))

    # Octagonal collar around the well.
    poly([(12, 6), (20, 6), (20, 8), (23, 8), (23, 11), (25, 11), (25, 21), (23, 21), (23, 24), (20, 24), (20, 26), (12, 26), (12, 24), (9, 24), (9, 21), (7, 21), (7, 11), (9, 11), (9, 8), (12, 8)], shadow)
    poly([(12, 8), (20, 8), (20, 10), (23, 10), (23, 13), (25, 13), (25, 19), (23, 19), (23, 22), (20, 22), (20, 24), (12, 24), (12, 22), (9, 22), (9, 19), (7, 19), (7, 13), (9, 13), (9, 10), (12, 10)], steel_mid)
    poly([(12, 9), (20, 9), (20, 11), (23, 11), (23, 14), (24, 14), (24, 18), (23, 18), (23, 21), (20, 21), (20, 23), (12, 23), (12, 21), (9, 21), (9, 18), (8, 18), (8, 14), (9, 14), (9, 11), (12, 11)], inset)
    poly([(13, 11), (19, 11), (19, 12), (21, 12), (21, 13), (22, 13), (22, 19), (21, 19), (21, 20), (19, 20), (19, 21), (13, 21), (13, 20), (11, 20), (11, 19), (10, 19), (10, 13), (11, 13), (11, 12), (13, 12)], shadow)

    # Blue water surface and a small pixel-art reflection.
    poly([(13, 13), (19, 13), (19, 14), (21, 14), (21, 18), (19, 18), (19, 19), (13, 19), (13, 18), (11, 18), (11, 14), (13, 14)], water_dark)
    poly([(13, 14), (16, 14), (16, 15), (18, 15), (18, 16), (21, 16), (21, 17), (19, 17), (19, 18), (16, 18), (16, 17), (14, 17), (14, 16), (12, 16), (12, 15), (13, 15)], water)
    rect(14, 14, 2, 1, water_highlight)
    rect(19, 17, 2, 1, water_highlight)
    rect(12, 12, 2, 1, rgb("#bdc8c8"))
    rect(18, 11, 2, 1, rgb("#bdc8c8"))

    # Bright lips on the four output ports.
    rect(14, 3, 4, 1, rgb("#a5b0b2")); rect(14, 28, 4, 1, rgb("#a5b0b2"))
    rect(3, 14, 1, 4, rgb("#a5b0b2")); rect(28, 14, 1, 4, rgb("#a5b0b2"))

    return c


def draw_rotor(canvas):
    """Add a small, asymmetric three-blade impeller to a sprite canvas."""
    poly = canvas.polygon
    dark = rgb("#17212a")
    steel = rgb("#72818a")
    steel_light = rgb("#b0bdbe")
    cyan = rgb("#39a9c6")

    # Three unequal paddles make the rotation visibly readable in motion.
    poly([(14, 16), (12, 13), (12, 11), (14, 9), (17, 10), (18, 12), (17, 16)], dark)
    poly([(14, 15), (13, 12), (14, 10), (16, 11), (17, 13), (16, 15)], steel)
    poly([(15, 16), (13, 15), (11, 16), (9, 18), (10, 21), (13, 21), (16, 18)], dark)
    poly([(15, 16), (13, 16), (11, 17), (10, 19), (11, 20), (13, 19), (16, 18)], steel)
    poly([(16, 15), (18, 13), (20, 12), (23, 13), (24, 16), (22, 18), (18, 18)], dark)
    poly([(17, 15), (19, 14), (21, 13), (23, 14), (22, 16), (20, 17), (18, 17)], steel)

    # Reflective blade edges and colored tips echo Mindustry's industrial palette.
    canvas.rect(14, 10, 2, 1, steel_light)
    canvas.rect(10, 18, 1, 2, steel_light)
    canvas.rect(22, 14, 2, 1, steel_light)
    canvas.rect(15, 10, 2, 1, cyan)
    canvas.rect(10, 19, 2, 1, cyan)
    canvas.rect(22, 15, 2, 1, cyan)

    # Central axle, drawn last so the paddles appear mounted beneath it.
    canvas.rect(13, 13, 7, 7, dark)
    canvas.rect(14, 14, 5, 5, steel)
    canvas.rect(15, 15, 3, 3, steel_light)
    canvas.rect(16, 16, 1, 1, cyan)


def make_rotor():
    canvas = Canvas(SIZE, SIZE)
    draw_rotor(canvas)
    return canvas


if __name__ == "__main__":
    base = make_sprite()
    rotor = make_rotor()
    sprite_path = ROOT / "sprites/blocks/water-well.png"
    rotor_path = ROOT / "sprites/blocks/water-well-rotor.png"
    sprite_path.parent.mkdir(parents=True, exist_ok=True)
    # Mindustry uses 32 sprite pixels per tile, so a 4x4 building needs 128px.
    base.png(sprite_path, scale=4)
    rotor.png(rotor_path, scale=4)
    draw_rotor(base)
    base.png(ROOT / "icon.png", scale=2)
    print(f"Generated {sprite_path.relative_to(ROOT)}, {rotor_path.relative_to(ROOT)} and icon.png")
