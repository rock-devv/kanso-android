#!/usr/bin/env python3
"""Kanso launcher icon: a smooth zen stone resting on a brush ground line.

Chosen from the sketch rounds (option I — "Stone"). Rendered at master
resolution and downscaled into every mipmap density. The stone is an ink
ellipse; the ground line is a tapered brush stroke, like the sketch.
"""
from PIL import Image, ImageDraw, ImageFilter
import math
import os

S = 512  # master canvas
PAPER = (253, 253, 253, 255)
INK = (17, 17, 17, 255)


def brush_line(img, p0, p1, width, color=INK, bow=0.0):
    """Tapered brush stroke: thin at the ends, full in the middle."""
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


def build_master():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Paper background, edge-to-edge (adaptive launchers mask it)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S // 5, fill=PAPER)

    # The stone: smooth ink ellipse, slightly irregular like a real pebble
    stone = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stone)
    # squash + tiny tilt for a natural rest
    stone_pts = []
    cx, cy = S * 0.5, S * 0.53
    rx, ry = S * 0.20, S * 0.135
    for i in range(72):
        a = 2 * math.pi * i / 72
        wob = 1 + 0.02 * math.sin(a * 3 + 0.7)
        x = cx + rx * wob * math.cos(a)
        y = cy + ry * wob * math.sin(a)
        # slight rotation (~4 degrees)
        rot = math.radians(4)
        xr = cx + (x - cx) * math.cos(rot) - (y - cy) * math.sin(rot)
        yr = cy + (x - cx) * math.sin(rot) + (y - cy) * math.cos(rot)
        stone_pts.append((xr, yr))
    sd.polygon(stone_pts, fill=INK)
    stone = stone.filter(ImageFilter.GaussianBlur(0.6))
    img.alpha_composite(stone)

    # Ground: tapered brush line under the stone
    brush_line(img, (S * 0.24, S * 0.72), (S * 0.76, S * 0.72), S * 0.035, bow=-6)

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
