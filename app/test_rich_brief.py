"""Rich-text briefs: the sanitiser and the API storing only clean HTML."""
from django.test import SimpleTestCase, TestCase
from django.urls import reverse

from .models import Project
from .rich_text import is_rich, sanitize_brief
from .test_access_projects import WorkspaceAccessSetupMixin


class SanitizeBriefTests(SimpleTestCase):
    def test_plain_text_is_kept_exactly(self):
        text = 'Line one\n\nUse <brand> colours & keep it 30s'
        self.assertFalse(is_rich(text))
        self.assertEqual(sanitize_brief(text), text)
        self.assertIsNone(sanitize_brief(None))
        self.assertEqual(sanitize_brief(''), '')

    def test_editor_markup_survives(self):
        html = (
            '<h2 style="text-align: center">Goals</h2><p><strong>Bold</strong> <em>it</em> <u>u</u> <s>s</s></p>'
            '<ul><li><p>One</p></li></ul><ol start="3"><li><p>Two</p></li></ol><blockquote><p>Quote</p></blockquote>'
            '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Done</p></div></li></ul>'
        )
        cleaned = sanitize_brief(html)
        for kept in ('<h2 style="text-align: center">', '<strong>Bold</strong>', '<u>u</u>', '<s>s</s>', '<ol start="3">',
                     '<blockquote>', 'data-type="taskList"', 'data-checked="true"', '<input type="checkbox" disabled="disabled" checked="checked">'):
            self.assertIn(kept, cleaned)

    def test_scripts_handlers_and_bad_links_are_removed(self):
        cleaned = sanitize_brief(
            '<p onclick="x()">Hi<script>alert(1)</script><img src=x onerror=alert(2)>'
            '<a href="javascript:alert(3)">bad</a><a href="https://ok.test" onmouseover="y">ok</a></p>'
            '<p style="color:red;background:url(x)">s</p><iframe src="https://e.test"></iframe><input type="text" value="x">'
        )
        for gone in ('onclick', 'script', 'alert(1)', '<img', 'onerror', 'javascript:', 'onmouseover', 'color', 'iframe', 'type="text"'):
            self.assertNotIn(gone, cleaned)
        self.assertIn('<a href="https://ok.test" target="_blank" rel="noopener noreferrer nofollow">ok</a>', cleaned)
        self.assertIn('bad', cleaned)

    def test_text_is_escaped_and_tags_balanced(self):
        cleaned = sanitize_brief('<p>a &lt;b&gt; <strong>open')
        self.assertEqual(cleaned, '<p>a &lt;b&gt; <strong>open</strong></p>')


class RichBriefApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.owner)
        self.project_id = self.client.post(
            reverse('api-projects', args=[self.workspace.id]), {'name': 'Spring Launch'}, format='json',
        ).json()['id']
        self.url = reverse('api-project-detail', args=[self.workspace.id, self.project_id])

    def test_patch_stores_sanitised_html(self):
        response = self.client.patch(self.url, {'description': '<p>Hi <strong>there</strong><script>x</script></p>'}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['description'], '<p>Hi <strong>there</strong></p>')
        self.assertEqual(Project.objects.get(pk=self.project_id).description, '<p>Hi <strong>there</strong></p>')

    def test_plain_text_brief_round_trips(self):
        self.client.patch(self.url, {'description': 'Just words\nand a line'}, format='json')
        self.assertEqual(Project.objects.get(pk=self.project_id).description, 'Just words\nand a line')
