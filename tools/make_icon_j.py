#!/usr/bin/env python3
"""J-direction refinement: ring + dot as real paint on paper.

  J1  brush ring (open, tapered) + ink paint drop
  J2  brush ring + green paint drop (color accent)
  J3  closed thinner brush ring + green drop
  J4  brush ring + ink blot (irregular splat)

The ring reuses the round-1 brush technique: tapered ends, organic
wobble, faint blur so it sits in the paper like pigment.
"""
from PIL import Image, ImageDraw, ImageFilter
import math
import os

S = 512
PAPER = (253, 253, 253, 255)
INK = (17, 17, 17, 255)
GREEN = (74, 148, 94, 255)

OUT = "icons-preview"
os.makedirs(OUT, exist_ok=True)


def canvas():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S // 5, fill=PAPER)
    return img, d


def brush_ring(img, cx, cy, r, color=INK, gap_deg=28, thick=0.30):
    """Open brush ring: tapered ends, wobble, pigment-soft edge."""
    steps = 360
    start = 90 + gap_deg / 2.0
    sweep = 360 - gap_deg
    outer, inner = [], []
    for i in range(steps + 1):
        t = i / steps
        rad = math.radians(start + sweep * t)
        wobble = 1.0 + 0.018 * math.sin(rad * 2 + 0.8) + 0.012 * math.sin(rad * 5 + 2.1)
        rr = r * wobble
        belly = 0.55 + 0.45 * math.sin(math.pi * min(1.0, max(0.0, t)))
        half = (r * thick) * 0.5 * belly
        outer.append((cx + (rr + half) * math.cos(rad), cy + (rr + half) * math.sin(rad)))
        inner.append((cx + (rr - half) * math.cos(rad), cy + (rr - half) * math.sin(rad)))
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(layer).polygon(outer + inner[::-1], fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(1.2))
    img.alpha_composite(layer)


def paint_drop(img, cx, cy, r, color=INK):
    """A paint drop: teardrop with a full round bottom and a little tail.

    Built from a circle + bezier tail, slightly irregular like real paint.
    """
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # main body: circle
    d.ellipse([cx - r, cy - r * 0.9, cx + r, cy + r * 1.1], fill=color)

    # tail: small triangle-ish bezier pulled up-right (as if just fallen)
    tail_h = r * 1.15
    tail_w = r * 0.55

    def bez(p0, p1, p2, n=24):
        pts = []
        for i in range(n + 1):
            u = i / n
            pts.append(((1-u)**2*p0[0] + 2*(1-u)*u*p1[0] + u**2*p2[0],
                        (1-u)**2*p0[1] + 2*(1-u)*u*p1[1] + u**2*p2[1]))
        return pts

    tip = (cx + r * 0.35, cy - r * 0.9 - tail_h)
    side_l = bez((cx - r * 0.35, cy - r * 0.35),
                 (cx - tail_w * 0.2, cy - r - tail_h * 0.45), tip)
    side_r = bez(tip,
                 (cx + tail_w, cy - r - tail_h * 0.3),
                 (cx + r * 0.5, cy - r * 0.2))
    d.polygon(side_l + side_r, fill=color)

    layer = layer.filter(ImageFilter.GaussianBlur(0.6))
    img.alpha_composite(layer)


def blot(img, cx, cy, r, color=INK):
    """Irregular ink blot: wobbly blob + tiny satellite specks."""
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    pts = []
    n = 40
    for i in range(n):
        a = 2 * math.pi * i / n
        rr = r * (1 + 0.16 * math.sin(a * 3 + 1) + 0.09 * math.sin(a * 7 + 0.4))
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    d.polygon(pts, fill=color)
    for (sx, sy, sr) in [(cx + r * 1.15, cy - r * 0.7, r * 0.13),
                         (cx - r * 1.05, cy + r * 0.85, r * 0.10)]:
        d.ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(0.8))
    img.alpha_composite(layer)


def make_j1():
    img, d = canvas()
    brush_ring(img, S * 0.50, S * 0.52, S * 0.27)
    paint_drop(img, S * 0.50, S * 0.52, S * 0.062, INK)
    return img


def make_j2():
    img, d = canvas()
    brush_ring(img, S * 0.50, S * 0.52, S * 0.27)
    paint_drop(img, S * 0.50, S * 0.52, S * 0.062, GREEN)
    return img


def make_j3():
    img, d = canvas()
    brush_ring(img, S * 0.50, S * 0.52, S * 0.27, gap_deg=18, thick=0.24)
    paint_drop(img, S * 0.50, S * 0.52, S * 0.062, GREEN)
    return img


def make_j4():
    img, d = canvas()
    brush_ring(img, S * 0.50, S * 0.52, S * 0.27)
    blot(img, S * 0.50, S * 0.53, S * 0.055, INK)
    return img


def main():
    for name, img in {
        "J1-ring-inkdrop": make_j1(),
        "J2-ring-greendrop": make_j2(),
        "J3-ring-closed-greendrop": make_j3(),
        "J4-ring-blot": make_j4(),
    }.items():
        path = os.path.join(OUT, f"{name}.png")
        img.save(path)
        print(path)


if __name__ == "__main__":
    main()
