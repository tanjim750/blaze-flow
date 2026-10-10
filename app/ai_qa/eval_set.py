"""A labelled synthetic poster set for AI Visual QA (rendered on the fly, nothing checked in).

Each case is a list of text lines (with style) and the seeded typos it contains. Clean cases
deliberately carry brand terms, URLs, handles, acronyms, all-caps and stylised fonts, so they
measure false positives; typo cases measure precision and recall.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT_DIRS = ('/usr/share/fonts/truetype/sand-box/google', '/usr/share/fonts/truetype')
FONTS = {
    'sans': ('Anton/Anton-Regular.ttf', 'dejavu/DejaVuSans-Bold.ttf'),
    'text': ('Hind/Hind-SemiBold.ttf', 'dejavu/DejaVuSans.ttf'),
    'script': ('Kalam/Kalam-Regular.ttf', 'dejavu/DejaVuSerif-Italic.ttf'),
    'display': ('Luckiest Guy/LuckiestGuy-Regular.ttf', 'dejavu/DejaVuSans-Bold.ttf'),
    'serif': ('Fraunces/Fraunces-VariableFont_SOFT,WONK,opsz,wght.ttf', 'dejavu/DejaVuSerif.ttf'),
    'mono': ('Rubik Mono One/RubikMonoOne-Regular.ttf', 'dejavu/DejaVuSansMono-Bold.ttf'),
    'shrikhand': ('Shrikhand/Shrikhand-Regular.ttf', 'dejavu/DejaVuSerif-Bold.ttf'),
}
GLOSSARY = frozenset({'northlight', 'blazeflow', 'glowup', 'kwik'})

# (id, [(text, font, size, effect)], seeded_typos)
CASES = [
    ('clean-sans', [('SUMMER SALE', 'sans', 130, ''), ('Up to 50% off everything', 'text', 56, '')], []),
    ('clean-brand-url', [('NORTHLIGHT STUDIO', 'sans', 110, ''), ('Visit www.northlight.studio', 'text', 48, ''), ('@northlight #spring', 'text', 48, '')], []),
    ('clean-legal', [('BIG WINTER DEALS', 'sans', 120, ''), ('Terms and conditions apply. Offer ends 31 December 2026.', 'text', 26, ''), ('Subject to availability while stocks last.', 'text', 26, '')], []),
    ('clean-script', [('Happy Holidays', 'script', 110, ''), ('from all of us at Blazeflow', 'script', 60, '')], []),
    ('clean-display', [('GAME NIGHT', 'display', 140, ''), ('Friday at eight', 'display', 70, '')], []),
    ('clean-serif', [('The Autumn Collection', 'serif', 90, ''), ('Handmade in London', 'serif', 60, '')], []),
    ('clean-outline', [('FLASH SALE', 'sans', 150, 'outline'), ('Today only', 'text', 64, '')], []),
    ('clean-lowcontrast', [('Quiet mornings', 'serif', 100, 'lowcontrast'), ('Coffee and pastries', 'text', 60, 'lowcontrast')], []),
    ('clean-rotated', [('NEW ARRIVALS', 'sans', 120, 'rotate'), ('Shop the latest styles', 'text', 56, '')], []),
    ('clean-acronyms', [('FREE UK DELIVERY', 'sans', 110, ''), ('Order by 5pm for next day', 'text', 52, ''), ('FAQ  T&Cs  VAT included', 'text', 44, '')], []),
    ('clean-stylised', [('GLOWUP SEASON', 'shrikhand', 110, ''), ('Get Kwik results', 'text', 60, '')], []),
    ('clean-mono', [('LAUNCH DAY', 'mono', 100, ''), ('Join the waitlist today', 'text', 52, '')], []),
    ('clean-british', [('Colour your world', 'serif', 90, ''), ('Organise your favourite things', 'text', 56, '')], []),
    ('clean-event', [('LIVE MUSIC', 'display', 130, ''), ('Saturday 14 November', 'text', 60, ''), ('Tickets at blazeflow.app/events', 'text', 44, '')], []),
    ('clean-quote', [('Make it happen', 'script', 110, ''), ('Every single day', 'text', 60, '')], []),
    ('typo-premium', [('SUMMER SALE', 'sans', 130, ''), ('PREMUIM QUALITY', 'sans', 110, '')], ['PREMUIM']),
    ('typo-receive', [('Recieve a free gift', 'text', 80, ''), ('with every order', 'text', 60, '')], ['Recieve']),
    ('typo-accommodate', [('We can acommodate', 'serif', 80, ''), ('groups of any size', 'serif', 60, '')], ['acommodate']),
    ('typo-script', [('Happy Birthdya', 'script', 110, ''), ('Love from all of us', 'script', 60, '')], ['Birthdya']),
    ('typo-display', [('GRAND OPENNING', 'display', 120, ''), ('Join us this weekend', 'text', 60, '')], ['OPENNING']),
    ('typo-legal', [('BLACK FRIDAY', 'sans', 120, ''), ('Terms and condtions apply. While stocks last.', 'text', 28, '')], ['condtions']),
    ('typo-two', [('Exclusive offre', 'serif', 90, ''), ('Limited tiem only', 'text', 64, '')], ['offre', 'tiem']),
    ('typo-outline', [('MEGA DISCOUNTT', 'sans', 130, 'outline'), ('Ends Sunday', 'text', 60, '')], ['DISCOUNTT']),
    ('typo-rotated', [('BACK TO SCHOOL', 'sans', 110, 'rotate'), ('Everything you need for the new semster', 'text', 44, '')], ['semster']),
    ('typo-brand', [('NORTHLIGHT STUDIO', 'sans', 100, ''), ('Profesional video editing', 'text', 56, '')], ['Profesional']),
    ('typo-mono', [('WELCOME BACK', 'mono', 90, ''), ('We missed you alot', 'text', 60, '')], ['alot']),
    ('typo-serif', [('The Winter Colection', 'serif', 90, ''), ('Handmade in London', 'serif', 60, '')], ['Colection']),
    ('typo-lowcontrast', [('Fresh bread dialy', 'text', 80, 'lowcontrast'), ('Baked every morning', 'text', 60, '')], ['dialy']),
    ('typo-event', [('LIVE MUSIC', 'display', 130, ''), ('Saturday 14 Novemebr', 'text', 60, '')], ['Novemebr']),
    ('typo-shrikhand', [('Delicous Treats', 'shrikhand', 100, ''), ('Made fresh today', 'text', 60, '')], ['Delicous']),
]


def _font(kind, size):
    for name in FONTS[kind]:
        for base in FONT_DIRS:
            path = Path(base) / name
            if path.exists():
                font = ImageFont.truetype(str(path), size)
                return font
    return ImageFont.load_default(size)


def render(case, path, width=1080, height=1350):
    _, lines, _ = case
    image = Image.new('RGB', (width, height), (22, 28, 52))
    y = 160
    for text, kind, size, effect in lines:
        font = _font(kind, size)
        while ImageDraw.Draw(image).textlength(text, font=font) > width - 120 and size > 18:
            size -= 4
            font = _font(kind, size)
        fill = (255, 255, 255)
        layer = Image.new('RGBA', (width, size * 2), (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        if effect == 'outline':
            draw.text((60, 10), text, font=font, fill=(22, 28, 52), stroke_width=4, stroke_fill=(255, 210, 0))
        elif effect == 'lowcontrast':
            draw.text((60, 10), text, font=font, fill=(70, 80, 112))
        else:
            draw.text((60, 10), text, font=font, fill=fill)
        if effect == 'rotate':
            layer = layer.rotate(6, expand=False, resample=Image.BICUBIC)
        image.paste(layer, (0, y), layer)
        y += int(size * 1.9)
    image.save(path)
    return path
