#!/usr/bin/env python3
"""Genera los iconos de la PWA 'Tranqui' con Pillow (sin SVG)."""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))

TOP = (13, 59, 50)      # teal oscuro
BOT = (17, 86, 74)      # teal
EMERALD = (52, 211, 153)
LIGHT = (233, 255, 248)


def vgrad(size):
    img = Image.new("RGB", (size, size), TOP)
    px = img.load()
    for y in range(size):
        t = y / max(1, size - 1)
        r = int(TOP[0] + (BOT[0] - TOP[0]) * t)
        g = int(TOP[1] + (BOT[1] - TOP[1]) * t)
        b = int(TOP[2] + (BOT[2] - TOP[2]) * t)
        for x in range(size):
            px[x, y] = (r, g, b)
    return img


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def draw_arrow(img, size):
    """Flecha de navegacion bicolor (estilo puck)."""
    d = ImageDraw.Draw(img, "RGBA")
    cx, cy = size * 0.5, size * 0.52
    tip = (cx, cy - size * 0.40)
    bl = (cx - size * 0.28, cy + size * 0.32)
    br = (cx + size * 0.28, cy + size * 0.32)
    notch = (cx, cy + size * 0.12)
    # sombra sutil
    sh = [(p[0], p[1] + size * 0.012) for p in (tip, bl, notch, br)]
    d.polygon(sh, fill=(0, 0, 0, 70))
    # mitad izquierda (clara) y derecha (esmeralda)
    d.polygon([tip, bl, notch], fill=LIGHT)
    d.polygon([tip, br, notch], fill=EMERALD)


def build(size, maskable=False, opaque_square=False):
    base = vgrad(size)
    if maskable or opaque_square:
        img = base.convert("RGBA")
        draw_arrow(img, size)
        return img.convert("RGB") if opaque_square else img
    # con esquinas redondeadas y transparentes
    img = base.convert("RGBA")
    draw_arrow(img, size)
    mask = rounded_mask(size, int(size * 0.22))
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def main():
    build(192).save(os.path.join(HERE, "icon-192.png"))
    build(512).save(os.path.join(HERE, "icon-512.png"))
    build(512, maskable=True).save(os.path.join(HERE, "maskable-512.png"))
    build(180, opaque_square=True).save(os.path.join(HERE, "apple-touch-icon.png"))
    # favicon chico
    build(32, opaque_square=True).save(os.path.join(HERE, "favicon-32.png"))
    print("iconos generados:", os.listdir(HERE))


if __name__ == "__main__":
    main()
