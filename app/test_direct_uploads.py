import hashlib
import io
import os
import zipfile
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import DirectUpload, DirectUploadState, File, FileSecurityScan, ProjectFile
from .services import direct_uploads
from .services.subscriptions import enforce_workspace_storage_limit, SubscriptionError
from .test_access_projects import WorkspaceAccessSetupMixin

MP4 = b'\x00\x00\x00\x18ftypmp42' + b'\x00' * 20
PNG = b'\x89PNG\r\n\x1a\n' + b'\x00' * 24


def make_zip(entries, compress=zipfile.ZIP_STORED):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compress) as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return buffer.getvalue()


class FakeS3:
    """Just enough of the boto3 S3 client for the direct-upload lifecycle."""

    def __init__(self):
        self.objects, self.multipart, self.counter, self.gets = {}, {}, 0, []

    def generate_presigned_url(self, method, Params, ExpiresIn):
        extra = f"&part={Params['PartNumber']}" if 'PartNumber' in Params else ''
        return f"https://bucket.example/{Params['Key']}?op={method}&exp={ExpiresIn}{extra}"

    def create_multipart_upload(self, Bucket, Key, ContentType):
        self.counter += 1
        upload_id = f'mpu-{self.counter}'
        self.multipart[upload_id] = {}
        return {'UploadId': upload_id}

    # browser side
    def put(self, key, data):
        self.objects[key] = data

    def upload_part(self, upload_id, number, data):
        self.multipart[upload_id][number] = data

    def list_parts(self, Bucket, Key, UploadId, PartNumberMarker=0):
        parts = sorted(self.multipart[UploadId].items())
        return {'Parts': [{'PartNumber': n, 'ETag': f'"e{n}"', 'Size': len(d)} for n, d in parts if n > PartNumberMarker], 'IsTruncated': False}

    def complete_multipart_upload(self, Bucket, Key, UploadId, MultipartUpload):
        data = self.multipart.pop(UploadId)
        self.objects[Key] = b''.join(data[p['PartNumber']] for p in MultipartUpload['Parts'])

    def abort_multipart_upload(self, Bucket, Key, UploadId):
        self.multipart.pop(UploadId, None)

    def head_object(self, Bucket, Key):
        return {'ContentLength': len(self.objects[Key])}

    def get_object(self, Bucket, Key, Range=None):
        data = self.objects[Key]
        self.gets.append(Range)
        if Range:
            start, end = (int(x) for x in Range.removeprefix('bytes=').split('-'))
            data = data[start:end + 1]
        return {'Body': io.BytesIO(data)}

    def delete_object(self, Bucket, Key):
        self.objects.pop(Key, None)


@override_settings(
    STORAGE_DRIVER='s3', DIRECT_UPLOADS_ENABLED=True, DIRECT_UPLOAD_SINGLE_PUT_MAX_BYTES=1024,
    DIRECT_UPLOAD_PART_SIZE=5 * 1024 * 1024,
)
class DirectUploadTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.s3 = FakeS3()
        patcher = patch.object(direct_uploads, '_client', return_value=(self.s3, 'bucket'))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client.force_authenticate(self.owner)

    def url(self, name, *args):
        return reverse(name, args=[self.workspace.id, *args])

    def init(self, name, size, content_type, **extra):
        return self.client.post(self.url('api-direct-upload-initialize'), {'name': name, 'size': size, 'content_type': content_type, **extra}, format='json')

    def test_config_reports_enabled(self):
        response = self.client.get(self.url('api-direct-upload-config'))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['enabled'])

    @override_settings(STORAGE_DRIVER='local')
    def test_disabled_without_s3_so_the_client_falls_back(self):
        self.assertFalse(self.client.get(self.url('api-direct-upload-config')).json()['enabled'])
        response = self.init('a.png', len(PNG), 'image/png')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'direct_uploads_disabled')

    def test_small_file_presigned_put_then_complete_creates_records_and_scan(self):
        response = self.init('poster.png', len(PNG), 'image/png', sha256=hashlib.sha256(PNG).hexdigest())
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(body['mode'], 'single')
        self.assertIn('op=put_object', body['url'])
        self.assertEqual(body['headers'], {'Content-Type': 'image/png'})
        upload = DirectUpload.objects.get(id=body['id'])
        self.assertTrue(upload.object_key.startswith(f'workspaces/{self.workspace.id}/assets/'))
        self.s3.put(upload.object_key, PNG)

        done = self.client.post(self.url('api-direct-upload-complete', upload.id))
        self.assertEqual(done.status_code, 201, done.content)
        item = ProjectFile.objects.get(id=done.json()['id'])
        self.assertEqual(item.file.checksum, hashlib.sha256(PNG).hexdigest())
        self.assertEqual(item.file.size_bytes, len(PNG))
        self.assertTrue(FileSecurityScan.objects.filter(file=item.file).exists())
        # Retrying complete is idempotent.
        again = self.client.post(self.url('api-direct-upload-complete', upload.id))
        self.assertEqual(again.json()['id'], done.json()['id'])
        self.assertEqual(File.objects.filter(object_key=upload.object_key).count(), 1)

    def test_status_reports_pending_then_completed_with_the_file(self):
        body = self.init('poster.png', len(PNG), 'image/png').json()
        pending = self.client.get(self.url('api-direct-upload-cancel', body['id']))
        self.assertEqual(pending.status_code, 200, pending.content)
        self.assertNotEqual(pending.json()['state'], 'COMPLETED')
        self.assertIsNone(pending.json()['project_file'])
        upload = DirectUpload.objects.get(id=body['id'])
        self.s3.put(upload.object_key, PNG)
        done = self.client.post(self.url('api-direct-upload-complete', upload.id)).json()
        status_body = self.client.get(self.url('api-direct-upload-cancel', upload.id)).json()
        self.assertEqual(status_body['state'], 'COMPLETED')
        self.assertEqual(status_body['project_file']['id'], done['id'])
        self.client.force_authenticate(self.member_user)
        self.assertEqual(self.client.get(self.url('api-direct-upload-cancel', upload.id)).status_code, 404)

    def test_multipart_uses_server_listed_parts_and_verifies_size(self):
        size = 5 * 1024 * 1024 + 100
        data = MP4 + b'\x01' * (size - len(MP4))
        body = self.init('cut.mp4', size, 'video/mp4').json()
        self.assertEqual(body['mode'], 'multipart')
        self.assertEqual(body['part_count'], 2)
        upload = DirectUpload.objects.get(id=body['id'])
        parts = self.client.post(self.url('api-direct-upload-parts', upload.id), {'part_numbers': [1, 2]}, format='json').json()['parts']
        self.assertEqual([p['part_number'] for p in parts], [1, 2])
        self.assertIn('part=2', parts[1]['url'])
        self.assertEqual(self.client.post(self.url('api-direct-upload-parts', upload.id), {'part_numbers': [3]}, format='json').status_code, 400)
        self.s3.upload_part(upload.multipart_upload_id, 1, data[:body['part_size']])
        # Only one part landed: complete refuses and cleans up.
        bad = self.client.post(self.url('api-direct-upload-complete', upload.id))
        self.assertEqual(bad.status_code, 400)
        upload.refresh_from_db()
        self.assertEqual(upload.state, DirectUploadState.FAILED)

        body = self.init('cut.mp4', size, 'video/mp4').json()
        upload = DirectUpload.objects.get(id=body['id'])
        self.s3.upload_part(upload.multipart_upload_id, 1, data[:body['part_size']])
        self.s3.upload_part(upload.multipart_upload_id, 2, data[body['part_size']:])
        done = self.client.post(self.url('api-direct-upload-complete', upload.id))
        self.assertEqual(done.status_code, 201, done.content)
        self.assertEqual(self.s3.objects[upload.object_key], data)

    def test_signature_mismatch_is_rejected_and_object_deleted(self):
        body = self.init('fake.png', len(MP4), 'image/png').json()
        upload = DirectUpload.objects.get(id=body['id'])
        self.s3.put(upload.object_key, MP4)
        response = self.client.post(self.url('api-direct-upload-complete', upload.id))
        self.assertEqual(response.status_code, 400)
        self.assertNotIn(upload.object_key, self.s3.objects)
        self.assertFalse(File.objects.exists())

    def test_size_mismatch_and_checksum_mismatch_are_rejected(self):
        body = self.init('p.png', len(PNG) + 1, 'image/png').json()
        key = DirectUpload.objects.get(id=body['id']).object_key
        self.s3.put(key, PNG)
        self.assertEqual(self.client.post(self.url('api-direct-upload-complete', body['id'])).status_code, 400)

        body = self.init('p.png', len(PNG), 'image/png', sha256='0' * 64).json()
        self.s3.put(DirectUpload.objects.get(id=body['id']).object_key, PNG)
        response = self.client.post(self.url('api-direct-upload-complete', body['id']))
        self.assertEqual(response.status_code, 400)
        self.assertIn('checksum', response.json()['detail'])

    def test_reservations_count_against_the_quota_until_released(self):
        with patch('app.services.subscriptions.get_plan_limit', return_value=100):
            self.assertEqual(self.init('a.png', 60, 'image/png').status_code, 201)
            refused = self.init('b.png', 60, 'image/png')
            self.assertEqual(refused.status_code, 400)
            with self.assertRaises(SubscriptionError):
                enforce_workspace_storage_limit(workspace=self.workspace, additional_bytes=50)
            first = DirectUpload.objects.get(original_name='a.png')
            self.assertEqual(self.client.delete(self.url('api-direct-upload-cancel', first.id)).status_code, 204)
            self.assertEqual(self.init('b.png', 60, 'image/png').status_code, 201)

    def test_expired_uploads_are_aborted_and_release_quota(self):
        body = self.init('cut.mp4', 6 * 1024 * 1024, 'video/mp4').json()
        DirectUpload.objects.filter(id=body['id']).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(direct_uploads.expire_stale(), 1)
        upload = DirectUpload.objects.get(id=body['id'])
        self.assertEqual(upload.state, DirectUploadState.EXPIRED)
        self.assertNotIn(upload.multipart_upload_id, self.s3.multipart)
        self.assertEqual(self.client.post(self.url('api-direct-upload-complete', upload.id)).status_code, 400)

    def test_only_the_creator_can_continue_an_upload(self):
        body = self.init('p.png', len(PNG), 'image/png').json()
        self.invite_and_accept()
        self.client.force_authenticate(self.member_user)
        self.assertEqual(self.client.post(self.url('api-direct-upload-complete', body['id'])).status_code, 404)

    def test_oversize_files_are_refused_before_any_url_is_issued(self):
        with override_settings(MAX_PROJECT_FILE_BYTES=10):
            response = self.init('big.mp4', 11, 'video/mp4')
        self.assertEqual(response.status_code, 400)
        self.assertFalse(DirectUpload.objects.exists())


@override_settings(
    STORAGE_DRIVER='s3', DIRECT_UPLOADS_ENABLED=True, DIRECT_UPLOAD_SINGLE_PUT_MAX_BYTES=1024,
    DIRECT_UPLOAD_PART_SIZE=5 * 1024 * 1024,
)
class DirectUploadArchiveTests(WorkspaceAccessSetupMixin, TestCase):
    """Plain .zip archives of any size (only workspace storage limits apply)."""

    def setUp(self):
        super().setUp()
        self.s3 = FakeS3()
        patcher = patch.object(direct_uploads, '_client', return_value=(self.s3, 'bucket'))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client.force_authenticate(self.owner)

    def url(self, name, *args):
        return reverse(name, args=[self.workspace.id, *args])

    def send(self, name, data, content_type):
        body = self.client.post(self.url('api-direct-upload-initialize'), {'name': name, 'size': len(data), 'content_type': content_type}, format='json')
        self.assertEqual(body.status_code, 201, body.content)
        upload = DirectUpload.objects.get(id=body.json()['id'])
        if upload.multipart_upload_id:
            part = upload.part_size
            for index in range(0, len(data), part):
                self.s3.upload_part(upload.multipart_upload_id, index // part + 1, data[index:index + part])
        else:
            self.s3.put(upload.object_key, data)
        return upload, self.client.post(self.url('api-direct-upload-complete', upload.id))

    def test_archive_over_the_old_200mb_spool_cap_is_accepted_without_spooling(self):
        # Pretend the archive is huge: the old code spooled every ZIP and refused past 200 MB.
        data = make_zip({'footage/a.bin': os.urandom(6 * 1024 * 1024), 'notes.txt': b'hello'})
        with patch.object(direct_uploads, 'ZIP_RANGE_BUFFER', 64 * 1024):
            upload, response = self.send('drive-download-20261102T000508Z-1-001.zip', data, 'application/zip')
        self.assertEqual(response.status_code, 201, response.content)
        item = ProjectFile.objects.get(id=response.json()['id'])
        self.assertEqual(item.file.mime_type, 'application/zip')
        self.assertEqual(item.file.checksum, hashlib.sha256(data).hexdigest())
        # One full read for the checksum; the central directory came from small ranged reads.
        self.assertEqual(self.s3.gets.count(None), 1)
        ranged = [r for r in self.s3.gets if r]
        self.assertTrue(ranged)
        for value in ranged:
            start, end = (int(x) for x in value.removeprefix('bytes=').split('-'))
            self.assertLessEqual(end - start + 1, 64 * 1024)

    def test_windows_zip_mime_alias_is_accepted(self):
        _, response = self.send('a.zip', make_zip({'a.txt': b'a'}), 'application/x-zip-compressed')
        self.assertEqual(response.status_code, 201, response.content)

    def test_office_documents_are_still_told_apart(self):
        docx = make_zip({'word/document.xml': b'<w/>', '[Content_Types].xml': b'<x/>'})
        mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        _, response = self.send('brief.docx', docx, mime)
        self.assertEqual(response.status_code, 201, response.content)
        _, wrong = self.send('brief.zip', docx, 'application/zip')
        self.assertEqual(wrong.status_code, 400)

    def test_deterministic_refusal_is_marked_not_retryable(self):
        broken = b'PK\x03\x04' + b'\x00' * 64  # zip signature, no central directory
        upload, response = self.send('broken.zip', broken, 'application/zip')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'not_retryable')
        upload.refresh_from_db()
        self.assertEqual(upload.state, DirectUploadState.FAILED)

    def test_transient_refusal_stays_retryable(self):
        data = make_zip({'a.txt': b'a'})
        body = self.client.post(self.url('api-direct-upload-initialize'), {'name': 'a.zip', 'size': len(data) + 1, 'content_type': 'application/zip'}, format='json').json()
        self.s3.put(DirectUpload.objects.get(id=body['id']).object_key, data)
        response = self.client.post(self.url('api-direct-upload-complete', body['id']))
        self.assertEqual(response.status_code, 400)
        self.assertNotIn('code', response.json())

    def test_part_urls_report_their_lifetime(self):
        body = self.client.post(self.url('api-direct-upload-initialize'), {'name': 'big.zip', 'size': 6 * 1024 * 1024, 'content_type': 'application/zip'}, format='json').json()
        self.assertEqual(body['url_expires_in'], 900)
        parts = self.client.post(self.url('api-direct-upload-parts', body['id']), {'part_numbers': [1]}, format='json').json()
        self.assertEqual(parts['expires_in'], 900)
