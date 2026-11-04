"""AI Visual QA: words the OCR ran together ("Iwill") are not typos or copy differences."""
from django.test import SimpleTestCase, override_settings

from .ai_qa.copy_compare import TYPO, Unit, compare
from .ai_qa.engines import OcrLine
from .ai_qa.pipeline import check_image
from .ai_qa.spelling import check_line, run_together

BOX = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.2], [0.1, 0.2]]


def line(text, confidence=0.97):
    return OcrLine(text=text, confidence=confidence, polygon=BOX)


def spelled(text):
    return [c.detected_text for c in check_line(line(text)) if c.category == 'POSSIBLE_SPELLING_ERROR']


class RunTogetherSpellingTests(SimpleTestCase):
    def test_i_will_go_there_with_dropped_spaces_is_not_a_typo(self):
        for text in ('Iwill go there', 'I willgo there', 'Iwillgo there', 'IWILL GO THERE', 'See you atthe weekend', 'ON SALE NOW', 'ONSALE NOW'):
            self.assertEqual(spelled(text), [], text)

    def test_whole_line_read_without_spaces_is_not_a_typo(self):
        for text in ('Iwillgothere', 'Seeyouattheweekend', 'Wearesohappy', 'ONSALENOW'):
            self.assertEqual(spelled(text), [], text)

    def test_typo_inside_a_line_read_without_spaces_is_reported_on_its_word(self):
        self.assertEqual(spelled('Iwillgothier'), ['thier'])

    def test_split_uses_common_words_only(self):
        self.assertEqual(run_together('iwill'), ['i', 'will'])
        self.assertEqual(run_together('weareso'), ['we', 'are', 'so'])
        # Rare fragments must not explain away real typos.
        for typo in ('semster', 'recieve', 'acommodate', 'thier', 'tiem'):
            self.assertIsNone(run_together(typo), typo)

    def test_real_typos_still_flagged(self):
        self.assertEqual(spelled('I will go thier'), ['thier'])
        self.assertEqual(spelled('We missed you alot'), ['alot'])  # a join that is itself a misspelling
        self.assertEqual(spelled('Iwill go thier'), ['thier'])


class RunTogetherCompareTests(SimpleTestCase):
    def rows(self, approved, *texts):
        return compare(approved, [Unit(text=t, confidence=0.95) for t in texts])

    def test_i_will_go_there_matches_approved_copy(self):
        for text in ('Iwill go there', 'lwill go there', 'I willgo there', 'Iwillgothere', 'I will go there'):
            self.assertEqual(self.rows('I will go there', text), [], text)

    def test_typo_inside_a_line_read_without_spaces(self):
        rows = self.rows('I will go there', 'Iwillgothier')
        self.assertEqual([(r['category'], r['detected_text']) for r in rows], [(TYPO, 'thier')])

    def test_merged_words_across_a_longer_line(self):
        self.assertEqual(self.rows('See you at the weekend', 'Seeyou atthe weekend'), [])
        self.assertEqual(self.rows('See you at the weekend', 'Seeyouattheweekend'), [])

    def test_real_typo_next_to_merged_words_still_reported(self):
        rows = self.rows('I will go there', 'Iwill go thier')
        self.assertEqual([(r['category'], r['detected_text']) for r in rows], [(TYPO, 'thier')])


class FakeReread:
    """Engine stub: the close crop reads as `second`."""

    def __init__(self, second):
        self.second = second

    def read(self, image_path, *, width, height, source_path=None, **_):
        return [line(t) for t in self.second]


class VerifyTests(SimpleTestCase):
    def setUp(self):
        import tempfile

        from PIL import Image
        self.dir = tempfile.mkdtemp()
        self.path = f'{self.dir}/ocr.png'
        Image.new('RGB', (800, 600), 'white').save(self.path)

    def test_finding_dropped_when_close_read_is_clean(self):
        found = check_image(FakeReread(['Premium quality']), self.path, [line('Premuim qualty')], glossary=frozenset())
        self.assertEqual(found, [])

    def test_finding_kept_when_close_read_agrees(self):
        found = check_image(FakeReread(['PREMUIM QUALITY']), self.path, [line('PREMUIM QUALITY')], glossary=frozenset())
        self.assertEqual([c.detected_text for c in found], ['PREMUIM'])

    def test_finding_kept_when_close_read_sees_nothing(self):
        found = check_image(FakeReread([]), self.path, [line('PREMUIM QUALITY')], glossary=frozenset())
        self.assertEqual([c.detected_text for c in found], ['PREMUIM'])

    @override_settings(AI_QA_VERIFY_FINDINGS=False)
    def test_verification_can_be_switched_off(self):
        found = check_image(FakeReread(['Premium quality']), self.path, [line('PREMUIM QUALITY')], glossary=frozenset())
        self.assertEqual([c.detected_text for c in found], ['PREMUIM'])
