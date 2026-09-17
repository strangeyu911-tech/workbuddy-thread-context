#!/usr/bin/env python3
"""生成 512x512 技能图标（PNG，RGBA）。无第三方依赖。

设计：圆角方底 + 对角渐变（靛蓝 → 紫），白色「分支」字形：
一条主干向上，在分叉点分成左右两条曲线，三个端点各有圆点。

用法：python tools/make-icon.py [输出路径]
"""
import math
import struct
import sys
import zlib
from pathlib import Path

SIZE = 512
RADIUS = 116          # 圆角半径
STROKE = 34.0         # 字形线宽
DOT_R = 36.0          # 端点圆点半径

C_TOP = (67, 56, 202)      # #4338CA
C_BOTTOM = (139, 92, 246)  # #8B5CF6

BOTTOM = (256.0, 392.0)
FORK = (256.0, 268.0)
LEFT = (148.0, 148.0)
RIGHT = (364.0, 148.0)
CTRL = (256.0, 148.0)


def clamp01(v):
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def round_rect_coverage(x, y, size, r):
    """圆角方形的覆盖率（1px 抗锯齿），坐标取像素中心。"""
    cx = min(max(x, r), size - r)
    cy = min(max(y, r), size - r)
    dx = x - cx
    dy = y - cy
    d = math.hypot(dx, dy) - r
    return clamp01(0.5 - d)


def seg_distance(px, py, ax, ay, bx, by):
    vx = bx - ax
    vy = by - ay
    wx = px - ax
    wy = py - ay
    ll = vx * vx + vy * vy
    t = 0.0 if ll == 0.0 else clamp01((wx * vx + wy * vy) / ll)
    dx = wx - vx * t
    dy = wy - vy * t
    return math.hypot(dx, dy)


def bezier(p0, p1, p2, n=28):
    pts = []
    for i in range(n + 1):
        t = i / n
        mt = 1.0 - t
        x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0]
        y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]
        pts.append((x, y))
    return pts


LEFT_PATH = bezier(FORK, CTRL, LEFT)
RIGHT_PATH = bezier(FORK, CTRL, RIGHT)
DOTS = ((BOTTOM[0], BOTTOM[1], DOT_R), (LEFT[0], LEFT[1], DOT_R), (RIGHT[0], RIGHT[1], DOT_R))


def stroke_distance(px, py):
    """到整条字形（三条路径 + 三个圆点）的最短距离。"""
    half = STROKE / 2.0
    best = 1e9
    for x, y, r in DOTS:
        d = math.hypot(px - x, py - y) - r
        if d < best:
            best = d
    for path in (LEFT_PATH, RIGHT_PATH):
        lo_x = min(p[0] for p in path) - half - 2
        hi_x = max(p[0] for p in path) + half + 2
        if px < lo_x or px > hi_x:
            continue
        for i in range(len(path) - 1):
            (ax, ay), (bx, by) = path[i], path[i + 1]
            if px < min(ax, bx) - half or px > max(ax, bx) + half:
                continue
            d = seg_distance(px, py, ax, ay, bx, by) - half
            if d < best:
                best = d
    # 主干
    d = seg_distance(px, py, FORK[0], FORK[1], BOTTOM[0], BOTTOM[1]) - half
    if d < best:
        best = d
    return best


def build_pixels():
    rows = []
    span = SIZE - 1
    for y in range(SIZE):
        py = y + 0.5
        t = (y + 0.5) / SIZE
        base = (
            C_TOP[0] + (C_BOTTOM[0] - C_TOP[0]) * t,
            C_TOP[1] + (C_BOTTOM[1] - C_TOP[1]) * t,
            C_TOP[2] + (C_BOTTOM[2] - C_TOP[2]) * t,
        )
        row = bytearray()
        for x in range(SIZE):
            px = x + 0.5
            cov = round_rect_coverage(px, py, SIZE, RADIUS)
            if cov <= 0.0:
                row += b"\x00\x00\x00\x00"
                continue
            # 渐变带一点横向偏移，避免纯条纹感
            mix = (px / span) * 0.22
            r = base[0] * (1 - mix) + C_BOTTOM[0] * mix
            g = base[1] * (1 - mix) + C_BOTTOM[1] * mix
            b = base[2] * (1 - mix) + C_BOTTOM[2] * mix

            glyph = clamp01(0.5 - stroke_distance(px, py))
            if glyph > 0.0:
                r = r * (1 - glyph) + 255.0 * glyph
                g = g * (1 - glyph) + 255.0 * glyph
                b = b * (1 - glyph) + 255.0 * glyph
            row += bytes((int(round(r)), int(round(g)), int(round(b)), int(round(cov * 255))))
        rows.append(bytes(row))
    return rows


def write_png(path, rows):
    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter: None
        raw += row

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        return out + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(png)
    return len(png)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "assets/icon-512.png"
    size = write_png(out, build_pixels())
    print(f"已生成 {out} ({SIZE}x{SIZE}, {size} 字节)")
