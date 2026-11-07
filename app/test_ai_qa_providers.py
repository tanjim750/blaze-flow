"""AI QA providers are pluggable: a registry entry or env var adds one, with its own label."""
from django.test import SimpleTestCase, override_settings

from app.ai_qa.engines import FakeOcrEngine, engine_label, get_engine


class PluggableProviderTests(SimpleTestCase):
    def test_built_in_labels(self):
        self.assertEqual(engine_label('paddleocr'), 'on our servers')
        self.assertEqual(engine_label('unknown-engine'), 'unknown-engine')

    @override_settings(
        AI_QA_EXTRA_ENGINES={'hosted': 'app.ai_qa.engines.FakeOcrEngine'},
        AI_QA_EXTRA_ENGINE_LABELS={'hosted': 'with a hosted model'},
    )
    def test_extra_provider_from_settings(self):
        self.assertIsInstance(get_engine('hosted'), FakeOcrEngine)
        self.assertEqual(engine_label('hosted'), 'with a hosted model')

    def test_unknown_provider_is_refused(self):
        with self.assertRaises(RuntimeError):
            get_engine('nope')
