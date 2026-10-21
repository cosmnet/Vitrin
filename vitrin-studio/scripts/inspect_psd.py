#!/usr/bin/env python3
"""PSD katman ağacı dökümü — WP-D keşif aracı.

Kullanım:
  .venv-psd/bin/python scripts/inspect_psd.py <psd yolu>

Her katman için: girinti, ad, tür, görünürlük, blend mod, opaklık, bbox ve
smart object ise yerleşim dörtgeni yazılır.
"""

from __future__ import annotations

import sys
from pathlib import Path

from psd_tools import PSDImage
from psd_tools.constants import Tag


def placed_quad(layer):
    blocks = layer.tagged_blocks
    data = None
    if blocks:
        data = blocks.get_data(Tag.PLACED_LAYER2) or blocks.get_data(Tag.PLACED_LAYER1)
    if data is not None and hasattr(data, "transform"):
        t = list(data.transform)
        if len(t) == 8:
            return [(round(float(t[i]), 1), round(float(t[i + 1]), 1)) for i in (0, 2, 4, 6)]
    return None


def dump(node, depth=0):
    for layer in node:
        pad = "  " * depth
        try:
            bbox = layer.bbox
        except Exception:
            bbox = None
        try:
            op = round(layer.opacity / 255.0, 2)
        except Exception:
            op = "?"
        try:
            blend = str(layer.blend_mode).split(".")[-1]
        except Exception:
            blend = "?"
        vis = "V" if layer.visible else "-"
        extra = ""
        if layer.kind == "smartobject":
            q = placed_quad(layer)
            if q:
                extra = f"  quad={q}"
        print(f"{pad}[{vis}] {layer.name!r} kind={layer.kind} blend={blend} "
              f"op={op} bbox={bbox}{extra}")
        if layer.is_group():
            dump(layer, depth + 1)


def main() -> int:
    path = Path(sys.argv[1])
    psd = PSDImage.open(str(path))
    print(f"# {path.name}  {psd.width}x{psd.height}  mode={psd.color_mode}")
    dump(psd)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
