#!/usr/bin/env python3
"""PSD'nin gömülü birleşik önizlemesini küçük PNG olarak yazar (hızlı keşif).

Kullanım: .venv-psd/bin/python scripts/psd_preview.py <psd> <cikti.png> [genislik]
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image
from psd_tools import PSDImage


def main() -> int:
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    width = int(sys.argv[3]) if len(sys.argv) > 3 else 900
    psd = PSDImage.open(str(src))
    img = psd.topil()
    if img is None:
        print("gömülü önizleme yok")
        return 1
    img = img.convert("RGB")
    k = width / img.width
    img = img.resize((width, max(1, round(img.height * k))), Image.LANCZOS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, "PNG")
    print(f"{dst}  {img.width}x{img.height}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
