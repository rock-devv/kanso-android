#!/usr/bin/env python3
"""Adaptive icon layers for Kanso's zen stone.

Adaptive icons use a 108x108dp canvas where only the inner ~72dp is
guaranteed visible (launchers mask it into circles/squircles etc). The
stone must therefore sit well inside the safe zone.

Outputs per density (mdpi..xxxhdpi):
  mipmap-*/ic_launcher_foreground.png  - stone + ground, transparent bg
  mipmap-*/ic_launcher_background.png  - paper color, full bleed
  mipmap-*/ic_launcher_monochrome.png  - single-color layer for themed icons
"""
from PIL import Image, ImageDraw, ImageFilter
import math
import os

# Adaptive master canvas: 108dp at 4x = 432px (use 512 for quality, scale down)
S = 512
PAPER = (253, 253, 253, 255)
INK = (17, 17, 17, 255)
INK_SOFT = (17, 17, 17, 235)

# Visible safe zone: center 66/108 of the canvas (66dp of 108dp)
SAFE = 0.62


def brush_line(img, p0, p1, width, color=INK, bow=0.0):
    steps = 60
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    px, py = -uy, ux
    top, bot = [], []
    for i in range(steps + 1):
        t = i / steps
        mx = p0[0] + dx * t + px * bow * math.sin(math.pi * t)
        my = p0[1] + dy * t + py * bow * math.sin(math.pi * t)
        half = width / 2 * (0.25 + 0.75 * math.sin(math.pi * min(1.0, t * 1.05)))
        top.append((mx + px * half, my + py * half))
        bot.append((mx - px * half, my - py * half))
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(layer).polygon(top + bot[::-1], fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(0.8))
    img.alpha_composite(layer)


def draw_stone(d, cx, cy, rx, ry, color=INK):
    pts = []
    for i in range(72):
        a = 2 * math.pi * i / 72
        wob = 1 + 0.02 * math.sin(a * 3 + 0.7)
        x = cx + rx * wob * math.cos(a)
        y = cy + ry * wob * math.sin(a)
        rot = math.radians(4)
        xr = cx + (x - cx) * math.cos(rot) - (y - cy) * math.sin(rot)
        yr = cy + (x - cx) * math.sin(rot) + (y - cy) * math.cos(rot)
        pts.append((xr, yr))
    d.polygon(pts, fill=color)


def build_foreground():
    """Stone + ground line, sized to the adaptive safe zone."""
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    cx = S / 2
    # stone sized relative to the safe zone (62% of canvas diameter)
    safe_r = S * SAFE / 2
    stone_rx = safe_r * 0.62
    stone_ry = safe_r * 0.42
    stone_cy = S * 0.545

    stone = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw_stone(ImageDraw.Draw(stone), cx, stone_cy, stone_rx, stone_ry)
    stone = stone.filter(ImageFilter.GaussianBlur(0.6))
    img.alpha_composite(stone)

    # ground line under the stone, inside safe zone
    y = stone_cy + stone_ry * 1.35
    brush_line(img, (cx - safe_r * 0.95, y), (cx + safe_r * 0.95, y),
               S * 0.030, bow=-6)
    return img


def build_monochrome():
    """White-on-transparent layer for Android 13 themed icons."""
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    safe_r = S * SAFE / 2
    cx = S / 2
    stone_cy = S * 0.545
    # tint color applied by launcher; draw in white
    WHITE = (255, 255, 255, 255)
    stone = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw_stone(ImageDraw.Draw(stone), cx, stone_cy,
               safe_r * 0.62, safe_r * 0.42, color=WHITE)
    stone = stone.filter(ImageFilter.GaussianBlur(0.6))
    img.alpha_composite(stone)
    y = stone_cy + safe_r * 0.42 * 1.35
    brush_line(img, (cx - safe_r * 0.95, y), (cx + safe_r * 0.95, y),
               S * 0.030, bow=-6, color=WHITE)
    return img


def build_background():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, S - 1, S - 1], fill=PAPER)
    return img


def main():
    densities = {"mdpi": 108, "hdpi": 162, "xhdpi": 216,
                 "xxhdpi": 324, "xxxhdpi": 432}
    layers = {
        "ic_launcher_foreground": build_foreground(),
        "ic_launcher_background": build_background(),
        "ic_launcher_monochrome": build_monochrome(),
    }
    for density, size in densities.items():
        folder = os.path.join("app", "res", f"mipmap-{density}")
        os.makedirs(folder, exist_ok=True)
        for name, master in layers.items():
            out = master.resize((size, size), Image.LANCZOS)
            path = os.path.join(folder, f"{name}.png")
            out.save(path)
            print(path)


if __name__ == "__main__":
    main()
