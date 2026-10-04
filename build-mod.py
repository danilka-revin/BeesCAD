#!/usr/bin/env python3
"""Package this content-only Mindustry mod as an importable ZIP."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "water-well-400.zip"
FILES = (
    "mod.hjson",
    "content/blocks/water-well.json",
    "sprites/blocks/water-well.png",
    "sprites/blocks/water-well-rotor.png",
    "icon.png",
)

with ZipFile(OUTPUT, "w", compression=ZIP_DEFLATED) as archive:
    for relative_path in FILES:
        path = ROOT / relative_path
        if not path.is_file():
            raise SystemExit(f"Missing mod file: {relative_path}")
        archive.write(path, arcname=relative_path)

print(f"Created {OUTPUT.name}")
