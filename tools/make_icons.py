#!/usr/bin/env python3
"""Generate ZenPen launcher icons: paper-white rounded square, black pen nib."""
from PIL import Image, ImageDraw
import os

BG = (253, 253, 253, 255)   # #FDFDFD - ZenPen paper
FG = (17, 17, 17, 255)      # #111111 - ZenPen ink

S = 432  # master canvas


def build_master():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Rounded paper background, edge-to-edge (adaptive icons get masked)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S // 5, fill=BG)

    # Pen nib, centered. Built from simple polygon + tail lines.
    cx, cy = S / 2, S / 2 - 8

    # Nib body: from shoulders down to a point
    nib = [
        (cx - 70, cy - 90),   # left shoulder
        (cx + 70, cy - 90),   # right shoulder
        (cx + 34, cy + 80),   # right taper
        (cx, cy + 120),       # tip
        (cx - 34, cy + 80),   # left taper
    ]
    d.polygon(nib, fill=FG)

    # Nib tail (the flat top)
    d.rectangle([cx - 70, cy - 110, cx + 70, cy - 90], fill=FG)

    # Nib slit
    d.line([cx, cy - 60, cx, cy + 70], fill=BG, width=8)

    # Breathing hole
    d.ellipse([cx - 12, cy + 6, cx + 12, cy + 30], fill=BG)

    return img


def main():
    sizes = {
        "mdpi": 48,
        "hdpi": 72,
        "xhdpi": 96,
        "xxhdpi": 144,
        "xxxhdpi": 192,
    }
    master = build_master()
    for density, size in sizes.items():
        folder = os.path.join("app", "res", f"mipmap-{density}")
        os.makedirs(folder, exist_ok=True)
        icon = master.resize((size, size), Image.LANCZOS)
        icon.save(os.path.join(folder, "ic_launcher.png"))
        print(f"{folder}/ic_launcher.png ({size}x{size})")


if __name__ == "__main__":
    main()
