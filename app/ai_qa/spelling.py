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
import math
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

# Natural-log frequency a substitution must beat a dropped-letter/swap fix by, per shape step.
TYPO_SHAPE_PENALTY = 2.0

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


# Words of one or two letters that may stand alone. Longer parts must be dictionary words.
SHORT_WORDS = frozenset(
    'a i am an as at be by do go he hi if in is it me my no of oh ok on or so to up us we'.split()
)


# Corpus count a 3+ letter part needs in the SymSpell frequency list (~top 15k words).
RUN_TOGETHER_MIN_COUNT = 20_000_000
# Tight type can lose every space on a line: "Seeyouattheweekend".
MAX_RUN_PARTS = 8
# Joins that are themselves a recognised misspelling, so still flagged.
JOINED_MISSPELLINGS = frozenset(
    'alot aswell infact incase atleast eachother alright inspite nevermind abit everytime'.split()
)


@lru_cache(maxsize=50_000)
def run_together(word):
    """"Iwill" -> ['i', 'will']: dictionary words whose separating space the OCR did not read.

    Tight display type often leaves a gap narrower than the OCR's space threshold, so it
    returns "Iwill go there". That is a reading of the spacing, not a spelling mistake.
    Returns the split (2+ parts, fewest parts first) or None.
    """
    lower = word.lower()
    if not lower.isalpha() or len(lower) < 3:
        return None

    if lower in JOINED_MISSPELLINGS:
        return None

    def ok(part):
        if len(part) <= 2:
            return part in SHORT_WORDS
        # Common, real words only: rare fragments ("sem" + "ster", "rec" + "i" + "eve")
        # would otherwise wave genuine typos through.
        return _symspell().words.get(part, 0) >= RUN_TOGETHER_MIN_COUNT and (
            not _hunspell() or any(d.lookup(part) for d in _hunspell()))

    @lru_cache(maxsize=None)
    def split(rest, parts_left):
        if ok(rest):
            return [rest]
        if parts_left <= 1:
            return None
        best = None
        for i in range(1, len(rest)):
            head = rest[:i]
            if ok(head):
                tail = split(rest[i:], parts_left - 1)
                if tail and (best is None or len(tail) + 1 < len(best)):
                    best = [head, *tail]
        return best

    parts = split(lower, MAX_RUN_PARTS)
    return parts if parts and len(parts) >= 2 else None


def peel_run(word):
    """"Iwillgothier" -> ('Iwill go', 'thier', ''): known words run together around one unknown part.

    Returns (before, core, after) with the unknown part as written, or None. Lets a real typo
    inside a line the OCR read without spaces still be reported on its own word. Only used
    when the whole token is not itself a near-miss of one word ("Recieve" stays "Recieve").
    """
    if not word.isalpha() or len(word) < 7:
        return None
    lower = word.lower()
    suggestion, distance = _suggest(lower)
    if suggestion and distance <= 2:
        return None

    def words_in(part):
        """How many common words `part` is (0 if empty, None if it is not common words)."""
        if not part:
            return 0
        if part in SHORT_WORDS or (len(part) > 2 and _symspell().words.get(part, 0) >= RUN_TOGETHER_MIN_COUNT):
            return 1
        split = run_together(part)
        return len(split) if split else None

    best = None
    for i in range(len(lower)):
        for j in range(i + 4, len(lower) + 1):
            if (i, j) == (0, len(lower)):
                continue
            core = lower[i:j]
            head, tail = words_in(lower[:i]), words_in(lower[j:])
            # At least two words around it, so it looks like a line read without spaces
            # (not a name with a word-like ending: "Zorbl" + "att").
            if head is None or tail is None or head + tail < 2 or _known_exact(core):
                continue
            fix, dist = _suggest(core)
            # Closest fix first; among equals the longer word ("thier", not "hier").
            if fix and (best is None or (dist, -(j - i)) < best[0]):
                best = ((dist, -(j - i)), i, j)
    return (word[:best[1]], word[best[1]:best[2]], word[best[2]:]) if best else None


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


def _is_subsequence(short, long):
    letters = iter(long)
    return all(ch in letters for ch in short)


def _is_transposition(a, b):
    if len(a) != len(b):
        return False
    diff = [i for i, (x, y) in enumerate(zip(a, b)) if x != y]
    return len(diff) == 2 and diff[1] == diff[0] + 1 and a[diff[0]] == b[diff[1]] and a[diff[1]] == b[diff[0]]


def _typo_shape(typo, term):
    """How plausible a correction is as a typing slip, best first (lower sorts first).

    Most real typos drop or double a letter ("LIMTED" for LIMITED, "SHIPING" for SHIPPING) or
    swap two neighbours; a substituted letter is a different word more often than a typo, so
    "LISTED" must not beat LIMITED just because "listed" is the commoner word.
    """
    if _is_subsequence(typo, term) or _is_subsequence(term, typo):
        return 0
    if _is_transposition(typo, term):
        return 1
    return 2


def _suggest(word):
    from symspellpy import Verbosity

    lower = word.lower()
    hits = _symspell().lookup(lower, Verbosity.ALL, max_edit_distance=2, transfer_casing=False)
    hits = [h for h in hits if h.term != lower]
    if not hits:
        return None, None
    nearest = min(h.distance for h in hits)
    # Among the nearest hits, a dropped/doubled letter or a swap beats a substituted letter
    # unless the substitution is a far commoner word (log-frequency minus a shape penalty):
    # LIMTED -> LIMITED (not LISTED), but teh -> the and calender -> calendar still win.
    pool = [h for h in hits if h.distance == nearest]
    best = max(pool, key=lambda h: math.log(max(h.count, 1)) - TYPO_SHAPE_PENALTY * _typo_shape(lower, h.term))
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
    for match in re.finditer(r'[^\s·•|]+', text):  # bullets and pipes separate words even when OCR drops the spaces
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
        if all(run_together(p) or is_known(p) for p in parts):
            continue  # "Iwill": known words with the space not read, not a typo
        peeled = len(parts) == 1 and peel_run(word)
        if peeled:
            before, core, _ = peeled  # report the unknown word, not the whole run-together line
            start, end, word = start + len(before), start + len(before) + len(core), core
            if _skip(word):
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
