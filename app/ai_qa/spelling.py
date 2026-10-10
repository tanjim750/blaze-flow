"""Spelling decisions for OCR'd words: a cost-free deterministic cascade.

Order matters and is the whole point (each step only sees what the previous let through):

1. glossary / approved terms (workspace + project) never get flagged;
2. URLs, e-mail addresses, @handles, #hashtags, numbers, short acronyms are skipped;
3. a word Hunspell (en_GB or en_US) or the SymSpell frequency list knows is fine;
4. a word that becomes a real word by undoing a classic OCR confusion (0/O, 1/l/I, rn/m…)
   is reported as ``OCR_UNCERTAIN``, never as a certain spelling error;
5. anything left with a close SymSpell suggestion is a ``POSSIBLE_SPELLING_ERROR``.

OCR confidence and the spelling decision's confidence are kept separate all the way through.
"""
import hashlib
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from pathlib import Path

from django.conf import settings

URL_RE = re.compile(r'^(https?://|www\.)|\.(com|co|uk|org|net|io|app|ai|dev|tv|me|shop|store|studio)(/|$)', re.I)
NUMBER_UNIT_RE = re.compile(r'^\d+([.,:]\d+)?(am|pm|st|nd|rd|th|h|hr|hrs|k|m|mm|cm|km|kg|g|ml|l|s|x|p|gb|mb|tb|mph|fps|%)?$', re.I)
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
WORD_STRIP = '\'"“”‘’.,:;!?()[]{}<>«»*_~…–—-/\\|'
CONFUSIONS = (
    ('0', 'o'), ('1', 'l'), ('1', 'i'), ('5', 's'), ('8', 'b'), ('|', 'l'), ('!', 'i'),
    ('rn', 'm'), ('vv', 'w'), ('cl', 'd'), ('l', 'i'), ('i', 'l'), ('ii', 'u'),
)

HIGH_OCR = 0.90
MEDIUM_OCR = 0.75


@dataclass
class Candidate:
    category: str
    band: str
    detected_text: str
    suggested_text: str
    context_text: str
    explanation: str
    ocr_confidence: float
    decision_confidence: float
    region: dict

    @property
    def dedupe_key(self):
        box = self.region
        coarse = f"{round(box.get('x', 0) * 20)}:{round(box.get('y', 0) * 20)}"
        raw = f'{self.category}|{normalize(self.detected_text)}|{coarse}'
        return hashlib.sha256(raw.encode()).hexdigest()


def normalize(text):
    return unicodedata.normalize('NFKC', text).casefold().strip(WORD_STRIP + ' ')


@lru_cache(maxsize=1)
def _hunspell():
    from spylls.hunspell import Dictionary

    loaded = []
    for name in ('en_GB', 'en_US'):
        for folder in settings.AI_QA_HUNSPELL_DIRS:
            base = Path(folder) / name
            if base.with_suffix('.dic').exists():
                loaded.append(Dictionary.from_files(str(base)))
                break
    return loaded


@lru_cache(maxsize=1)
def _symspell():
    from symspellpy import SymSpell

    sym = SymSpell(max_dictionary_edit_distance=2, prefix_length=7)
    path = resources.files('symspellpy') / 'frequency_dictionary_en_82_765.txt'
    sym.load_dictionary(str(path), term_index=0, count_index=1)
    return sym


def _is_compound(word):
    """waitlist, skincare, lookbook: two dictionary words of 4+ letters run together.

    Four, not three: short fragments ('sem' + 'ster') would wave real typos through.
    """
    lower = word.lower()
    return any(
        _known_exact(lower[:i]) and _known_exact(lower[i:])
        for i in range(4, len(lower) - 3)
    )


@lru_cache(maxsize=50_000)
def _known_exact(word):
    if word in _symspell().words:
        return True
    return any(d.lookup(word) for d in _hunspell())


@lru_cache(maxsize=50_000)
def is_known(word):
    if not word:
        return True
    lower = word.lower()
    if lower in _symspell().words:
        return True
    variants = {word, lower, lower.capitalize()}
    return any(d.lookup(v) for d in _hunspell() for v in variants)


def _match_case(template, word):
    if template.isupper():
        return word.upper()
    if template[:1].isupper():
        return word[:1].upper() + word[1:]
    return word


def _confusable_fix(word):
    lower = word.lower()
    for wrong, right in CONFUSIONS:
        if wrong in lower:
            fixed = lower.replace(wrong, right)
            if fixed != lower and fixed.isalpha() and is_known(fixed):
                return _match_case(word, fixed)
    return None


def _suggest(word):
    from symspellpy import Verbosity

    lower = word.lower()
    hits = _symspell().lookup(lower, Verbosity.CLOSEST, max_edit_distance=2, transfer_casing=False)
    hits = [h for h in hits if h.term != lower]
    if not hits:
        return None, None
    best = max(hits, key=lambda h: h.count)
    return _match_case(word, best.term), best.distance


def _skip(token):
    if len(token) < 3:
        return True
    if token[0] in '@#' or URL_RE.search(token) or EMAIL_RE.match(token):
        return True
    if NUMBER_UNIT_RE.match(token) or '&' in token:  # 5pm, 3rd, 24h, 4K; T&Cs, R&D
        return True
    if any(ch.isdigit() for ch in token) and not _confusable_candidate(token):
        return True
    if token.isupper() and len(token) <= 4:  # acronyms: UK, NASA, BOGO
        return True
    if not any(ch.isalpha() for ch in token):
        return True
    return False


def _confusable_candidate(token):
    letters = sum(ch.isalpha() for ch in token)
    return letters >= 2 and letters >= len(token) - 2


def _band(ocr, decision):
    if ocr >= HIGH_OCR and decision >= 0.85:
        return 'high'
    if ocr >= MEDIUM_OCR and decision >= 0.6:
        return 'medium'
    return 'low'


def _word_box(polygon, start, end, length):
    xs = [p[0] for p in polygon] or [0]
    ys = [p[1] for p in polygon] or [0]
    left, right, top, bottom = min(xs), max(xs), min(ys), max(ys)
    width = right - left
    length = max(length, 1)
    x0 = left + width * start / length
    x1 = left + width * end / length
    clamp = lambda v: max(0.0, min(1.0, v))  # noqa: E731
    return {
        'x': round(clamp(x0), 4), 'y': round(clamp(top), 4),
        'width': round(clamp(x1) - clamp(x0), 4), 'height': round(clamp(bottom) - clamp(top), 4),
    }


def tokens(text):
    for match in re.finditer(r'\S+', text):
        raw = match.group(0)
        lead = len(raw) - len(raw.lstrip(WORD_STRIP))
        core = raw.strip(WORD_STRIP)
        if core.endswith(("'s", '’s')):
            core = core[:-2]
        if core:
            start = match.start() + lead
            yield core, start, start + len(core)


def check_line(line, *, glossary=frozenset(), min_ocr=None):
    min_ocr = settings.AI_QA_MIN_OCR_CONFIDENCE if min_ocr is None else min_ocr
    found = []
    glossary_tokens = {part for term in glossary for part in term.split()}
    for index, (word, start, end) in enumerate(tokens(line.text)):
        norm = normalize(word)
        if norm in glossary or norm in glossary_tokens or _skip(word):
            continue
        parts = [p for p in re.split(r"[-’']", word) if p]
        if all(is_known(p) for p in parts) or (len(parts) == 1 and _is_compound(word)):
            continue
        region = _word_box(line.polygon, start, end, len(line.text))
        ocr = float(line.confidence)
        common = dict(detected_text=word, context_text=line.text[:1000], ocr_confidence=round(ocr, 3), region=region)
        fix = _confusable_fix(word)
        if fix:
            found.append(Candidate(
                category='OCR_UNCERTAIN', band='low' if ocr < MEDIUM_OCR else 'medium', suggested_text=fix,
                explanation=f'Looks like “{fix}” with a commonly misread character. Check the artwork.',
                decision_confidence=0.5, **common,
            ))
            continue
        if ocr < min_ocr:
            found.append(Candidate(
                category='OCR_UNCERTAIN', band='low', suggested_text='',
                explanation='The text was hard to read here, so this may be a reading error rather than a typo.',
                decision_confidence=0.3, **common,
            ))
            continue
        suggestion, distance = _suggest(word)
        proper = word[:1].isupper() and not word.isupper() and index > 0
        if not suggestion:
            if proper:
                continue  # an unknown capitalised word is far more often a name than a typo
            found.append(Candidate(
                category='POSSIBLE_SPELLING_ERROR', band='low', suggested_text='',
                explanation='Not in the dictionary and no close match. Add it to the glossary if it is intended.',
                decision_confidence=0.4, **common,
            ))
            continue
        decision = {1: 0.92, 2: 0.7}.get(distance, 0.5)
        if proper:
            decision = min(decision, 0.6 if distance == 1 else 0.45)
        if len(word) <= 3:
            decision = min(decision, 0.6)
        found.append(Candidate(
            category='POSSIBLE_SPELLING_ERROR', band=_band(ocr, decision), suggested_text=suggestion,
            explanation=(
                f'Not in the en-GB/en-US dictionary; “{suggestion}” is {distance} edit'
                f'{"s" if distance != 1 else ""} away.'
                + (' Could be a name — add it to the glossary if so.' if proper else '')
            ),
            decision_confidence=decision, **common,
        ))
    return found
