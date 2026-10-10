"""A labelled synthetic short-video set for AI Visual QA (rendered on the fly with Pillow + ffmpeg).

Each case lists timed text elements with a motion (static, slide, fade, zoom, subtitle) and the
seeded typos with the time window they are on screen. Clean cases measure false positives
across the many frames a video produces; typo cases measure precision, recall and timing.
"""
import shutil
import subprocess

from PIL import Image, ImageDraw

from .eval_set import _font

FPS = 25
SIZE = (1280, 720)

# element: (text, font, size, start_s, end_s, motion, y)
CASES = [
    ('clean-slide-title', 6, [('SUMMER SALE', 'sans', 120, 0.5, 5.5, 'slide', 200), ('Up to 50% off everything', 'text', 48, 1.5, 5.5, 'static', 380)], []),
    ('clean-subtitles', 8, [('Welcome back to the studio', 'text', 40, 0.5, 3.0, 'subtitle', 640), ('Today we are making something special', 'text', 40, 3.2, 6.0, 'subtitle', 640), ('Stay until the end', 'text', 40, 6.2, 7.8, 'subtitle', 640)], []),
    ('clean-endcard-brand', 6, [('NORTHLIGHT STUDIO', 'sans', 100, 0.5, 5.5, 'fade', 220), ('www.northlight.studio', 'text', 44, 1.0, 5.5, 'static', 380), ('@northlight #spring', 'text', 44, 1.0, 5.5, 'static', 450)], []),
    ('clean-zoom-script', 6, [('Happy Holidays', 'script', 110, 0.5, 5.5, 'zoom', 260)], []),
    ('typo-slide-title', 6, [('PREMUIM QUALITY', 'sans', 110, 0.5, 5.0, 'slide', 220), ('Made in London', 'text', 48, 1.0, 5.0, 'static', 400)], [('PREMUIM', 0.5, 5.0)]),
    ('typo-fade-title', 6, [('Exclusive Colection', 'serif', 96, 1.0, 5.0, 'fade', 240)], [('Colection', 1.0, 5.0)]),
    ('typo-subtitle', 8, [('Thanks for watching', 'text', 40, 0.5, 2.8, 'subtitle', 640), ('You will recieve a free gift', 'text', 40, 3.0, 5.6, 'subtitle', 640), ('See you next week', 'text', 40, 5.8, 7.8, 'subtitle', 640)], [('recieve', 3.0, 5.6)]),
    ('typo-two-moving', 7, [('BIGEST SALE EVER', 'display', 100, 0.5, 4.0, 'slide', 200), ('Limited tiem only', 'text', 52, 4.2, 6.8, 'fade', 420)], [('BIGEST', 0.5, 4.0), ('tiem', 4.2, 6.8)]),
    ('typo-short-flash', 5, [('FREE SHIPING', 'sans', 110, 2.0, 3.0, 'static', 280)], [('SHIPING', 2.0, 3.0)]),
    ('typo-zoom-and-sub', 7, [('Grand Openning', 'serif', 100, 0.5, 4.0, 'zoom', 220), ('Join us on Saturday at noon', 'text', 40, 1.0, 6.5, 'subtitle', 640)], [('Openning', 0.5, 4.0)]),
]


def _frame(case, t):
    _, _, elements, _ = case
    width, height = SIZE
    shade = int(30 + 12 * (t % 4) / 4)
    image = Image.new('RGB', SIZE, (shade, 28, 52))
    for text, kind, size, start, end, motion, y in elements:
        if not start <= t <= end:
            continue
        progress = (t - start) / max(end - start, 0.01)
        alpha = 255
        scale = 1.0
        x = 80
        if motion == 'slide':
            x = int(80 + 260 * progress)
        elif motion == 'fade':
            alpha = int(255 * min(1.0, (t - start) / 0.6, (end - t) / 0.6))
        elif motion == 'zoom':
            scale = 0.8 + 0.3 * progress
        font = _font(kind, max(16, int(size * scale)))
        draw = ImageDraw.Draw(image)
        length = draw.textlength(text, font=font)
        if motion == 'subtitle':
            x = int((width - length) / 2)
            draw.rectangle([x - 16, y - 8, x + length + 16, y + size + 14], fill=(0, 0, 0))
        layer = Image.new('RGBA', SIZE, (0, 0, 0, 0))
        ImageDraw.Draw(layer).text((x, y), text, font=font, fill=(255, 255, 255, max(alpha, 0)))
        image.paste(layer, (0, 0), layer)
    return image


def render(case, path):
    case_id, seconds, _, _ = case
    process = subprocess.Popen(
        [shutil.which('ffmpeg'), '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
         '-s', f'{SIZE[0]}x{SIZE[1]}', '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast',
         '-pix_fmt', 'yuv420p', '-crf', '20', str(path)],
        stdin=subprocess.PIPE,
    )
    for index in range(int(seconds * FPS)):
        process.stdin.write(_frame(case, index / FPS).tobytes())
    process.stdin.close()
    process.wait()
    return path
