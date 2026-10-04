#!/usr/bin/env python3
"""Package this Mindustry mod (content blocks + co-op scripts) as an importable ZIP.

The file list is built automatically: everything in ``content/``, ``sprites/``,
``bundles/`` and ``scripts/`` plus the icon and the mod metadata is packed with
the same relative paths, which is exactly what Mindustry expects inside a mod
archive. Run ``python3 tools/check_content.py`` afterwards to verify the result.
"""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "water-well-400.zip"

ALWAYS = ("mod.hjson", "icon.png")
FOLDERS = ("content", "sprites", "bundles", "scripts")
SUFFIXES = {".json", ".hjson", ".png", ".properties", ".js"}


def mod_files():
    files = []
    for name in ALWAYS:
        path = ROOT / name
        if not path.is_file():
            raise SystemExit(f"Missing mod file: {name}")
        files.append(path)

    for folder in FOLDERS:
        root = ROOT / folder
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*")):
            if path.is_file() and path.suffix in SUFFIXES:
                files.append(path)

    return files


with ZipFile(OUTPUT, "w", compression=ZIP_DEFLATED) as archive:
    for path in mod_files():
        archive.write(path, arcname=path.relative_to(ROOT).as_posix())

print(f"Created {OUTPUT.name}: {len(mod_files())} files")
