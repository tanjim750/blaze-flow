import io
import zipfile

from django.test import SimpleTestCase

from .services.review_assets import detect_attachment_type


def _build_zip(entry_name, content=b'<xml/>'):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        archive.writestr(entry_name, content)
    return buffer.getvalue()


class AttachmentSignatureDetectionTests(SimpleTestCase):
    def _detect(self, data):
        upload = io.BytesIO(data)
        header = upload.read(32)
        upload.seek(0)
        return detect_attachment_type(header, upload)

    def test_docx_is_detected_by_internal_part(self):
        detected = self._detect(_build_zip('word/document.xml'))

        self.assertEqual(
            detected, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )

    def test_xlsx_is_detected_by_internal_part(self):
        detected = self._detect(_build_zip('xl/workbook.xml'))

        self.assertEqual(
            detected, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )

    def test_pptx_is_detected_by_internal_part(self):
        detected = self._detect(_build_zip('ppt/presentation.xml'))

        self.assertEqual(
            detected, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        )

    def test_generic_zip_without_an_office_marker_is_not_detected(self):
        detected = self._detect(_build_zip('readme.txt', b'hello'))

        self.assertIsNone(detected)

    def test_corrupt_zip_is_not_detected(self):
        detected = self._detect(b'PK\x03\x04' + b'not a real zip stream' + b'\x00' * 10)

        self.assertIsNone(detected)

    def test_rtf_is_detected_from_header_alone(self):
        header = b'{\\rtf1\\ansi\\deff0' + b'\x00' * 16

        detected = detect_attachment_type(header)

        self.assertEqual(detected, 'application/rtf')

    def test_ooxml_signature_without_an_upload_stream_is_not_enough(self):
        header = b'PK\x03\x04' + b'\x00' * 28

        detected = detect_attachment_type(header)

        self.assertIsNone(detected)
