"""'Download folder': the whole folder, subfolders included, as one zip built in the browser.

Nothing streams through the web workers: these routes only check access and return the
plan (paths, sizes) with short-lived signed storage URLs, and the browser fetches each
file straight from R2 and writes the zip itself (frontend/src/lib/folder-zip.ts). Team
members need the same permission as downloading one file of that folder; guests need a
project-wide share link that allows downloads, and only get files whose review version
allows downloads. The browser re-asks for the manifest if a signed URL expires mid-way.
"""
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .guest_views import _guest_access, _scoped_media_id
from .services.guest_scope import folder_ids, scoped_media
from django.http import Http404
from .models import FileStatus, GuestReviewAccessPermission, MediaVersion, Project, ProjectFile, ProjectFolder, Workspace
from .permissions import PROJECT_FILE_READ
from .services.audit import record_guest_audit, record_user_audit
from .services.folder_zip import manifest_with_urls, plan_folder_zip
from .views import _require_asset_permission

GUEST_DOWNLOAD_PERMISSION = 'media.download'


def _audit_meta(plan):
    return {'files': len(plan.entries), 'bytes': plan.total_bytes, 'skipped': len(plan.skipped)}


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def asset_folder_download(request, workspace_id, folder_id):
    """The zip plan with signed URLs. `?retry=1` (a refresh after URLs expired) is not audited again."""
    workspace = get_object_or_404(Workspace, id=workspace_id)
    folder = get_object_or_404(ProjectFolder, id=folder_id, workspace=workspace, deleted_at__isnull=True)
    _require_asset_permission(request, folder, PROJECT_FILE_READ)
    plan = plan_folder_zip(folder)
    if request.query_params.get('retry') != '1':
        record_user_audit(
            user=request.user, workspace=workspace, action='folder.downloaded', entity_type='project_folder',
            entity_id=folder.id, project=folder.project, metadata=_audit_meta(plan),
        )
    return Response(manifest_with_urls(plan))


# ----------------------------------------------------------------------------- guests

def guest_downloadable_files(project):
    allowed = MediaVersion.objects.filter(project=project, status='ACTIVE', allow_download=True).values('original_file_id')
    return lambda qs: qs.filter(file_id__in=allowed)


def guest_can_download_folders(access):
    return _scoped_media_id(access) is None and GuestReviewAccessPermission.objects.filter(
        guest_review_access=access, permission_key=GUEST_DOWNLOAD_PERMISSION,
    ).exists()


def guest_folder_list(project, access):
    """Folders a guest may download: those with at least one downloadable file inside
    (directly or in a subfolder). Empty for file-scoped links or links without downloads."""
    if not guest_can_download_folders(access):
        return []
    qs = ProjectFolder.objects.filter(project=project, deleted_at__isnull=True)
    scope = folder_ids(access)
    if scope is not None:
        qs = qs.filter(id__in=scope)
    folders = {f.id: f for f in qs}
    counts = {}
    files = guest_downloadable_files(project)(ProjectFile.objects.filter(project=project, folder__isnull=False, deleted_at__isnull=True, file__status=FileStatus.READY))
    for folder_id in files.values_list('folder_id', flat=True):
        seen = set()
        while folder_id in folders and folder_id not in seen:
            seen.add(folder_id)
            counts[folder_id] = counts.get(folder_id, 0) + 1
            folder_id = folders[folder_id].parent_folder_id

    def path(folder):
        parts, seen = [], set()
        while folder is not None and folder.id not in seen:
            seen.add(folder.id)
            parts.append(folder.name)
            folder = folders.get(folder.parent_folder_id)
        return ' / '.join(reversed(parts))

    rows = [{'id': str(fid), 'name': folders[fid].name, 'path': path(folders[fid]), 'file_count': n} for fid, n in counts.items()]
    return sorted(rows, key=lambda row: row['path'].lower())


def _guest_folder(project, folder_id):
    return get_object_or_404(ProjectFolder, id=folder_id, project=project, deleted_at__isnull=True)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def guest_folder_download_link(request, project_id, folder_id):
    """Checks the guest's link (header key) and returns the zip plan with signed URLs."""
    project = get_object_or_404(Project, id=project_id)
    access = _guest_access(request, project, GUEST_DOWNLOAD_PERMISSION)
    if _scoped_media_id(access) is not None:
        raise PermissionDenied('This link is for one file, so it cannot download folders.')
    scope = folder_ids(access)
    if scope is not None and folder_id not in scope:
        raise Http404("No such folder.")
    folder = _guest_folder(project, folder_id)
    plan = plan_folder_zip(folder, file_filter=lambda qs: qs.filter(file_id__in=scoped_media(access).filter(allow_download=True).values("original_file_id")))
    if request.query_params.get('retry') != '1':
        record_guest_audit(
            guest_session=access.guest_session, workspace=project.workspace, action='folder.downloaded',
            entity_type='project_folder', entity_id=folder.id, project=project, metadata=_audit_meta(plan),
        )
    return Response(manifest_with_urls(plan))
