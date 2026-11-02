"""Plan for 'Download folder': every file under a folder, nested subfolders included.

The zip is built in the browser, not here. Gunicorn on the web box has only a few workers,
and streaming multi-GB archives through them took the site down, so the server's job is
only to list what goes in the zip (paths, sizes) and hand out short-lived signed storage
URLs. The browser fetches each object straight from R2 and writes a STORED (uncompressed)
ZIP64 archive to disk (see frontend/src/lib/folder-zip.ts). Only the latest version of each
asset is included, files that are not READY are skipped and listed, and empty folders are
kept so the structure survives.
"""
import logging
from dataclasses import dataclass, field
from datetime import timedelta

from django.conf import settings
from django.core.files.storage import default_storage
from django.db.models import Max
from django.utils import timezone

from app.models import FileStatus, ProjectFile, ProjectFolder

logger = logging.getLogger(__name__)

CHUNK_SIZE = 64 * 1024
NOTES_NAME = '_download-notes.txt'


@dataclass
class ZipEntry:
    path: str
    object_key: str
    size: int
    modified: object = None


@dataclass
class FolderZipPlan:
    root_name: str
    entries: list = field(default_factory=list)
    empty_dirs: list = field(default_factory=list)
    skipped: list = field(default_factory=list)  # (path, reason)

    @property
    def total_bytes(self):
        return sum(entry.size for entry in self.entries)

    def manifest(self):
        return {
            'name': f'{self.root_name}.zip',
            'file_count': len(self.entries),
            'total_bytes': self.total_bytes,
            'skipped': [{'path': path, 'reason': reason} for path, reason in self.skipped],
        }


def safe_name(name, fallback='untitled'):
    """One path segment: no separators, no `..`, no control characters."""
    cleaned = ''.join('_' if ch in '/\\' or ord(ch) < 32 else ch for ch in (name or '')).strip()
    if cleaned in ('', '.', '..'):
        return fallback
    return cleaned[:255]


def _unique(name, taken):
    if name.lower() not in taken:
        taken.add(name.lower())
        return name
    stem, dot, ext = name.rpartition('.')
    if not dot or not stem:
        stem, ext = name, ''
    n = 2
    while True:
        candidate = f'{stem} ({n}).{ext}' if ext else f'{stem} ({n})'
        if candidate.lower() not in taken:
            taken.add(candidate.lower())
            return candidate
        n += 1


def plan_folder_zip(folder, *, file_filter=None):
    """Walks ``folder`` and everything under it, breadth-first, without recursion limits.

    ``file_filter`` narrows the ProjectFile queryset (guests only get files whose review
    version allows downloads). Deleted folders and files are never included.
    """
    plan = FolderZipPlan(root_name=safe_name(folder.name, 'folder'))
    children = {}
    for item in ProjectFolder.objects.filter(
        workspace_id=folder.workspace_id, project_id=folder.project_id, deleted_at__isnull=True,
    ).only('id', 'name', 'parent_folder_id'):
        children.setdefault(item.parent_folder_id, []).append(item)

    paths = {folder.id: plan.root_name}
    queue, seen = [folder.id], {folder.id}
    taken_by_folder = {folder.id: set()}
    while queue:
        current = queue.pop(0)
        for child in sorted(children.get(current, []), key=lambda f: f.name.lower()):
            if child.id in seen:  # defensive: a cycle in parent links must not hang the walk
                logger.warning('folder_zip.cycle folder=%s', child.id)
                continue
            seen.add(child.id)
            name = _unique(safe_name(child.name, 'folder'), taken_by_folder[current])
            paths[child.id] = f'{paths[current]}/{name}'
            taken_by_folder[child.id] = set()
            queue.append(child.id)

    files = ProjectFile.objects.filter(folder_id__in=list(paths), deleted_at__isnull=True).select_related('file')
    if file_filter is not None:
        files = file_filter(files)
    # Latest version per asset; rows with no asset are their own single version.
    latest = dict(
        ProjectFile.objects.filter(media_asset__isnull=False, deleted_at__isnull=True, folder_id__in=list(paths))
        .values_list('media_asset_id').annotate(top=Max('version_number'))
    )
    has_files = set()
    for item in sorted(files, key=lambda f: (str(paths[f.folder_id]).lower(), f.file.original_name.lower())):
        if item.media_asset_id and latest.get(item.media_asset_id) != item.version_number:
            continue
        name = _unique(safe_name(item.file.original_name, 'file'), taken_by_folder[item.folder_id])
        path = f'{paths[item.folder_id]}/{name}'
        if item.file.status != FileStatus.READY:
            plan.skipped.append((path, 'not ready (still uploading or being checked)' if item.file.status == FileStatus.PENDING else 'rejected by the file check'))
            continue
        plan.entries.append(ZipEntry(path=path, object_key=item.file.object_key, size=item.file.size_bytes or 0, modified=item.updated_at))
        has_files.add(item.folder_id)
    # Empty folders still appear in the zip, so the structure survives.
    nonempty_prefixes = {paths[fid] for fid in has_files}
    for fid, path in paths.items():
        if not any(p == path or p.startswith(path + '/') for p in nonempty_prefixes):
            plan.empty_dirs.append(path)
    return plan


# ----------------------------------------------------------------------------- signed URLs

def object_url(object_key, expire_seconds=None):
    """A URL the browser can GET the object from. With STORAGE_DRIVER=s3 this is a presigned
    R2 URL that bypasses the web workers entirely; locally it's the dev media URL."""
    expire = int(expire_seconds or getattr(settings, 'FOLDER_ZIP_URL_EXPIRE_SECONDS', 6 * 3600))
    try:
        return default_storage.url(object_key, expire=expire)
    except TypeError:  # FileSystemStorage.url takes no expiry
        return default_storage.url(object_key)


def manifest_with_urls(plan, expire_seconds=None):
    expire = int(expire_seconds or getattr(settings, 'FOLDER_ZIP_URL_EXPIRE_SECONDS', 6 * 3600))
    data = plan.manifest()
    data['entries'] = [
        {'path': e.path, 'size': e.size, 'url': object_url(e.object_key, expire),
         'modified': e.modified.isoformat() if e.modified else None}
        for e in plan.entries
    ]
    data['empty_dirs'] = list(plan.empty_dirs)
    data['urls_expire_at'] = (timezone.now() + timedelta(seconds=expire)).isoformat()
    return data
