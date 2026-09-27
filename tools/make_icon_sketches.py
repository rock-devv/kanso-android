#!/usr/bin/env python3
"""Round-2 quick sketches for the Kanso icon. Deliberately rough.

  E. page-fold   — blank sheet with a dog-eared corner
  F. three-lines — three brush lines, like a page of writing (abstract)
  G. one-stroke  — a single horizontal brush stroke ("one", breath)
  H. line-dot    — brush line + dot: a pause, then a thought
  I. stone       — a smooth zen stone on a ground line
  J. ring-dot    — thin open ring with a center dot (space + focus)
  K. feather     — a light quill
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


def brush_line(img, p0, p1, width, color=INK, bow=0.0):
    """Horizontal-ish brush stroke: taper at both ends, slight bow."""
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


def make_page_fold():
    img, d = canvas()
    # sheet outline: rectangle with cut corner + folded flap
    x0, y0, x1, y1 = S * 0.30, S * 0.22, S * 0.70, S * 0.78
    c = S * 0.11  # corner cut size
    w = int(S * 0.022)
    d.line([(x0, y0), (x1 - c, y0)], fill=INK, width=w)
    d.line([(x1 - c, y0), (x1, y0 + c)], fill=INK, width=w)
    d.line([(x1, y0 + c), (x1, y1)], fill=INK, width=w)
    d.line([(x1, y1), (x0, y1)], fill=INK, width=w)
    d.line([(x0, y1), (x0, y0)], fill=INK, width=w)
    # flap (filled triangle)
    d.polygon([(x1 - c, y0), (x1 - c, y0 + c), (x1, y0 + c)], fill=INK)
    # two quiet text lines
    d.line([(x0 + S * 0.07, S * 0.47), (x1 - S * 0.07, S * 0.47)], fill=INK, width=int(S * 0.012))
    d.line([(x0 + S * 0.07, S * 0.60), (x1 - S * 0.16, S * 0.60)], fill=INK, width=int(S * 0.012))
    return img


def make_three_lines():
    img, d = canvas()
    brush_line(img, (S * 0.26, S * 0.36), (S * 0.74, S * 0.36), S * 0.055, bow=6)
    brush_line(img, (S * 0.26, S * 0.52), (S * 0.66, S * 0.52), S * 0.05, bow=-5)
    brush_line(img, (S * 0.26, S * 0.68), (S * 0.58, S * 0.68), S * 0.045, bow=4)
    return img


def make_one_stroke():
    img, d = canvas()
    brush_line(img, (S * 0.24, S * 0.52), (S * 0.76, S * 0.48), S * 0.085, bow=14)
    return img


def make_line_dot():
    img, d = canvas()
    brush_line(img, (S * 0.26, S * 0.52), (S * 0.60, S * 0.52), S * 0.07, bow=10)
    r = S * 0.045
    d.ellipse([S * 0.70 - r, S * 0.50 - r, S * 0.70 + r, S * 0.50 + r], fill=INK)
    return img


def make_stone():
    img, d = canvas()
    # smooth stone: squashed blob
    d.ellipse([S * 0.30, S * 0.40, S * 0.70, S * 0.66], fill=INK)
    # ground brush line
    brush_line(img, (S * 0.24, S * 0.72), (S * 0.76, S * 0.72), S * 0.035, bow=-6)
    return img


def make_ring_dot():
    img, d = canvas()
    cx, cy, r, w = S * 0.5, S * 0.52, S * 0.24, int(S * 0.028)
    d.arc([cx - r, cy - r, cx + r, cy + r], start=25, end=340, fill=INK, width=w)
    dr = S * 0.042
    d.ellipse([cx - dr, cy - dr, cx + dr, cy + dr], fill=INK)
    return img


def make_feather():
    img, d = canvas()
    # curved spine
    spine = [(S * 0.36, S * 0.74), (S * 0.52, S * 0.42), (S * 0.66, S * 0.26)]
    # build leaf-like body along spine
    pts_l, pts_r = [], []
    for i, (x, y) in enumerate(spine):
        pass
    # simple approach: two beziers bulging right/left of the spine
    def bez(p0, p1, p2, n=40):
        out = []
        for i in range(n + 1):
            u = i / n
            out.append(((1-u)**2*p0[0] + 2*(1-u)*u*p1[0] + u**2*p2[0],
                        (1-u)**2*p0[1] + 2*(1-u)*u*p1[1] + u**2*p2[1]))
        return out
    body_l = bez(spine[0], (S * 0.30, S * 0.40), spine[2])
    body_r = bez(spine[2], (S * 0.60, S * 0.50), spine[0])
    d.polygon(body_l + body_r, fill=GREEN)
    d.line(spine, fill=PAPER, width=int(S * 0.012))
    # quill tip
    d.line([spine[0], (S * 0.31, S * 0.82)], fill=INK, width=int(S * 0.014))
    return img


def main():
    for name, img in {
        "E-page-fold": make_page_fold(),
        "F-three-lines": make_three_lines(),
        "G-one-stroke": make_one_stroke(),
        "H-line-dot": make_line_dot(),
        "I-stone": make_stone(),
        "J-ring-dot": make_ring_dot(),
        "K-feather": make_feather(),
    }.items():
        path = os.path.join(OUT, f"{name}.png")
        img.save(path)
        print(path)


if __name__ == "__main__":
    main()
