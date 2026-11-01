"""Resend HTTPS API email backend, email settings selection and platform email status."""
import base64
import os
import runpy
from pathlib import Path
from unittest import mock

import requests
from django.core import mail
from django.core.mail import EmailMessage, EmailMultiAlternatives
from django.test import SimpleTestCase, override_settings

from blazeflow import __version__
from blazeflow.email_backends.resend import EmailBackend, ResendAPIError

KEY = 're_test_secret_key_123'
SETTINGS_PATH = str(Path(__file__).resolve().parent.parent / 'blazeflow' / 'settings.py')


def _resp(status=200, json_data=None, text=''):
    r = mock.Mock(status_code=status, text=text)
    if json_data is None:
        r.json.side_effect = ValueError('no json')
    else:
        r.json.return_value = json_data
    return r


@override_settings(RESEND_API_KEY=KEY, DEFAULT_FROM_EMAIL='Blaze <no-reply@example.com>',
                   EMAIL_TIMEOUT=7, RESEND_API_URL='https://api.resend.com/emails')
class ResendBackendTests(SimpleTestCase):
    def setUp(self):
        patcher = mock.patch('requests.Session.post')
        self.post = patcher.start()
        self.addCleanup(patcher.stop)
        self.post.return_value = _resp(200, {'id': 'abc'})

    def send(self, msg, **kw):
        return EmailBackend(**kw).send_messages([msg])

    def test_success_html_text_recipients_headers(self):
        msg = EmailMultiAlternatives(
            'Hi', 'plain body', None, ['a@x.com', 'b@x.com'], cc=['c@x.com'], bcc=['d@x.com'],
            reply_to=['Support <s@x.com>'], headers={'X-Entity-Ref-ID': '42'},
        )
        msg.attach_alternative('<p>html</p>', 'text/html')
        self.assertEqual(self.send(msg), 1)
        args, kwargs = self.post.call_args
        self.assertEqual(args[0], 'https://api.resend.com/emails')
        self.assertEqual(kwargs['timeout'], 7)
        self.assertEqual(kwargs['headers']['Authorization'], f'Bearer {KEY}')
        p = kwargs['json']
        self.assertEqual(p['from'], 'Blaze <no-reply@example.com>')
        self.assertEqual(p['to'], ['a@x.com', 'b@x.com'])
        self.assertEqual(p['cc'], ['c@x.com'])
        self.assertEqual(p['bcc'], ['d@x.com'])
        self.assertEqual(p['reply_to'], ['Support <s@x.com>'])
        self.assertEqual(p['text'], 'plain body')
        self.assertEqual(p['html'], '<p>html</p>')
        self.assertEqual(p['headers'], {'X-Entity-Ref-ID': '42'})
        self.assertNotIn('attachments', p)

    def test_user_agent_is_custom(self):
        backend = EmailBackend()
        backend.open()
        self.assertEqual(backend.session.headers['User-Agent'], f'blazeflow/{__version__}')
        backend.close()

    def test_html_only_message(self):
        msg = EmailMessage('Hi', '<b>x</b>', 'f@x.com', ['a@x.com'])
        msg.content_subtype = 'html'
        self.send(msg)
        p = self.post.call_args.kwargs['json']
        self.assertEqual(p['html'], '<b>x</b>')
        self.assertNotIn('text', p)
        self.assertEqual(p['from'], 'f@x.com')

    def test_attachments_base64(self):
        msg = EmailMessage('Hi', 'body', None, ['a@x.com'])
        msg.attach('report.pdf', b'%PDF-bytes', 'application/pdf')
        msg.attach('notes.txt', 'héllo')
        self.send(msg)
        atts = self.post.call_args.kwargs['json']['attachments']
        self.assertEqual(atts[0], {'filename': 'report.pdf', 'content_type': 'application/pdf',
                                   'content': base64.b64encode(b'%PDF-bytes').decode()})
        self.assertEqual(base64.b64decode(atts[1]['content']).decode(), 'héllo')
        self.assertEqual(atts[1]['filename'], 'notes.txt')

    def test_4xx_raises_clear_error_without_key(self):
        self.post.return_value = _resp(403, {'statusCode': 403, 'name': 'validation_error',
                                             'message': 'The example.com domain is not verified.'})
        with self.assertRaises(ResendAPIError) as ctx:
            self.send(EmailMessage('Hi', 'b', None, ['a@x.com']))
        self.assertEqual(ctx.exception.status, 403)
        self.assertIn('HTTP 403', str(ctx.exception))
        self.assertIn('not verified', str(ctx.exception))
        self.assertNotIn(KEY, str(ctx.exception))

    def test_error_body_echoing_key_is_redacted(self):
        self.post.return_value = _resp(401, {'message': f'API key {KEY} is invalid'})
        with self.assertRaises(ResendAPIError) as ctx:
            self.send(EmailMessage('Hi', 'b', None, ['a@x.com']))
        self.assertNotIn(KEY, str(ctx.exception))
        self.assertIn('[redacted]', str(ctx.exception))

    def test_5xx_non_json_raises(self):
        self.post.return_value = _resp(502, None, text='Bad gateway')
        with self.assertRaises(ResendAPIError) as ctx:
            self.send(EmailMessage('Hi', 'b', None, ['a@x.com']))
        self.assertIn('HTTP 502', str(ctx.exception))

    def test_network_errors(self):
        self.post.side_effect = requests.Timeout('slow')
        with self.assertRaisesMessage(ResendAPIError, 'timed out after 7s'):
            self.send(EmailMessage('Hi', 'b', None, ['a@x.com']))
        self.post.side_effect = requests.ConnectionError(f'boom {KEY}')
        with self.assertRaises(ResendAPIError) as ctx:
            self.send(EmailMessage('Hi', 'b', None, ['a@x.com']))
        self.assertNotIn(KEY, str(ctx.exception))

    def test_fail_silently_counts_only_successes(self):
        self.post.side_effect = [_resp(500, {'message': 'oops'}), _resp(200, {'id': '2'})]
        msgs = [EmailMessage('1', 'b', None, ['a@x.com']), EmailMessage('2', 'b', None, ['b@x.com'])]
        self.assertEqual(EmailBackend(fail_silently=True).send_messages(msgs), 1)

    def test_fail_silently_swallows_network_error(self):
        self.post.side_effect = requests.ConnectionError('down')
        self.assertEqual(self.send(EmailMessage('Hi', 'b', None, ['a@x.com']), fail_silently=True), 0)

    def test_missing_key(self):
        msg = EmailMessage('Hi', 'b', None, ['a@x.com'])
        with self.settings(RESEND_API_KEY=''):
            with self.assertRaisesMessage(ResendAPIError, 'RESEND_API_KEY is not configured'):
                self.send(msg)
            self.assertEqual(self.send(msg, fail_silently=True), 0)
        self.post.assert_not_called()

    def test_no_recipients_and_empty_list(self):
        self.assertEqual(EmailBackend().send_messages([]), 0)
        self.send(EmailMessage('Hi', 'b', None, []))
        self.post.assert_not_called()

    def test_django_send_mail_uses_backend(self):
        with self.settings(EMAIL_BACKEND='blazeflow.email_backends.resend.EmailBackend'):
            self.assertEqual(mail.send_mail('S', 'B', None, ['a@x.com']), 1)
        self.assertEqual(self.post.call_count, 1)


class EmailSettingsSelectionTests(SimpleTestCase):
    def load(self, **env):
        clean = {k: v for k, v in os.environ.items()
                 if k not in ('EMAIL_BACKEND', 'RESEND_API_KEY', 'EMAIL_TRANSPORT', 'EMAIL_HOST',
                              'EMAIL_USE_TLS', 'EMAIL_USE_SSL', 'EMAIL_PORT')}
        clean.update(env)
        with mock.patch.dict(os.environ, clean, clear=True):
            return runpy.run_path(SETTINGS_PATH)

    def test_precedence(self):
        api = 'blazeflow.email_backends.resend.EmailBackend'
        smtp = 'django.core.mail.backends.smtp.EmailBackend'
        self.assertEqual(self.load(RESEND_API_KEY='k')['EMAIL_BACKEND'], api)
        self.assertEqual(self.load(RESEND_API_KEY='k', EMAIL_TRANSPORT='api')['EMAIL_BACKEND'], api)
        s = self.load(RESEND_API_KEY='k', EMAIL_TRANSPORT='smtp')
        self.assertEqual((s['EMAIL_BACKEND'], s['EMAIL_HOST'], s['EMAIL_PORT']), (smtp, 'smtp.resend.com', 465))
        self.assertTrue(s['EMAIL_USE_SSL'])
        s = self.load(EMAIL_HOST='mail.example.com')
        self.assertEqual((s['EMAIL_BACKEND'], s['EMAIL_HOST']), (smtp, 'mail.example.com'))
        self.assertEqual(self.load()['EMAIL_BACKEND'], 'django.core.mail.backends.console.EmailBackend')
        self.assertEqual(self.load(RESEND_API_KEY='k', EMAIL_BACKEND='x.y.Z')['EMAIL_BACKEND'], 'x.y.Z')

    def test_invalid_transport(self):
        from django.core.exceptions import ImproperlyConfigured
        with self.assertRaises(ImproperlyConfigured):
            self.load(RESEND_API_KEY='k', EMAIL_TRANSPORT='pigeon')


class PlatformEmailStatusTests(SimpleTestCase):
    def test_status(self):
        from app.platform.metrics import email_status
        with self.settings(EMAIL_BACKEND='blazeflow.email_backends.resend.EmailBackend'):
            self.assertEqual(email_status(), {'email_backend': 'resend', 'email_transport': 'Resend API', 'email_sending': True})
        with self.settings(EMAIL_BACKEND='django.core.mail.backends.smtp.EmailBackend', EMAIL_HOST='smtp.resend.com'):
            self.assertEqual(email_status()['email_transport'], 'Resend SMTP')
        with self.settings(EMAIL_BACKEND='django.core.mail.backends.console.EmailBackend'):
            self.assertFalse(email_status()['email_sending'])
