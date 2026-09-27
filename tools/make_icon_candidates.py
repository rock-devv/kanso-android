#!/usr/bin/env python3
"""Kanso icon candidates v2, rendered at master resolution with Pillow.

  A. enso        — thick single ink-brush circle, organic wobble, tapered ends
  B. leaf        — smooth bezier leaf silhouette with vein + stem
  C. enso+leaf   — ensō with a small leaf resting in the opening
  D. nib         — the current pen-nib icon, for comparison

Writes PNGs to icons-preview/.
"""
from PIL import Image, ImageDraw, ImageFilter
import math
import os

S = 512
PAPER = (253, 253, 253, 255)
INK = (17, 17, 17, 255)
GREEN = (74, 148, 94, 255)
GREEN_DARK = (44, 106, 64, 255)

OUT = "icons-preview"
os.makedirs(OUT, exist_ok=True)


def paper_canvas():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S // 5, fill=PAPER)
    return img, d


def quad_bezier(p0, p1, p2, n=48):
    """Points along a quadratic bezier from p0 (via p1) to p2."""
    pts = []
    for i in range(n + 1):
        u = i / n
        x = (1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * p1[0] + u ** 2 * p2[0]
        y = (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * p1[1] + u ** 2 * p2[1]
        pts.append((x, y))
    return pts


def enso_stroke(img, cx, cy, r, color=INK, gap_deg=30):
    """One brush-like ring: thick, organically wobbling, tapered ends.

    Built as a filled polygon between an outer and inner offset curve so
    thickness varies along the stroke (thick middle, tapered lift-offs).
    """
    steps = 360
    start = 90 + gap_deg / 2.0
    sweep = 360 - gap_deg
    outer = []
    inner = []
    base_th = r * 0.30
    for i in range(steps + 1):
        t = i / steps
        deg = start + sweep * t
        rad = math.radians(deg)
        # hand-drawn wobble: two slow sine components
        wobble = 1.0 + 0.018 * math.sin(rad * 2 + 0.8) + 0.012 * math.sin(rad * 5 + 2.1)
        rr = r * wobble
        # taper: full belly in the middle, thin lift at both stroke ends
        belly = 0.55 + 0.45 * math.sin(math.pi * min(1.0, max(0.0, t)))
        # slight extra flick at the very end (brush lifting off)
        end_flick = 1.0 - (0.25 * max(0.0, t - 0.94) / 0.06 if t > 0.94 else 0.0)
        half = base_th * 0.5 * belly * end_flick
        outer.append((cx + (rr + half) * math.cos(rad),
                      cy + (rr + half) * math.sin(rad)))
        inner.append((cx + (rr - half) * math.cos(rad),
                      cy + (rr - half) * math.sin(rad)))

    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.polygon(outer + inner[::-1], fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(1.2))
    img.alpha_composite(layer)


def leaf(img, cx, cy, length, angle_deg=-50, color=GREEN, vein=True):
    """A smooth leaf: two mirrored bezier arcs meeting at base and tip,
    a paper-colored curved vein, and a small stem."""
    a = math.radians(angle_deg)
    ux, uy = math.cos(a), math.sin(a)          # along the leaf (base -> tip)
    px, py = -math.sin(a), math.cos(a)         # perpendicular

    base = (cx - ux * length * 0.42, cy - uy * length * 0.42)
    tip = (cx + ux * length * 0.58, cy + uy * length * 0.58)
    mid = ((base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2)
    w = length * 0.34

    # two sides, slightly asymmetric for a natural look
    side_a = quad_bezier(base, (mid[0] + px * w, mid[1] + py * w), tip)
    side_b = quad_bezier(tip, (mid[0] - px * w * 0.82, mid[1] - py * w * 0.82), base)

    d = ImageDraw.Draw(img)
    d.polygon(side_a + side_b, fill=color)

    # curved vein, slightly bowed off the axis
    vein_mid = (mid[0] + px * w * 0.12, mid[1] + py * w * 0.12)
    vein = quad_bezier((base[0] + ux * length * 0.05, base[1] + uy * length * 0.05),
                       vein_mid, (tip[0] - ux * length * 0.06, tip[1] - uy * length * 0.06))
    if vein:
        d.line(vein, fill=PAPER, width=max(3, int(length * 0.045)))

    # stem
    stem_start = base
    stem_end = (base[0] - ux * length * 0.14, base[1] - uy * length * 0.14)
    d.line([stem_start, stem_end], fill=color, width=max(4, int(length * 0.06)))


def make_enso():
    img, d = paper_canvas()
    enso_stroke(img, S * 0.50, S * 0.52, S * 0.27)
    return img


def make_leaf():
    img, d = paper_canvas()
    # one confident leaf, tilted like a sprout, plus a small shadow leaf
    leaf(img, S * 0.50, S * 0.58, S * 0.34, angle_deg=-64, color=GREEN)
    leaf(img, S * 0.615, S * 0.645, S * 0.16, angle_deg=8, color=GREEN_DARK, vein=False)
    return img


def make_enso_leaf():
    img, d = paper_canvas()
    enso_stroke(img, S * 0.50, S * 0.52, S * 0.28)
    # small leaf riding the opening, angled with the brush lift
    leaf(img, S * 0.455, S * 0.545, S * 0.17, angle_deg=-38, color=GREEN)
    return img


def make_nib():
    img, d = paper_canvas()
    cx, cy = S / 2, S / 2 - 10
    nib = [
        (cx - 84, cy - 104),
        (cx + 84, cy - 104),
        (cx + 40, cy + 94),
        (cx, cy + 140),
        (cx - 40, cy + 94),
    ]
    d.polygon(nib, fill=INK)
    d.rectangle([cx - 84, cy - 128, cx + 84, cy - 104], fill=INK)
    d.line([cx, cy - 70, cx, cy + 82], fill=PAPER, width=9)
    d.ellipse([cx - 14, cy + 8, cx + 14, cy + 36], fill=PAPER)
    return img


def main():
    for name, img in {
        "A-enso": make_enso(),
        "B-leaf": make_leaf(),
        "C-enso-leaf": make_enso_leaf(),
        "D-nib-current": make_nib(),
    }.items():
        path = os.path.join(OUT, f"{name}.png")
        img.save(path)
        print(path)


if __name__ == "__main__":
    main()
