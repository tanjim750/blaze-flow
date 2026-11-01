"""Labelled approved-copy cases for the compare eval: posters and short clips.

Each case: the approved copy, what the artwork actually shows, and the seeded differences as
(finding type, key word). Clean cases differ from the approved copy only by styling (case,
line breaks, order, hyphen/space joins, ampersands, punctuation, small print), so every
finding on them is a false positive.
"""
T, M, MS, U = 'COPY_TYPO', 'COPY_MISMATCH', 'COPY_MISSING', 'COPY_UNEXPECTED'

SALE = 'Summer Sale\nUp to 50% off everything\nCold-brew coffee from £3.50\nTerms and conditions apply. Offer ends 31 August 2027.'
LAUNCH = 'The Autumn Collection\nHandmade in London since 1998\nShop now at northlight.studio'
EVENT = 'LIVE MUSIC\nSaturday 14 November, 8pm\nTickets £12 on the door'
CAFE = 'Fresh bread daily\nBaked every morning & served warm\nOpen 7am to 4pm'

# (id, approved, [(text, font, size, effect)], [(type, key)])
POSTERS = [
    ('clean-caps-breaks', SALE, [('SUMMER SALE', 'sans', 130, ''), ('UP TO 50% OFF', 'sans', 80, ''), ('EVERYTHING', 'sans', 80, ''),
                                 ('COLDBREW COFFEE FROM £3.50', 'text', 50, ''), ('Terms & conditions apply. Offer ends 31 August 2027.', 'text', 28, '')], []),
    ('clean-reordered', LAUNCH, [('Shop now at northlight.studio', 'text', 44, ''), ('THE AUTUMN COLLECTION', 'serif', 80, ''), ('Handmade in London since 1998', 'serif', 52, '')], []),
    ('clean-event', EVENT, [('Live Music', 'display', 130, ''), ('Saturday 14 November 8pm', 'text', 60, ''), ('Tickets £12 on the door', 'text', 52, '')], []),
    ('clean-cafe-script', CAFE, [('Fresh bread daily', 'script', 100, ''), ('Baked every morning and served warm', 'text', 52, ''), ('Open 7am to 4pm', 'text', 52, '')], []),
    ('clean-outline', LAUNCH, [('The Autumn Collection', 'sans', 100, 'outline'), ('Handmade in London since 1998', 'text', 52, ''), ('Shop now at northlight.studio', 'text', 44, '')], []),
    ('typo-headline', SALE, [('SUMER SALE', 'sans', 130, ''), ('Up to 50% off everything', 'text', 60, ''), ('Cold-brew coffee from £3.50', 'text', 50, ''),
                             ('Terms and conditions apply. Offer ends 31 August 2027.', 'text', 28, '')], [(T, 'sumer')]),
    ('mismatch-price', SALE, [('SUMMER SALE', 'sans', 130, ''), ('Up to 50% off everything', 'text', 60, ''), ('Cold-brew coffee from £4.50', 'text', 50, ''),
                              ('Terms and conditions apply. Offer ends 31 August 2027.', 'text', 28, '')], [(M, '£4.50')]),
    ('mismatch-date', EVENT, [('LIVE MUSIC', 'display', 130, ''), ('Saturday 15 November, 8pm', 'text', 60, ''), ('Tickets £12 on the door', 'text', 52, '')], [(M, '15')]),
    ('mismatch-word', CAFE, [('Fresh cake daily', 'serif', 100, ''), ('Baked every morning & served warm', 'text', 52, ''), ('Open 7am to 4pm', 'text', 52, '')], [(M, 'cake')]),
    ('missing-legal', SALE, [('SUMMER SALE', 'sans', 130, ''), ('Up to 50% off everything', 'text', 60, ''), ('Cold-brew coffee from £3.50', 'text', 50, '')], [(MS, 'terms')]),
    ('missing-line', LAUNCH, [('The Autumn Collection', 'serif', 90, ''), ('Handmade in London since 1998', 'serif', 52, '')], [(MS, 'shop')]),
    ('unexpected-line', EVENT, [('LIVE MUSIC', 'display', 130, ''), ('Saturday 14 November, 8pm', 'text', 60, ''), ('Tickets £12 on the door', 'text', 52, ''),
                                ('Free entry before 9pm', 'text', 52, '')], [(U, 'free')]),
    ('typo-and-missing', CAFE, [('Fresh bread dialy', 'serif', 100, ''), ('Baked every morning & served warm', 'text', 52, '')], [(T, 'dialy'), (MS, 'open')]),
    ('typo-legal-is-mismatch', SALE, [('SUMMER SALE', 'sans', 130, ''), ('Up to 50% off everything', 'text', 60, ''), ('Cold-brew coffee from £3.50', 'text', 50, ''),
                                      ('Terms and condtions apply. Offer ends 31 August 2027.', 'text', 30, '')], [(M, 'condtions')]),
    ('typo-two', LAUNCH, [('The Autum Collection', 'serif', 90, ''), ('Handmade in Londn since 1998', 'serif', 52, ''), ('Shop now at northlight.studio', 'text', 44, '')], [(T, 'autum'), (T, 'londn')]),
]

# (id, seconds, approved, elements as eval_video_set, [(type, key)])
CLIPS = [
    ('clip-clean-slide', 6, 'SUMMER SALE\nUp to 50% off everything',
     [('Summer Sale', 'sans', 120, 0.5, 5.5, 'slide', 200), ('UP TO 50% OFF EVERYTHING', 'text', 48, 1.5, 5.5, 'static', 380)], []),
    ('clip-clean-subtitles', 8, 'Welcome back to the studio. Today we are making something special. Stay until the end.',
     [('Welcome back to the studio', 'text', 40, 0.5, 3.0, 'subtitle', 640), ('Today we are making something special', 'text', 40, 3.2, 6.0, 'subtitle', 640),
      ('Stay until the end', 'text', 40, 6.2, 7.8, 'subtitle', 640)], []),
    ('clip-clean-fade', 6, 'NORTHLIGHT STUDIO\nwww.northlight.studio',
     [('Northlight Studio', 'sans', 100, 0.5, 5.5, 'fade', 220), ('www.northlight.studio', 'text', 44, 1.0, 5.5, 'static', 380)], []),
    ('clip-typo-title', 6, 'PREMIUM QUALITY\nMade in London',
     [('PREMUIM QUALITY', 'sans', 110, 0.5, 5.0, 'slide', 220), ('Made in London', 'text', 48, 1.0, 5.0, 'static', 400)], [(T, 'premuim')]),
    ('clip-mismatch-sub', 8, 'Thanks for watching. You will receive a free gift. See you next week.',
     [('Thanks for watching', 'text', 40, 0.5, 2.8, 'subtitle', 640), ('You will receive a free mug', 'text', 40, 3.0, 5.6, 'subtitle', 640),
      ('See you next week', 'text', 40, 5.8, 7.8, 'subtitle', 640)], [(M, 'mug')]),
    ('clip-missing-endcard', 6, 'GRAND OPENING\nJoin us on Saturday at noon\nwww.northlight.studio',
     [('Grand Opening', 'serif', 100, 0.5, 5.5, 'zoom', 220), ('Join us on Saturday at noon', 'text', 40, 1.0, 5.5, 'subtitle', 640)], [(MS, 'www.northlight.studio')]),
    ('clip-unexpected-price', 6, 'BIG SALE\nLimited time only',
     [('BIG SALE', 'display', 100, 0.5, 5.5, 'slide', 200), ('Limited time only', 'text', 52, 1.0, 5.5, 'fade', 420), ('Now £9.99', 'text', 52, 2.0, 5.5, 'static', 520)], [(U, '£9.99')]),
    ('clip-reordered', 7, 'Step one: plan. Step two: shoot. Step three: edit.',
     [('Step three: edit', 'text', 52, 0.5, 2.0, 'static', 300), ('Step one: plan', 'text', 52, 2.5, 4.0, 'static', 300), ('Step two: shoot', 'text', 52, 4.5, 6.5, 'static', 300)], []),
]
