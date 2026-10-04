#!/usr/bin/env python3
"""Stretch the vanilla Mindustry Water Extractor art to the 5x5 well.

The source layers are the official v146 Water Extractor sprites (2x2): the
base, its spinning four-part rotator, and the top plate. They are enlarged with
nearest-neighbor sampling to keep Mindustry's pixel-art style crisp.

Upstream source: Anuken/Mindustry, core/assets-raw/sprites/blocks/drills/
water-extractor{,-rotator,-top}.png (tag v146).
"""

from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "tools" / "assets"
SOURCE_BASE = ASSET_DIR / "vanilla-water-extractor.png"
SOURCE_ROTATOR = ASSET_DIR / "vanilla-water-extractor-rotator.png"
SOURCE_TOP = ASSET_DIR / "vanilla-water-extractor-top.png"
BLOCK_SIZE = 5
PIXELS_PER_TILE = 32
OUTPUT_SIZE = BLOCK_SIZE * PIXELS_PER_TILE
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def paeth(left, above, upper_left):
    estimate = left + above - upper_left
    left_distance = abs(estimate - left)
    above_distance = abs(estimate - above)
    upper_left_distance = abs(estimate - upper_left)
    if left_distance <= above_distance and left_distance <= upper_left_distance:
        return left
    if above_distance <= upper_left_distance:
        return above
    return upper_left


def read_rgba_png(path):
    """Decode a non-interlaced 8-bit RGBA PNG using only the standard library."""
    data = Path(path).read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError(f"Not a PNG file: {path}")

    offset = len(PNG_SIGNATURE)
    compressed = bytearray()
    width = height = bit_depth = color_type = interlace = None
    while offset < len(data):
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        chunk = data[offset + 8:offset + 8 + length]
        offset += length + 12
        if kind == b"IHDR":
            width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(
                ">IIBBBBB", chunk
            )
            if compression != 0 or filtering != 0:
                raise ValueError(f"Unsupported PNG encoding in {path}")
        elif kind == b"IDAT":
            compressed.extend(chunk)
        elif kind == b"IEND":
            break

    if bit_depth != 8 or color_type != 6 or interlace != 0:
        raise ValueError(f"Expected non-interlaced 8-bit RGBA PNG: {path}")

    stride = width * 4
    raw = zlib.decompress(compressed)
    pixels = bytearray(width * height * 4)
    previous = bytearray(stride)
    source_offset = 0

    for y in range(height):
        filter_type = raw[source_offset]
        source_offset += 1
        source_row = raw[source_offset:source_offset + stride]
        source_offset += stride
        row = bytearray(stride)

        for index, value in enumerate(source_row):
            left = row[index - 4] if index >= 4 else 0
            above = previous[index]
            upper_left = previous[index - 4] if index >= 4 else 0

            if filter_type == 0:
                predictor = 0
            elif filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = above
            elif filter_type == 3:
                predictor = (left + above) // 2
            elif filter_type == 4:
                predictor = paeth(left, above, upper_left)
            else:
                raise ValueError(f"Unknown PNG filter {filter_type} in {path}")

            row[index] = (value + predictor) & 0xFF

        start = y * stride
        pixels[start:start + stride] = row
        previous = row

    return width, height, pixels


def scale_nearest(width, height, pixels, out_width, out_height):
    """Resize RGBA pixels without blur; useful for crisp game sprites."""
    output = bytearray(out_width * out_height * 4)
    for y in range(out_height):
        source_y = min(height - 1, y * height // out_height)
        for x in range(out_width):
            source_x = min(width - 1, x * width // out_width)
            source_index = (source_y * width + source_x) * 4
            target_index = (y * out_width + x) * 4
            output[target_index:target_index + 4] = pixels[source_index:source_index + 4]
    return output


def composite(base, overlay):
    """Alpha-composite one same-sized RGBA image over another."""
    output = bytearray(base)
    for index in range(0, len(output), 4):
        source_alpha = overlay[index + 3]
        if source_alpha == 0:
            continue
        if source_alpha == 255:
            output[index:index + 4] = overlay[index:index + 4]
            continue

        destination_alpha = output[index + 3]
        inverse_alpha = 255 - source_alpha
        result_alpha = source_alpha + destination_alpha * inverse_alpha / 255
        if result_alpha <= 0:
            continue
        for channel in range(3):
            source_value = overlay[index + channel]
            destination_value = output[index + channel]
            value = (
                source_value * source_alpha
                + destination_value * destination_alpha * inverse_alpha / 255
            ) / result_alpha
            output[index + channel] = max(0, min(255, int(value + 0.5)))
        output[index + 3] = max(0, min(255, int(result_alpha + 0.5)))
    return output


def png_chunk(kind, payload):
    data = kind + payload
    return struct.pack(">I", len(payload)) + data + struct.pack(">I", zlib.crc32(data) & 0xFFFFFFFF)


def write_rgba_png(path, width, height, pixels):
    """Write 8-bit RGBA PNG with unfiltered scanlines."""
    scanlines = bytearray()
    stride = width * 4
    for y in range(height):
        scanlines.append(0)
        start = y * stride
        scanlines.extend(pixels[start:start + stride])

    data = bytearray(PNG_SIGNATURE)
    data.extend(png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
    data.extend(png_chunk(b"IDAT", zlib.compress(bytes(scanlines), 9)))
    data.extend(png_chunk(b"IEND", b""))
    Path(path).write_bytes(data)


def main():
    sources = [read_rgba_png(path) for path in (SOURCE_BASE, SOURCE_ROTATOR, SOURCE_TOP)]
    if len({(width, height) for width, height, _ in sources}) != 1:
        raise SystemExit("Vanilla Water Extractor sprite layers must have matching dimensions")

    source_width, source_height, base = sources[0]
    if source_width != 64 or source_height != 64:
        raise SystemExit(f"Expected 64x64 vanilla 2x2 sprites, got {source_width}x{source_height}")

    outputs = []
    for _, _, layer in sources:
        outputs.append(scale_nearest(source_width, source_height, layer, OUTPUT_SIZE, OUTPUT_SIZE))

    sprite_dir = ROOT / "sprites" / "blocks"
    sprite_dir.mkdir(parents=True, exist_ok=True)
    write_rgba_png(sprite_dir / "water-well.png", OUTPUT_SIZE, OUTPUT_SIZE, outputs[0])
    write_rgba_png(sprite_dir / "water-well-rotator.png", OUTPUT_SIZE, OUTPUT_SIZE, outputs[1])
    write_rgba_png(sprite_dir / "water-well-top.png", OUTPUT_SIZE, OUTPUT_SIZE, outputs[2])

    icon = composite(composite(base, sources[1][2]), sources[2][2])
    write_rgba_png(ROOT / "icon.png", source_width, source_height, icon)
    print(
        f"Generated 5x5 Water Extractor sprite layers ({OUTPUT_SIZE}x{OUTPUT_SIZE}) "
        "and a 64x64 composite icon"
    )


if __name__ == "__main__":
    main()
