import hashlib
import io
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


class FakeS3:
    """Just enough of the boto3 S3 client for the direct-upload lifecycle."""

    def __init__(self):
        self.objects, self.multipart, self.counter = {}, {}, 0

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
        return {'Body': io.BytesIO(self.objects[Key])}

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
