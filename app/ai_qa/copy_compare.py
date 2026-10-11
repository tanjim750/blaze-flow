"""Approved-copy compare: align what the OCR read to the copy the client signed off.

Pure functions, no database (the eval and the pipeline both call ``compare``).

How it works
------------
* Both sides become word tokens, normalised so styling is not a difference: case, line
  breaks, punctuation around words, curly vs straight quotes, ``&`` vs ``and``, and words
  split or joined by spaces/hyphens ("cold-brew" = "cold brew" = "COLDBREW").
* Every OCR text unit (an image line, or a video text track) is aligned on its own to the
  best-matching window of the approved copy. Units are matched independently, so the order
  text animates on in a video (or where it sits on a poster) does not matter.
* Inside a matched unit, differences are sorted into finding types instead of all being
  "typos":
    - ``COPY_TYPO``: one word close in spelling to the approved word ("Sumer" for "Summer").
    - ``COPY_MISMATCH``: substantive: a different word, number, price or date, or several
      words changed. Legal/small-print lines are always mismatches, never "typos", because
      the wording must be exactly what legal approved.
    - ``COPY_UNEXPECTED``: words or a whole line not in the approved copy.
    - ``COPY_MISSING``: approved words that were never seen anywhere.
"""
import hashlib
import re
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher

TYPO, MISMATCH, MISSING, UNEXPECTED = 'COPY_TYPO', 'COPY_MISMATCH', 'COPY_MISSING', 'COPY_UNEXPECTED'
CATEGORIES = (TYPO, MISMATCH, MISSING, UNEXPECTED)

_QUOTES = str.maketrans({'‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '·': ' ', '•': ' ', '|': ' '})
_STRIP = '.,;:!?"\'()[]{}<>*…-–—_/\\'
LEGAL = re.compile(r"\b(terms|conditions|t&cs?|subject to|apply|applies|while stocks last|offer ends|valid until|"
                   r"excludes?|exclusions?|participating|see .* for details|rrp|vat|registered|trademark|©|®|™)\b", re.I)
CONFUSABLE = (('0', 'o'), ('1', 'l'), ('1', 'i'), ('l', 'i'), ('5', 's'), ('8', 'b'), ('rn', 'm'), ('vv', 'w'), ('cl', 'd'))


def norm_word(word):
    word = unicodedata.normalize('NFKC', word).translate(_QUOTES).casefold().strip(_STRIP)
    if word == '&':
        return 'and'
    word = re.sub(r'(\d)\.00$', r'\1', word)  # £4.00 = £4
    return word


def pairs(text):
    """(normalised, as written) for each word; hyphenated words split so "cold-brew" = "cold brew"."""
    out = []
    for raw in unicodedata.normalize('NFKC', text).translate(_QUOTES).split():
        word = norm_word(raw)
        if not word:
            continue
        shown = raw.strip(_STRIP) or raw
        if '-' in word and not any(ch.isdigit() for ch in word):
            out.extend((part, part_shown) for part, part_shown in zip(
                [p for p in word.split('-') if p], [p for p in shown.split('-') if p] or [shown]))
        else:
            out.append((word, shown))
    return out


def tokens(text):
    return [word for word, _ in pairs(text)]


def _sim(a, b):
    return SequenceMatcher(None, a, b, autojunk=False).ratio()


def _edit(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _confusable_only(a, b):
    for wrong, right in CONFUSABLE:
        if a.replace(wrong, right) == b.replace(wrong, right):
            return True
        if a.replace(right, wrong) == b or b.replace(right, wrong) == a:
            return True
    return False


def _close(a, b):
    """Close enough in spelling to call it a typo of the approved word (not a different word)."""
    if _confusable_only(a, b):
        return True  # "C0OL" for "COOL": a reading slip or a typo, not a different word
    if any(ch.isdigit() for ch in a + b):
        return False  # 20% vs 25%, £4 vs £5, 14 vs 15 Nov: never "just a typo"
    distance = _edit(a, b)
    longest = max(len(a), len(b))
    return longest >= 4 and (distance <= 1 or (distance <= 2 and longest >= 6) or _sim(a, b) >= 0.8)


@dataclass
class Unit:
    """One piece of text the OCR read: an image line, or a video text track."""
    text: str
    confidence: float
    region: dict = field(default_factory=dict)
    start_ms: int | None = None
    end_ms: int | None = None
    track: list = field(default_factory=list)
    sightings: int = 1
    video: bool = False

    words: list = field(default_factory=list)

    def __post_init__(self):
        self.words = tokens(self.text)


@dataclass
class ApprovedText:
    text: str
    words: list = field(init=False)
    legal: list = field(init=False)  # per word: is it in a legal / small-print block
    shown: list = field(init=False)  # per word: as the copy writes it

    def __post_init__(self):
        self.words, self.legal, self.shown = [], [], []
        for block in re.split(r'\n\s*\n|\n', self.text):
            found = pairs(block)
            words = [w for w, _ in found]
            is_legal = bool(LEGAL.search(block)) and len(words) >= 4
            self.words.extend(words)
            self.shown.extend(shown for _, shown in found)
            self.legal.extend([is_legal] * len(words))


def respell(words, approved):
    """Undo styling joins/splits against the approved copy: "COLDBREW" -> cold brew, "SUM MER" -> summer."""
    vocab = set(approved.words)
    joined = {}
    for size in (2, 3):
        for i in range(len(approved.words) - size + 1):
            joined.setdefault(''.join(approved.words[i:i + size]), approved.words[i:i + size])
    out, i = [], 0
    while i < len(words):
        w = words[i]
        if w not in vocab and w in joined:
            out.extend(joined[w]); i += 1; continue
        for size in (3, 2):
            glued = ''.join(words[i:i + size])
            if len(words[i:i + size]) == size and glued in vocab and w not in vocab:
                out.append(glued); i += size; break
        else:
            out.append(w); i += 1
    return out


def _window(approved, unit_words, covered):
    """Best approved window for a unit: (start, end, score), tolerant of typos and order."""
    n, m = len(approved.words), len(unit_words)
    if not n or not m:
        return None
    # Score with each unit word mapped to its closest approved word, so a typo still anchors.
    vocab = set(approved.words)
    mapped = []
    for w in unit_words:
        if w in vocab:
            mapped.append(w)
        else:
            best = max(vocab, key=lambda v: _sim(w, v))
            mapped.append(best if _close(w, best) else w)
    best = None
    for length in {max(1, m + d) for d in (-2, -1, 0, 1, 2)}:
        for start in range(0, max(1, n - length + 1)):
            window = approved.words[start:start + length]
            ops = SequenceMatcher(None, window, mapped, autojunk=False).get_opcodes()
            matched = sum(i2 - i1 for tag, i1, i2, _, _ in ops if tag == 'equal')
            dangling = sum((i2 - i1) + (j2 - j1) for tag, i1, i2, j1, j2 in ops if tag in ('delete', 'insert'))
            # Share of the unit found here, nudged towards windows of the unit's own length and
            # towards word-for-word substitutions over a skipped word plus an extra one.
            score = matched / m - 0.03 * abs(len(window) - m) - 0.01 * dangling
            reused = sum(covered[start:start + length]) / max(1, len(window))
            score -= 0.08 * reused  # repeated text: prefer an occurrence not yet seen
            if best is None or score > best[2] + 1e-9:
                best = (start, start + len(window), score)
    return best


def _row(category, band, detected, suggested, unit, explanation, decision):
    key_basis = f'copy:{category}:{detected.casefold()}:{suggested.casefold()}'
    if unit is not None and unit.start_ms is not None:
        key_basis += f':{unit.start_ms // 2000}'
    return {
        'key': hashlib.sha256(key_basis.encode()).hexdigest(),
        'category': category, 'band': band,
        'detected_text': detected[:500], 'suggested_text': suggested[:500],
        'context_text': (unit.text if unit else '')[:1000], 'explanation': explanation[:500],
        'ocr_confidence': round(unit.confidence, 3) if unit else 0.0, 'decision_confidence': round(decision, 3),
        'region': unit.region if unit else {}, 'start_time_ms': unit.start_ms if unit else None,
        'end_time_ms': unit.end_ms if unit else None, 'track': unit.track if unit else [],
    }


def _diff_unit(approved, unit, start, end):
    """Findings inside one matched unit, plus the approved indices it covers."""
    window = approved.words[start:end]
    words = unit.words
    rows, seen = [], set()
    ops = SequenceMatcher(None, window, words, autojunk=False).get_opcodes()
    for tag, i1, i2, j1, j2 in ops:
        a, b = window[i1:i2], words[j1:j2]
        if tag == 'equal':
            seen.update(range(start + i1, start + i2))
            continue
        if tag == 'delete':
            continue  # approved words not in this unit: may be on another line/track
        if tag == 'replace' and ''.join(a) == ''.join(b):
            seen.update(range(start + i1, start + i2))  # "cold brew" vs "coldbrew": styling
            continue
        legal = any(approved.legal[start + i1:start + max(i2, i1 + 1)])
        if tag == 'insert':
            if unit.video and j1 == len(words) - 1 and len(b) == 1 and len(b[0]) <= 2:
                continue  # half-revealed word on a typewriter animation
            rows.append(_row(UNEXPECTED, 'medium' if unit.confidence >= 0.85 else 'low', ' '.join(b), '', unit,
                             'Not in the approved copy here. Check it was meant to be added.', 0.6))
            continue
        seen.update(range(start + i1, start + i2))
        if len(a) == len(b):
            for k, (wa, wb) in enumerate(zip(a, b)):
                shown = approved.shown[start + i1 + k]
                if wa == wb:
                    continue
                if unit.video and wa.startswith(wb):
                    continue  # still revealing
                if _confusable_only(wb, wa) and (len(wa) <= 3 or (any(c.isdigit() for c in wb) and not any(c.isdigit() for c in wa))):
                    continue  # "0FF" for "OFF", "T0" for "TO": the OCR, not the artwork
                if legal:
                    rows.append(_row(MISMATCH, 'medium', wb, shown, unit,
                                     'Legal / small-print wording differs from the approved copy. It must match exactly.', 0.7))
                elif _close(wb, wa):
                    shaky = _confusable_only(wb, wa) or unit.confidence < 0.85
                    rows.append(_row(TYPO, 'low' if shaky else 'high', wb, shown, unit,
                                     ('Could be a reading slip (similar-looking letters). ' if shaky else '') +
                                     f'Approved copy says “{shown}”.', 0.55 if shaky else 0.9))
                else:
                    numeric = any(ch.isdigit() for ch in wa + wb)
                    rows.append(_row(MISMATCH, 'high' if unit.confidence >= 0.8 else 'medium', wb, shown, unit,
                                     ('A number, price or date differs from the approved copy.' if numeric
                                      else 'A different word from the approved copy.'), 0.85))
        else:
            rows.append(_row(MISMATCH, 'medium', ' '.join(b), ' '.join(approved.shown[start + i1:start + i2]), unit,
                             'This wording differs from the approved copy.', 0.7))
    return rows, seen


def compare(approved_text, units):
    """Finding rows for these OCR units against the approved copy."""
    approved = ApprovedText(approved_text)
    covered = [False] * len(approved.words)
    rows, results = [], []
    # Longest, most confident units first, so they claim their text before fragments do.
    for unit in sorted(units, key=lambda u: (-len(u.words), -u.confidence)):
        unit.words = respell(unit.words, approved)
        words = unit.words
        if not words or (unit.confidence < 0.5 and len(''.join(words)) < 6):
            continue
        match = _window(approved, words, covered)
        threshold = 0.7 if len(words) == 1 else 0.5
        if match is None or match[2] < threshold:
            results.append((unit, None, []))
            continue
        found, seen = _diff_unit(approved, unit, match[0], match[1])
        for index in seen:
            covered[index] = True
        results.append((unit, match, found))

    # Video: a misread variant of a track that also reads cleanly at the same time is OCR
    # noise, not a second version of the copy.
    clean = [(u, m) for u, m, f in results if m is not None and not f]
    for unit, match, found in results:
        if found and unit.video and any(
            c.sightings >= max(2, unit.sightings) and _overlaps(c, unit) and _sim(' '.join(c.words), ' '.join(unit.words)) >= 0.8
            for c, _ in clean
        ):
            continue
        if match is None:
            if unit.video and any(_overlaps(c, unit) and _sim(' '.join(c.words), ' '.join(unit.words)) >= 0.6 for c, _ in clean):
                continue
            rows.append(_row(UNEXPECTED, 'medium' if unit.confidence >= 0.85 and len(unit.words) >= 2 else 'low',
                             unit.text.strip(), '', unit, 'This text is not in the approved copy.', 0.6))
            continue
        rows.extend(found)

    # Approved words never seen anywhere, grouped into runs.
    run = []
    for index, word in enumerate(approved.words + [None]):
        if word is not None and not covered[index]:
            run.append(index)
            continue
        if run:
            phrase = ' '.join(approved.shown[i] for i in run)
            legal = any(approved.legal[i] for i in run)
            band = 'high' if len(run) >= 3 or legal else ('low' if len(run) == 1 and len(phrase) <= 3 else 'medium')
            rows.append(_row(MISSING, band, '', phrase, None,
                             ('Legal line from the approved copy not found.' if legal
                              else 'In the approved copy but not found in the artwork.'), 0.75 if band == 'high' else 0.6))
            run = []
    return rows


def _overlaps(a, b):
    if a.start_ms is None or b.start_ms is None:
        return True
    return a.start_ms <= (b.end_ms or b.start_ms) + 500 and b.start_ms <= (a.end_ms or a.start_ms) + 500


def _box(polygon):
    xs = [p[0] for p in polygon] or [0]
    ys = [p[1] for p in polygon] or [0]
    return {'x': min(xs), 'y': min(ys), 'width': max(xs) - min(xs), 'height': max(ys) - min(ys)}


def image_units(lines):
    return [Unit(text=line.text, confidence=line.confidence, region=_box(line.polygon)) for line in lines]


def video_units(observed, gap_ms=1500):
    """Group video OCR lines into text tracks: same normalised text, continuous in time."""
    groups = {}
    for t in sorted(observed):
        for line in observed[t]:
            key = ' '.join(tokens(line.text))
            if not key:
                continue
            groups.setdefault(key, []).append((t, line))
    units = []
    for key, sightings in groups.items():
        spans = [[sightings[0]]]
        for item in sightings[1:]:
            if item[0] - spans[-1][-1][0] > gap_ms:
                spans.append([])
            spans[-1].append(item)
        for span in spans:
            best = max(span, key=lambda s: s[1].confidence)[1]
            units.append(Unit(
                text=best.text, confidence=sum(s[1].confidence for s in span) / len(span), region=_box(best.polygon),
                start_ms=span[0][0], end_ms=span[-1][0], sightings=len(span), video=True,
                track=[{'t': t, **_box(line.polygon)} for t, line in span][:200],
            ))
    return units


def approved_vocabulary(text):
    """Every approved word: in Proofread + Compare runs these are never spelling mistakes."""
    return frozenset(tokens(text))
