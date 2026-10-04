#!/usr/bin/env python3
"""Build the mod's block sprites from the original Mindustry artwork.

Sources are the vanilla layers (Anuken/Mindustry, GPL-3.0, tag v146):

    core/assets-raw/sprites/blocks/drills/water-extractor{,-rotator,-top}.png
    core/assets-raw/sprites/blocks/defense/overdrive-dome{,-top}.png

They are copied into ``tools/assets`` and enlarged to the mod blocks' size --
5x5 tiles for the well, 4x4 for the mega dome -- with a bicubic (Catmull-Rom)
filter over premultiplied alpha instead of nearest-neighbour pixel doubling.
That keeps the vanilla shapes but gives smooth, anti-aliased contours instead
of stair-stepped "pixel" edges, even though the sprite is still 32 px per tile.

While resampling, the flat vanilla palette is remapped to the mod's darker one:
the well's greys go down to ~72 % brightness (its water-blue rings stay vivid),
the dome's greys too and its warm glow is dimmed as well.

Run without arguments to regenerate every sprite in ``sprites/blocks`` and the
mod icon; pass ``--preview DIR`` to also write large preview copies.
"""

from pathlib import Path
import math
import sys

from pngio import composite, empty, read_rgba_png, write_rgba_png

ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "tools" / "assets"
SPRITE_DIR = ROOT / "sprites" / "blocks"
PIXELS_PER_TILE = 32

WELL_TILES = 5
DOME_TILES = 4


# ------------------------------- палитры -----------------------------------
# Индексы — цвета оригинальных спрайтов Mindustry, значения — цвета мода.

WELL_PALETTE = {
    # серый корпус: темнее на ~28 %
    (74, 75, 83, 255): (53, 54, 60, 255),
    (110, 112, 128, 255): (79, 81, 92, 255),
    (152, 154, 164, 255): (109, 111, 118, 255),
    (176, 186, 192, 255): (127, 134, 138, 255),
    # синие кольца: чуть глубже, но по-прежнему яркие
    (136, 164, 255, 255): (120, 144, 224, 255),
    (87, 87, 193, 255): (77, 77, 170, 255),
}

DOME_PALETTE = {
    # те же серые, что и у скважины
    (74, 75, 83, 255): (53, 54, 60, 255),
    (110, 112, 128, 255): (79, 81, 92, 255),
    (152, 154, 164, 255): (109, 111, 118, 255),
    (176, 186, 192, 255): (127, 134, 138, 255),
    # оранжевое свечение и лучи: темнее на ~20 %
    (254, 179, 128, 255): (203, 143, 102, 255),
    (188, 84, 82, 255): (150, 67, 66, 255),
    (234, 136, 120, 255): (187, 109, 96, 255),
    (196, 95, 95, 255): (157, 76, 76, 255),
}

DOME_TOP_PALETTE = {
    # сам купол подсвечивается цветом из JSON, поэтому его спрайт темним,
    # чтобы свечение вышло спокойнее
    (255, 255, 255, 255): (214, 214, 214, 255),
    (255, 214, 184, 255): (214, 180, 155, 255),
}


# ------------------------------ фильтры ------------------------------------


def palette_swap(pixels, mapping):
    """Replace exact RGBA colours of flat pixel-art layers."""
    output = bytearray(pixels)
    for index in range(0, len(output), 4):
        key = (output[index], output[index + 1], output[index + 2], output[index + 3])
        replacement = mapping.get(key)
        if replacement is not None:
            output[index:index + 4] = bytes(replacement)
    return output


def _catmull_rom_weights(frac):
    frac2 = frac * frac
    frac3 = frac2 * frac
    return (
        -0.5 * frac3 + frac2 - 0.5 * frac,
        1.5 * frac3 - 2.5 * frac2 + 1.0,
        -1.5 * frac3 + 2.0 * frac2 + 0.5 * frac,
        0.5 * frac3 - 0.5 * frac2,
    )


def _clamp_byte(value):
    if value <= 0.0:
        return 0
    if value >= 255.0:
        return 255
    return int(value + 0.5)


def resample_bicubic(width, height, pixels, out_width, out_height):
    """Catmull-Rom resample of RGBA pixels, alpha-weighted to avoid halos.

    Both passes work on premultiplied colours, so fully transparent pixels
    never bleed into the visible edges.
    """
    if (width, height) == (out_width, out_height):
        return bytearray(pixels)

    # horizontal pass -> out_width x height, floats
    horizontal = [0.0] * (out_width * height * 4)
    x_ratio = width / out_width
    for y in range(height):
        row = y * width * 4
        for x in range(out_width):
            position = (x + 0.5) * x_ratio - 0.5
            base = math.floor(position)
            weights = _catmull_rom_weights(position - base)

            red = green = blue = alpha = 0.0
            for tap in range(4):
                source_x = min(width - 1, max(0, base - 1 + tap))
                index = row + source_x * 4
                weight = weights[tap]
                if weight == 0.0:
                    continue
                pixel_alpha = pixels[index + 3] / 255.0
                red += pixels[index] * pixel_alpha * weight
                green += pixels[index + 1] * pixel_alpha * weight
                blue += pixels[index + 2] * pixel_alpha * weight
                alpha += pixels[index + 3] * weight

            target = (y * out_width + x) * 4
            horizontal[target] = red
            horizontal[target + 1] = green
            horizontal[target + 2] = blue
            horizontal[target + 3] = alpha

    # vertical pass -> out_width x out_height
    output = empty(out_width, out_height)
    y_ratio = height / out_height
    for y in range(out_height):
        position = (y + 0.5) * y_ratio - 0.5
        base = math.floor(position)
        weights = _catmull_rom_weights(position - base)
        taps = [min(height - 1, max(0, base - 1 + tap)) for tap in range(4)]

        for x in range(out_width):
            red = green = blue = alpha = 0.0
            for tap in range(4):
                weight = weights[tap]
                if weight == 0.0:
                    continue
                index = (taps[tap] * out_width + x) * 4
                red += horizontal[index] * weight
                green += horizontal[index + 1] * weight
                blue += horizontal[index + 2] * weight
                alpha += horizontal[index + 3] * weight

            alpha = max(0.0, min(255.0, alpha))
            target = (y * out_width + x) * 4
            if alpha <= 0.5:
                continue
            scale = 255.0 / alpha
            output[target] = _clamp_byte(red * scale)
            output[target + 1] = _clamp_byte(green * scale)
            output[target + 2] = _clamp_byte(blue * scale)
            output[target + 3] = int(alpha + 0.5)
    return output


def smooth_layer(source_path, out_size, palette):
    """Load a flat vanilla layer, recolour it and enlarge it smoothly."""
    width, height, pixels = read_rgba_png(source_path)
    recoloured = palette_swap(pixels, palette)
    return resample_bicubic(width, height, recoloured, out_size, out_size)


# ------------------------------- сборка ------------------------------------


def build_block(name, layers):
    """Write one block: ``layers`` holds (sprite suffix, source file, size, palette).

    @return словарь: суффикс спрайта -> (размер стороны, пиксели).
    """
    outputs = {}
    for suffix, source_name, out_size, palette in layers:
        source = ASSET_DIR / source_name
        pixels = smooth_layer(source, out_size, palette)
        write_rgba_png(SPRITE_DIR / f"{name}{suffix}.png", out_size, out_size, pixels)
        outputs[suffix] = (out_size, pixels)
    return outputs


def composite_layers(outputs, order):
    """Flatten the layers of a block into one image, bottom layer first."""
    width = outputs[order[0]][0]
    image = empty(width, width)
    for suffix in order:
        image = composite(image, outputs[suffix][1])
    return image


def build_icon(outputs, size):
    """Composite the block's layers into the mod icon."""
    icon = composite_layers(outputs, list(outputs))
    if size == outputs[""][0]:
        return icon
    return resample_bicubic(size, size, icon, size, size)


def build_readme_preview(well, dome):
    """Картинка для README: скважина и купол на сетке клеток 32 пикселя.

    ``well`` — готовое изображение скважины, ``dome`` — словарь с полями
    ``base`` и ``top`` (слои купола) и ``size``, чтобы подсветить купол его
    цветом свечения.
    """
    gap = 24
    pad = 16
    size = int((len(well) // 4) ** 0.5)
    dome_size = dome["size"]
    width = pad * 2 + size + gap + dome_size
    height = pad * 2 + size

    canvas = empty(width, height)
    for index in range(0, len(canvas), 4):
        canvas[index] = canvas[index + 1] = canvas[index + 2] = 46
        canvas[index + 3] = 255

    def grid(left, top, size):
        for x in range(left, left + size + 1, PIXELS_PER_TILE):
            for y in range(top, top + size):
                index = (y * width + x) * 4
                for channel in range(3):
                    canvas[index + channel] = min(255, canvas[index + channel] + 22)
        for y in range(top, top + size + 1, PIXELS_PER_TILE):
            for x in range(left, left + size):
                index = (y * width + x) * 4
                for channel in range(3):
                    canvas[index + channel] = min(255, canvas[index + channel] + 22)

    def paste(source, size, left, top):
        for y in range(size):
            for x in range(size):
                source_index = (y * size + x) * 4
                target_index = ((y + top) * width + x + left) * 4
                alpha = source[source_index + 3]
                if alpha == 0:
                    continue
                if alpha == 255:
                    canvas[target_index:target_index + 4] = source[source_index:source_index + 4]
                    continue
                source_alpha = alpha / 255
                target_alpha = canvas[target_index + 3] / 255
                result_alpha = source_alpha + target_alpha * (1 - source_alpha)
                for channel in range(3):
                    canvas[target_index + channel] = int(
                        (source[source_index + channel] * source_alpha
                         + canvas[target_index + channel] * target_alpha * (1 - source_alpha)) / result_alpha + 0.5
                    )
                canvas[target_index + 3] = int(result_alpha * 255 + 0.5)

    # купол на картинке показан «под нагрузкой»: верхний слой подсвечен baseColor
    tinted = bytearray(dome["top"])
    for index in range(0, len(tinted), 4):
        if tinted[index + 3] == 0:
            continue
        for channel, glow in enumerate((232, 173, 116)):
            tinted[index + channel] = min(255, int(tinted[index + channel] * 0.45 + glow * 0.55))
    glow_dome = composite(dome["base"], tinted)

    grid(pad, pad, size)
    grid(pad + size + gap, pad, dome_size)
    paste(well, size, pad, pad)
    paste(glow_dome, dome_size, pad + size + gap, pad)

    write_rgba_png(ROOT / "docs" / "preview.png", width, height, canvas)


def main():
    preview_dir = None
    if len(sys.argv) >= 3 and sys.argv[1] == "--preview":
        preview_dir = Path(sys.argv[2])

    well_size = WELL_TILES * PIXELS_PER_TILE
    dome_size = DOME_TILES * PIXELS_PER_TILE

    well = build_block("water-well", [
        ("", "vanilla-water-extractor.png", well_size, WELL_PALETTE),
        ("-rotator", "vanilla-water-extractor-rotator.png", well_size, WELL_PALETTE),
        ("-top", "vanilla-water-extractor-top.png", well_size, WELL_PALETTE),
    ])
    dome = build_block("mega-dome", [
        ("", "vanilla-overdrive-dome.png", dome_size, DOME_PALETTE),
        ("-top", "vanilla-overdrive-dome-top.png", dome_size, DOME_TOP_PALETTE),
    ])

    # Иконка мода — склеенные слои скважины, пиксель в пиксель (без уменьшения).
    icon_size = WELL_TILES * PIXELS_PER_TILE
    write_rgba_png(ROOT / "icon.png", icon_size, icon_size, build_icon(well, icon_size))

    # Картинка для README: скважина и купол на сетке клеток.
    build_readme_preview(
        composite_layers(well, ["", "-rotator", "-top"]),
        {"base": dome[""][1], "top": dome["-top"][1], "size": dome[""][0]},
    )

    if preview_dir is not None:
        preview_dir.mkdir(parents=True, exist_ok=True)
        for name, outputs in (("water-well", well), ("mega-dome", dome)):
            for index, (size, pixels) in enumerate(outputs):
                path = preview_dir / f"{name}-{index}.png"
                write_rgba_png(path, size, size, pixels)
            print(f"preview: {name} -> {preview_dir}")

    print(
        f"Generated {WELL_TILES}x{WELL_TILES} water well ({well_size}x{well_size}) "
        f"and {DOME_TILES}x{DOME_TILES} mega dome ({dome_size}x{dome_size}) sprites, "
        f"{icon_size}x{icon_size} icon"
    )


if __name__ == "__main__":
    main()
