#!/usr/bin/env python3
"""Extract transparent Circuit Lab component PNGs from the RoboStudio source sheet."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


KEY_COLOR = (0, 255, 0)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def repo_relative_path(root: Path, value: str, label: str) -> Path:
    if not isinstance(value, str) or not value.strip() or Path(value).is_absolute() or "\\" in value or "\0" in value:
        raise ValueError(f"{label} must be a normalized repo-relative path")
    resolved = (root / value).resolve()
    if resolved != root.resolve() and root.resolve() not in resolved.parents:
        raise ValueError(f"{label} must stay inside the repository")
    return resolved


def key_alpha(pixel: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    r, g, b, a = pixel
    green_distance = ((r - KEY_COLOR[0]) ** 2 + (g - KEY_COLOR[1]) ** 2 + (b - KEY_COLOR[2]) ** 2) ** 0.5
    green_dominance = g - max(r, b)
    if g > 118 and green_dominance > 68 and r < 88 and b < 110:
        return (0, 0, 0, 0)
    if g > 150 and green_dominance > 72:
        if green_distance < 104:
            return (0, 0, 0, 0)
        if green_distance < 164:
            feather = (green_distance - 104) / 60
            return (r, g, b, int(a * feather))
    return (r, g, b, a)


def transparent_crop(cell: Image.Image) -> Image.Image:
    rgba = cell.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    for y in range(height):
        for x in range(width):
            pixels[x, y] = key_alpha(pixels[x, y])

    alpha = rgba.getchannel("A")
    mask = alpha.point(lambda value: 255 if value > 18 else 0)
    box = mask.getbbox()
    if not box:
        raise ValueError("cell did not contain a visible component after chroma key removal")

    padding = 8
    left = max(0, box[0] - padding)
    top = max(0, box[1] - padding)
    right = min(width, box[2] + padding)
    bottom = min(height, box[3] + padding)
    return rgba.crop((left, top, right, bottom))


def main() -> int:
    root = repo_root()
    manifest_path = root / "scripts" / "circuits" / "photoreal-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    components = manifest.get("components", [])
    grid_columns = int(manifest.get("grid", {}).get("columns", 0))
    grid_rows = int(manifest.get("grid", {}).get("rows", 0))
    if grid_columns <= 0 or grid_rows <= 0:
        raise ValueError("photoreal manifest must define a positive source grid")
    expected_cells = grid_columns * grid_rows
    if len(components) != expected_cells:
        raise ValueError(f"photoreal manifest must contain {expected_cells} entries for the {grid_columns}x{grid_rows} sheet")
    stored_sheet = repo_relative_path(root, manifest.get("sourceSheet"), "sourceSheet")

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--sheet",
        type=Path,
        default=stored_sheet,
        help="Path to the RoboStudio photoreal component source sheet.",
    )
    args = parser.parse_args()

    sheet_path = args.sheet.resolve()
    if not sheet_path.exists():
        raise FileNotFoundError(f"source sheet not found: {sheet_path}")

    with Image.open(sheet_path) as source_image:
        sheet = source_image.convert("RGBA")

    stored_sheet.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(stored_sheet, optimize=True)
    width, height = sheet.size
    cell_width = width / grid_columns
    cell_height = height / grid_rows

    for index, component in enumerate(components):
        expected_raster = f"src/circuits/assets/photoreal/raster/{component['id']}.png"
        if component.get("rasterSource") != expected_raster:
            raise ValueError(f"{component['id']}.rasterSource must be {expected_raster}")
        col = index % grid_columns
        row = index // grid_columns
        left = round(col * cell_width) + 5
        top = round(row * cell_height) + 5
        right = round((col + 1) * cell_width) - 5
        bottom = round((row + 1) * cell_height) - 5
        cell = sheet.crop((left, top, right, bottom))
        component_image = transparent_crop(cell)
        output_path = repo_relative_path(root, component["rasterSource"], f"{component['id']}.rasterSource")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        component_image.save(output_path, optimize=True)

    print(f"Extracted {len(components)} transparent Circuit Lab raster component assets.")
    print(f"Source sheet: {stored_sheet.relative_to(root).as_posix()}")
    print("Raster assets: src/circuits/assets/photoreal/raster")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
