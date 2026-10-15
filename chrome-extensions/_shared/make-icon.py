"""拡張機能のアイコンを作る
  python3 chrome-extensions/_shared/make-icon.py <出力フォルダ> <図柄> <色1> <色2>
  図柄: bubble / pin / collage / yen / wave / eye / clock
"""
import math
import sys
from PIL import Image, ImageDraw, ImageFilter

S = 512
WHITE = (255, 255, 255, 255)


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def background(c1, c2):
    grad = Image.new('RGBA', (S, S))
    px = grad.load()
    for y in range(S):
        for x in range(S):
            t = (x * 0.35 + y * 0.65) / S
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (255,)
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=112, fill=255)
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    img.paste(grad, (0, 0), mask)
    return img


def shadow(img, box, radius=30):
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([box[0] + 6, box[1] + 14, box[2] + 6, box[3] + 14], radius=radius, fill=(20, 20, 60, 90))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(14)))


def glyph_bubble(img, accent):
    shadow(img, (96, 110, 360, 300), 50)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([96, 110, 360, 300], radius=50, fill=WHITE)
    d.polygon([(150, 290), (140, 350), (205, 295)], fill=WHITE)
    for i, w in enumerate([170, 120]):
        d.rounded_rectangle([140, 165 + i * 52, 140 + w, 187 + i * 52], radius=11, fill=accent + (255,))
    d.rounded_rectangle([250, 280, 430, 410], radius=40, fill=(255, 214, 102, 255))
    d.polygon([(390, 400), (405, 448), (355, 405)], fill=(255, 214, 102, 255))
    d.line([(295, 345), (325, 372), (385, 318)], fill=WHITE, width=22, joint='curve')


def glyph_pin(img, accent):
    cx, cy, r = 256, 210, 118
    shadow(img, (cx - r + 20, cy - r + 10, cx + r - 20, cy + r + 40), r)
    d = ImageDraw.Draw(img)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)
    d.polygon([(cx - 92, cy + 76), (cx + 92, cy + 76), (cx, cy + 230)], fill=WHITE)
    d.ellipse([cx - 52, cy - 52, cx + 52, cy + 52], fill=accent + (255,))
    d.line([(cx - 24, cy + 2), (cx - 6, cy + 20), (cx + 28, cy - 16)], fill=WHITE, width=14, joint='curve')


def glyph_collage(img, accent):
    shadow(img, (100, 100, 412, 412), 26)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([100, 100, 412, 412], radius=26, fill=WHITE)
    light = tuple(min(255, int(c + (255 - c) * 0.72)) for c in accent) + (255,)
    d.rounded_rectangle([130, 130, 382, 220], radius=14, fill=accent + (255,))
    d.rounded_rectangle([130, 240, 246, 382], radius=14, fill=light)
    d.rounded_rectangle([266, 240, 382, 300], radius=14, fill=light)
    d.rounded_rectangle([266, 320, 382, 382], radius=14, fill=light)


def glyph_yen(img, accent):
    shadow(img, (128, 86, 384, 426), 34)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([128, 86, 384, 426], radius=34, fill=WHITE)
    d.rounded_rectangle([160, 118, 352, 196], radius=14, fill=accent + (255,))
    # ¥ の記号
    d.line([(222, 134), (256, 168), (290, 134)], fill=WHITE, width=12)
    d.line([(256, 166), (256, 188)], fill=WHITE, width=12)
    d.line([(232, 164), (280, 164)], fill=WHITE, width=8)
    light = tuple(min(255, int(c + (255 - c) * 0.7)) for c in accent) + (255,)
    for row in range(3):
        for col in range(3):
            x = 160 + col * 68
            y = 222 + row * 66
            d.rounded_rectangle([x, y, x + 52, y + 48], radius=12, fill=light)


def glyph_wave(img, accent):
    shadow(img, (96, 120, 416, 392), 30)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([96, 120, 416, 392], radius=30, fill=WHITE)
    light = tuple(min(255, int(c + (255 - c) * 0.7)) for c in accent) + (255,)
    heights = [70, 150, 100, 190, 60, 130]
    for i, hgt in enumerate(heights):
        x = 132 + i * 44
        d.rounded_rectangle([x, 356 - hgt, x + 28, 356], radius=8, fill=light)
    pts = [(146 + i * 44, 356 - hgt - 18) for i, hgt in enumerate(heights)]
    d.line(pts, fill=accent + (255,), width=16, joint='curve')
    for p in pts:
        d.ellipse([p[0] - 12, p[1] - 12, p[0] + 12, p[1] + 12], fill=accent + (255,))


def glyph_eye(img, accent):
    d = ImageDraw.Draw(img)
    pts = []
    for i in range(61):
        t = i / 60 * math.pi
        pts.append((256 + 170 * math.cos(math.pi - t), 256 - 105 * math.sin(t)))
    for i in range(61):
        t = i / 60 * math.pi
        pts.append((256 + 170 * math.cos(t), 256 + 105 * math.sin(t)))
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(sh).polygon([(x + 6, y + 14) for x, y in pts], fill=(20, 20, 60, 90))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(14)))
    d = ImageDraw.Draw(img)
    d.polygon(pts, fill=WHITE)
    d.ellipse([186, 186, 326, 326], fill=accent + (255,))
    d.ellipse([226, 226, 286, 286], fill=(25, 28, 40, 255))
    d.ellipse([238, 232, 258, 252], fill=WHITE)


def glyph_clock(img, accent):
    cx, cy, r = 256, 256, 150
    shadow(img, (cx - r, cy - r, cx + r, cy + r), r)
    d = ImageDraw.Draw(img)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)
    light = tuple(min(255, int(c + (255 - c) * 0.6)) for c in accent) + (255,)
    d.pieslice([cx - 118, cy - 118, cx + 118, cy + 118], start=-90, end=40, fill=light)
    d.line([(cx, cy), (cx, cy - 92)], fill=accent + (255,), width=20)
    d.line([(cx, cy), (cx + 66, cy + 40)], fill=accent + (255,), width=20)
    d.ellipse([cx - 18, cy - 18, cx + 18, cy + 18], fill=accent + (255,))


GLYPHS = {
    'bubble': glyph_bubble,
    'pin': glyph_pin,
    'collage': glyph_collage,
    'yen': glyph_yen,
    'wave': glyph_wave,
    'eye': glyph_eye,
    'clock': glyph_clock,
}


def main():
    out, glyph, c1, c2 = sys.argv[1], sys.argv[2], hex_rgb(sys.argv[3]), hex_rgb(sys.argv[4])
    img = background(c1, c2)
    GLYPHS[glyph](img, c1)
    for size in (16, 32, 48, 128):
        img.resize((size, size), Image.LANCZOS).save(f'{out}/icon{size}.png', optimize=True)
    if len(sys.argv) > 5:
        img.resize((256, 256), Image.LANCZOS).save(sys.argv[5])


if __name__ == '__main__':
    main()
