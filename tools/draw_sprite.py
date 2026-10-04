#!/usr/bin/env python3
"""Generate the 4x4 hydraulic-pump pixel art using only the Python standard library."""

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
        """Fill a polygon at pixel centers; crisp edges suit the game sprite."""
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

    def circle(self, center_x, center_y, radius, color):
        radius_squared = radius * radius
        for py in range(max(0, center_y - radius), min(self.height, center_y + radius + 1)):
            for px in range(max(0, center_x - radius), min(self.width, center_x + radius + 1)):
                if (px - center_x) ** 2 + (py - center_y) ** 2 <= radius_squared:
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
    rect, poly, circle = c.rect, c.polygon, c.circle

    dark = rgb("#111920")
    outline = rgb("#1b2730")
    frame = rgb("#35434c")
    frame_mid = rgb("#52616a")
    steel = rgb("#687880")
    steel_light = rgb("#89979b")
    steel_bright = rgb("#bac4c2")
    panel = rgb("#293740")
    panel_light = rgb("#40515a")
    shadow = rgb("#0d151b")
    water_dark = rgb("#104d65")
    water = rgb("#168eae")
    water_light = rgb("#41d2df")
    water_glint = rgb("#b1fff0")
    amber = rgb("#e6a94d")

    # Opaque, edge-to-edge base plate: the complete 32x32 sprite is occupied,
    # so its 128x128 export covers all sixteen tiles of the 4x4 footprint.
    rect(0, 0, 32, 32, dark)
    rect(1, 1, 30, 30, outline)
    rect(2, 2, 28, 28, frame)
    rect(3, 3, 26, 26, panel)
    rect(4, 4, 24, 24, panel_light)
    rect(5, 5, 22, 22, panel)

    # Thick cast-metal rails and shallow machining grooves around the housing.
    rect(1, 1, 30, 2, steel)
    rect(1, 1, 2, 30, frame_mid)
    rect(2, 3, 28, 1, steel_light)
    rect(3, 2, 1, 28, steel)
    rect(29, 4, 2, 26, shadow)
    rect(4, 29, 26, 2, shadow)
    rect(5, 5, 22, 1, steel_light)
    rect(5, 26, 22, 1, outline)
    rect(5, 6, 1, 20, frame_mid)
    rect(26, 6, 1, 20, shadow)

    # Four deep hydraulic galleries run from the edge fittings into the pump.
    # Their bright blue cores remain visible between the flange and impeller.
    rect(12, 0, 8, 15, outline)
    rect(13, 0, 6, 14, steel)
    rect(15, 0, 2, 14, water_dark)
    rect(15, 1, 2, 12, water)
    rect(12, 17, 8, 15, outline)
    rect(13, 18, 6, 14, steel)
    rect(15, 18, 2, 13, water_dark)
    rect(15, 19, 2, 11, water)

    rect(0, 12, 15, 8, outline)
    rect(0, 13, 14, 6, steel)
    rect(0, 15, 14, 2, water_dark)
    rect(1, 15, 12, 2, water)
    rect(17, 12, 15, 8, outline)
    rect(18, 13, 14, 6, steel)
    rect(18, 15, 13, 2, water_dark)
    rect(19, 15, 11, 2, water)

    # Machined end flanges on the four ports, with visible bolts and lips.
    for x, y, horizontal in ((10, 2, True), (10, 24, True), (2, 10, False), (24, 10, False)):
        if horizontal:
            rect(x, y, 12, 6, outline)
            rect(x + 1, y + 1, 10, 4, steel)
            rect(x + 2, y + 1, 8, 1, steel_light)
            rect(x + 3, y + 2, 6, 2, water_dark)
            rect(x + 5, y + 2, 2, 2, water_light)
            rect(x + 1, y + 2, 1, 2, dark)
            rect(x + 10, y + 2, 1, 2, dark)
            rect(x + 1, y + 2, 1, 1, steel_bright)
            rect(x + 10, y + 2, 1, 1, steel_bright)
        else:
            rect(x, y, 6, 12, outline)
            rect(x + 1, y + 1, 4, 10, steel)
            rect(x + 1, y + 2, 1, 8, steel_light)
            rect(x + 2, y + 3, 2, 6, water_dark)
            rect(x + 2, y + 5, 2, 2, water_light)
            rect(x + 2, y + 1, 2, 1, dark)
            rect(x + 2, y + 10, 2, 1, dark)
            rect(x + 2, y + 1, 1, 1, steel_bright)
            rect(x + 2, y + 10, 1, 1, steel_bright)

    # Reinforced corner lugs and bright bolt heads fill the mounting zones.
    for x, y in ((3, 3), (25, 3), (3, 25), (25, 25)):
        rect(x, y, 4, 4, dark)
        rect(x + 1, y + 1, 2, 2, steel)
        rect(x + 1, y + 1, 1, 1, steel_bright)
        rect(x + 2, y + 2, 1, 1, amber)

    # Central cast pump casing: stepped octagonal flange, machined in concentric layers.
    poly([(12, 5), (20, 5), (20, 6), (24, 6), (24, 8), (26, 8),
          (26, 12), (27, 12), (27, 20), (26, 20), (26, 24), (24, 24),
          (24, 26), (20, 26), (20, 27), (12, 27), (12, 26), (8, 26),
          (8, 24), (6, 24), (6, 20), (5, 20), (5, 12), (6, 12),
          (6, 8), (8, 8), (8, 6), (12, 6)], outline)
    poly([(12, 6), (20, 6), (20, 7), (23, 7), (23, 9), (25, 9),
          (25, 12), (26, 12), (26, 20), (25, 20), (25, 23), (23, 23),
          (23, 25), (20, 25), (20, 26), (12, 26), (12, 25), (9, 25),
          (9, 23), (7, 23), (7, 20), (6, 20), (6, 12), (7, 12),
          (7, 9), (9, 9), (9, 7), (12, 7)], frame_mid)
    poly([(12, 8), (20, 8), (20, 9), (22, 9), (22, 11), (24, 11),
          (24, 13), (25, 13), (25, 19), (24, 19), (24, 21), (22, 21),
          (22, 23), (20, 23), (20, 24), (12, 24), (12, 23), (10, 23),
          (10, 21), (8, 21), (8, 19), (7, 19), (7, 13), (8, 13),
          (8, 11), (10, 11), (10, 9), (12, 9)], steel)

    # Eight retaining teeth, pin heads and small inspection marks around the casing.
    for x, y in ((15, 7), (15, 24), (7, 15), (24, 15),
                 (10, 9), (21, 9), (10, 22), (21, 22)):
        rect(x, y, 2, 2, dark)
        rect(x, y, 1, 1, steel_bright)
    rect(11, 12, 1, 2, amber)
    rect(20, 18, 1, 2, amber)
    rect(12, 23, 2, 1, steel_light)
    rect(18, 8, 2, 1, steel_light)

    # Exposed blue pressure galleries meet the end flanges and feed the rotor chamber.
    # These are drawn over the cast housing, then tucked underneath the circular seal.
    rect(13, 5, 6, 10, outline)
    rect(14, 5, 4, 10, steel)
    rect(15, 5, 2, 9, water_dark)
    rect(15, 6, 2, 7, water)
    rect(13, 17, 6, 10, outline)
    rect(14, 17, 4, 10, steel)
    rect(15, 18, 2, 9, water_dark)
    rect(15, 19, 2, 7, water)
    rect(5, 13, 10, 6, outline)
    rect(5, 14, 10, 4, steel)
    rect(6, 15, 9, 2, water_dark)
    rect(7, 15, 7, 2, water)
    rect(17, 13, 10, 6, outline)
    rect(17, 14, 10, 4, steel)
    rect(17, 15, 9, 2, water_dark)
    rect(18, 15, 7, 2, water)

    # Wet chamber and seal: the animated impeller sits over this blue recessed bowl.
    circle(16, 16, 8, dark)
    circle(16, 16, 7, steel_light)
    circle(16, 16, 6, water_dark)
    circle(16, 16, 5, water)
    rect(13, 12, 3, 1, water_light)
    rect(12, 13, 1, 2, water_light)
    rect(19, 18, 2, 1, water_glint)
    rect(18, 19, 1, 1, water_glint)

    # Radial transfer arrows stamped into the manifold around the chamber.
    poly([(15, 7), (17, 7), (16, 9)], water_glint)
    poly([(24, 15), (24, 17), (22, 16)], water_glint)
    poly([(15, 24), (17, 24), (16, 22)], water_glint)
    poly([(7, 15), (7, 17), (9, 16)], water_glint)

    # Bright seal tabs and machining marks keep the four-tile footprint visually full.
    rect(8, 8, 2, 1, steel_bright)
    rect(22, 8, 2, 1, steel_bright)
    rect(8, 23, 2, 1, steel_bright)
    rect(22, 23, 2, 1, steel_bright)
    rect(5, 12, 1, 2, amber)
    rect(26, 18, 1, 2, amber)
    rect(12, 5, 2, 1, steel_bright)
    rect(18, 26, 2, 1, steel_bright)

    return c


def draw_rotor(canvas):
    """Draw a curved, three-vane hydraulic impeller for the rotating overlay."""
    poly = canvas.polygon
    rect = canvas.rect
    circle = canvas.circle
    dark = rgb("#101920")
    steel = rgb("#708087")
    steel_light = rgb("#b6c2c0")
    water = rgb("#35c8d9")
    water_glint = rgb("#c1fff2")

    # Broad swept vanes. Dark undercuts make the silver blades readable over the water.
    poly([(15, 16), (11, 13), (10, 10), (12, 8), (15, 9), (17, 12), (17, 15)], dark)
    poly([(15, 15), (12, 12), (12, 10), (14, 10), (16, 12), (17, 14)], steel)
    poly([(16, 15), (19, 11), (22, 10), (24, 12), (23, 15), (20, 17), (17, 17)], dark)
    poly([(17, 15), (20, 12), (22, 12), (22, 14), (20, 16), (17, 17)], steel)
    poly([(16, 16), (18, 20), (17, 23), (14, 24), (12, 22), (13, 19), (15, 17)], dark)
    poly([(16, 17), (17, 20), (16, 22), (14, 21), (14, 19), (15, 17)], steel)

    # Polished edges and cyan tips imply motion and show the direction of water flow.
    rect(12, 9, 2, 1, steel_light)
    rect(21, 12, 2, 1, steel_light)
    rect(14, 22, 2, 1, steel_light)
    rect(13, 9, 2, 1, water)
    rect(22, 12, 1, 2, water)
    rect(14, 21, 2, 1, water)
    rect(14, 9, 1, 1, water_glint)
    rect(22, 13, 1, 1, water_glint)
    rect(15, 21, 1, 1, water_glint)

    # Central shaft, seal and locking nut.
    circle(16, 16, 3, dark)
    circle(16, 16, 2, steel_light)
    rect(15, 15, 3, 3, steel)
    rect(16, 16, 1, 1, water_glint)


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
    # Mindustry uses 32 sprite pixels per tile: 4x4 tiles = a 128px sprite.
    base.png(sprite_path, scale=4)
    rotor.png(rotor_path, scale=4)
    draw_rotor(base)
    base.png(ROOT / "icon.png", scale=2)
    print(f"Generated {sprite_path.relative_to(ROOT)}, {rotor_path.relative_to(ROOT)} and icon.png")
