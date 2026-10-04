#!/usr/bin/env python3
"""Проверка контента мода без запуска Mindustry.

Проверяет JSON блоков и спрайты так, как это сделала бы игра, и ловит то, что
игра молча игнорирует (Mindustry пропускает неизвестные поля блока с записью в
лог, поэтому опечатка в JSON не ломает игру, но и не работает):

  • JSON вообще читается и содержит нужные поля;
  • все поля блоков — существующие поля Mindustry v146;
  • размер спрайта совпадает с размером блока (32 пикселя на клетку);
  • все слои из "drawer" (и «-top» для купола) нарисованы;
  • предметы, жидкости и родитель исследования существуют в игре;
  • каждому блоку есть строки в bundles/bundle.properties и bundle_ru.properties;
  • собранный ZIP совпадает с исходниками.

Запуск:  python3 tools/check_content.py
"""

from pathlib import Path
import json
import struct
import sys
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
BLOCK_DIR = ROOT / "content" / "blocks"
SPRITE_DIR = ROOT / "sprites" / "blocks"
BUNDLE_FILES = (ROOT / "bundles" / "bundle.properties", ROOT / "bundles" / "bundle_ru.properties")
ZIP_PATH = ROOT / "water-well-400.zip"
MOD_NAME = "water-well-400"
PIXELS_PER_TILE = 32

failure_count = 0
check_count = 0


def ok(condition, label):
    global failure_count, check_count
    check_count += 1
    if condition:
        print("  ok   " + label)
    else:
        failure_count += 1
        print("  FAIL " + label)


def section(title):
    print("\n== " + title + " ==")


# --- имена из ванильного Mindustry v146 ------------------------------------

VANILLA_ITEMS = {
    "copper", "lead", "metaglass", "graphite", "sand", "coal", "titanium", "thorium", "scrap",
    "silicon", "plastanium", "phase-fabric", "surge-alloy", "spore-pod", "blast-compound",
    "pyratite", "beryllium", "tungsten", "oxide", "carbide", "fissile-matter", "dormant-cyst",
}

VANILLA_LIQUIDS = {
    "water", "slag", "oil", "cryofluid", "arkycite", "gallium", "ozone", "hydrogen", "nitrogen",
    "cyanogen",
}

# Блоки Mindustry, на которые мод ссылается как на родителя исследования.
VANILLA_RESEARCH = {"mechanical-drill", "overdrive-projector"}

# Поля Block/UnlockableContent/GenericCrafter/OverdriveProjector в v146.
KNOWN_BLOCK_FIELDS = {
    "absorbLasers", "acceptsItems", "acceptsPayload", "albedo", "allowConfigInventory",
    "allowDiagonal", "allowResupply", "alwaysReplace", "alwaysUpdateInUnits", "ambientSound",
    "ambientSoundVolume", "armor", "attacks", "attributes", "autoResetEnabled",
    "baseExplosiveness", "baseColor", "breakEffect", "breakPitchChange", "breakSound",
    "breakable", "buildCost", "buildCostMultiplier", "buildVisibility", "cacheLayer",
    "canOverdrive", "category", "clearOnDoubleTap", "clipSize", "commandable", "conductivePower",
    "configurable", "connectedPower", "consumesPower", "conveyorPlacement", "copyConfig",
    "craftEffect", "craftTime", "createRubble", "crushDamageMultiplier", "customShadow",
    "deconstructThreshold", "destroyBullet", "destroyBulletSameTeam", "destroyEffect",
    "destroySound", "destructible", "details", "displayFlow", "drawArrow", "drawCracks",
    "drawDisabled", "drawLiquidLight", "drawTeamOverlay", "drawer", "dumpExtraLiquid",
    "emitLight", "enableDrawStatus", "envDisabled", "envEnabled", "envRequired", "fillsTile",
    "floating", "fogRadius", "forceDark", "group", "hasBoost", "hasColor", "hasItems",
    "hasLiquids", "hasPower", "hasShadow", "health", "hideDetails", "ignoreLiquidFullness",
    "inEditor", "inlineDescription", "instantDeconstruct", "instantTransfer", "insulated",
    "invertFlip", "isDuct", "itemCapacity", "itemDrop", "lastConfig", "legacyReadWarmup",
    "lightColor", "lightLiquid", "lightRadius", "liquidCapacity", "liquidOutputDirections",
    "liquidPressure", "lockRotation", "logicConfigurable", "loopSound", "loopSoundVolume",
    "mapColor", "name", "noSideBlend", "noUpdateDisabled", "offset", "outlineColor",
    "outlineIcon", "outlineRadius", "outlinedIcon", "outputFacing", "outputItem", "outputItems",
    "outputLiquid", "outputLiquids", "outputsLiquid", "outputsPayload", "outputsPower",
    "phaseColor", "phaseRangeBoost", "placeEffect", "placeOverlapRange", "placePitchChange",
    "placeSound", "placeableLiquid", "placeableOn", "placeablePlayer", "playerUnmineable",
    "priority", "privileged", "quickRotate", "range", "rebuildable", "regionRotated1",
    "regionRotated2", "regionSuffix", "reload", "replaceable", "requirements", "requiresWater",
    "researchCost", "researchCostMultiplier", "researchCostMultipliers", "rotate", "rotateDraw",
    "saveConfig", "saveData", "scaledHealth", "schematicPriority", "selectionRows",
    "separateItemCapacity", "size", "sizeOffset", "solid", "solidifes", "speedBoost",
    "speedBoostPhase", "squareSprite", "suppressable", "swapDiagonalPlacement", "sync",
    "targetable", "teamPassable", "underBullets", "unitCapModifier", "unloadable", "update",
    "updateEffect", "updateEffectChance", "updateInUnits", "useColor", "useTime", "variants",
    "warmupSpeed",
}

# Ключи JSON, которые игра разбирает отдельно от полей класса:
# "type" — класс блока, "research" — узел дерева технологий, "consumes" —
# список потребления, "description" — запасная строка (см. ContentParser.readBundle;
# её берут из bundles, а JSON — только подстраховка).
SPECIAL_BLOCK_KEYS = {"type", "research", "consumes", "description"}

CONSUME_KEYS = {
    "item", "itemCharged", "itemFlammable", "itemRadioactive", "itemExplosive", "itemExplode",
    "items", "liquidFlammable", "liquid", "liquids", "coolant", "power", "powerBuffered",
}

DRAWER_TYPES = {
    "DrawArcSmelt", "DrawBlast", "DrawBlock", "DrawBlurSpin", "DrawBubbles", "DrawCells",
    "DrawCircles", "DrawCrucibleFlame", "DrawCultivator", "DrawDefault", "DrawFade",
    "DrawFlame", "DrawFrames", "DrawGlowRegion", "DrawHeatInput", "DrawHeatOutput",
    "DrawHeatRegion", "DrawLiquidOutputs", "DrawLiquidRegion", "DrawLiquidTile", "DrawMulti",
    "DrawMultiWeave", "DrawParticles", "DrawPistons", "DrawPlasma", "DrawPower",
    "DrawPulseShape", "DrawPumpLiquid", "DrawRegion", "DrawShape", "DrawSideRegion",
    "DrawSoftParticles", "DrawSpikes", "DrawTurret", "DrawWarmupRegion", "DrawWeave",
}


def png_size(path):
    data = path.read_bytes()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError(f"не PNG: {path}")
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def load_bundle_properties(path):
    entries = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        entries[key.strip()] = value.strip()
    return entries


def collect_blocks():
    blocks = []
    for path in sorted(BLOCK_DIR.glob("*.json")):
        blocks.append((path.stem, json.loads(path.read_text(encoding="utf-8"))))
    return blocks


def check_fields(name, data):
    for key, value in data.items():
        if key in SPECIAL_BLOCK_KEYS:
            continue
        if key not in KNOWN_BLOCK_FIELDS:
            ok(False, f"{name}: поле \"{key}\" не существует в Mindustry v146")
            continue
    if "size" not in data:
        ok(False, f"{name}: не указан size")


def check_references(name, data):
    for stack in data.get("requirements", []):
        item = stack.get("item")
        ok(item in VANILLA_ITEMS, f"{name}: предмет {item} существует")
        ok(isinstance(stack.get("amount"), int) and stack["amount"] > 0,
           f"{name}: количество {item} — положительное целое")

    consumes = data.get("consumes", {})
    for key in consumes:
        ok(key in CONSUME_KEYS, f"{name}: вид потребления \"{key}\" известен")

    for stack in item_stacks(consumes.get("items")):
        ok(stack.get("item") in VANILLA_ITEMS, f"{name}: потребляемый предмет {stack.get('item')} существует")

    for source in (consumes.get("liquid"), consumes.get("liquidFlammable")):
        if isinstance(source, dict):
            ok(source.get("liquid") in VANILLA_LIQUIDS, f"{name}: потребляемая жидкость {source.get('liquid')} существует")

    for source in (data.get("outputLiquid"),):
        if isinstance(source, dict):
            ok(source.get("liquid") in VANILLA_LIQUIDS, f"{name}: выходная жидкость существует")

    research = data.get("research")
    if isinstance(research, str):
        ok(research in VANILLA_RESEARCH or (BLOCK_DIR / f"{research}.json").is_file(),
           f"{name}: родитель исследования \"{research}\" существует")


def item_stacks(value):
    if isinstance(value, list):
        return value
    if isinstance(value, dict) and isinstance(value.get("items"), list):
        return value["items"]
    return []


def check_sprites(name, data):
    size = data.get("size")
    if not isinstance(size, int) or size <= 0:
        return
    expected = size * PIXELS_PER_TILE

    sprites = [name]
    drawers = data.get("drawer")
    if isinstance(drawers, dict):
        drawers = [drawers]
    if isinstance(drawers, list):
        for index, drawer in enumerate(drawers):
            # "drawer" может быть списком слоёв и одним DrawMulti с вложенными
            if not isinstance(drawer, dict):
                continue
            if drawer.get("type") == "DrawMulti":
                for nested in drawer.get("drawers", []):
                    if isinstance(nested, dict) and nested.get("suffix"):
                        sprites.append(name + nested["suffix"])
            elif drawer.get("suffix"):
                sprites.append(name + drawer["suffix"])

    # OverdriveProjector сам рисует слой "@-top" (см. mindustry.world.blocks.defense)
    if data.get("type") == "OverdriveProjector":
        sprites.append(name + "-top")

    for sprite in sorted(set(sprites)):
        path = SPRITE_DIR / f"{sprite}.png"
        if not path.is_file():
            ok(False, f"{name}: нет спрайта sprites/blocks/{sprite}.png")
            continue
        width, height = png_size(path)
        ok((width, height) == (expected, expected),
           f"{name}: {sprite}.png {width}×{height} = {size} клетки × 32 пикселя")


def check_bundles(blocks):
    bundles = {path.name: load_bundle_properties(path) for path in BUNDLE_FILES}
    for file_name, entries in bundles.items():
        for name, _ in blocks:
            key = f"block.{MOD_NAME}-{name}"
            ok(key + ".name" in entries, f"{file_name}: есть название для {name}")
            ok(key + ".description" in entries, f"{file_name}: есть описание для {name}")
            ok(key + ".details" in entries, f"{file_name}: есть подробности для {name}")


def check_zip():
    if not ZIP_PATH.is_file():
        ok(False, "собран water-well-400.zip")
        return

    with ZipFile(ZIP_PATH) as archive:
        names = set(archive.namelist())
        for required in ("mod.hjson", "icon.png", "scripts/main.js"):
            ok(required in names, f"в ZIP есть {required}")
        for path in sorted(SPRITE_DIR.glob("*.png")):
            relative = f"sprites/blocks/{path.name}"
            ok(relative in names, f"в ZIP есть {relative}")
            if relative in names:
                ok(archive.read(relative) == path.read_bytes(), f"{relative} в ZIP совпадает с исходником")
        for path in sorted(BLOCK_DIR.glob("*.json")):
            relative = f"content/blocks/{path.name}"
            ok(relative in names, f"в ZIP есть {relative}")
            if relative in names:
                ok(archive.read(relative) == path.read_bytes(), f"{relative} в ZIP совпадает с исходником")


def main():
    section("блоки")
    blocks = collect_blocks()
    ok(len(blocks) > 0, "в content/blocks есть блоки")
    for name, data in blocks:
        check_fields(name, data)
        check_references(name, data)

    section("спрайты")
    for name, data in blocks:
        check_sprites(name, data)

    section("строки переводов")
    check_bundles(blocks)

    section("сборка ZIP")
    check_zip()

    print()
    if failure_count == 0:
        print(f"ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ (всего {check_count})")
    else:
        print(f"ПРОВАЛЕНО ПРОВЕРОК: {failure_count} из {check_count}")
    return 1 if failure_count else 0


if __name__ == "__main__":
    sys.exit(main())
