"""Thumbnails for folder cards: up to three recent stills from inside each folder.

Frame.io-style folder tiles show what a folder holds. For a whole list of folders this
costs one query: every readable file that has a ready poster/thumbnail is ranked per
folder by recency with a window function, and only the top three per folder come back.
Folders that hold fewer than three such files directly borrow from their subfolders
(walked in Python over the folder list the view already loaded), newest first.
"""
from django.db.models import Exists, F, OuterRef, Window
from django.db.models.functions import RowNumber
from django.urls import reverse

from app.models import FileStatus, FileVariant, ProjectFile

PREVIEW_LIMIT = 3


def _still_types():
    from app.services.file_processing import POSTER_VARIANT_TYPE
    return (POSTER_VARIANT_TYPE, 'IMAGE_THUMBNAIL')


def folder_preview_map(folders, files_queryset):
    """``{folder_id: [poster url, ...]}`` for ``folders``.

    ``files_queryset`` must already be limited to what the requester may read: a preview is
    only ever a file the caller could open themselves. ``folders`` should be the full list
    of folders the caller can see, so descendants can be found without further queries.
    """
    folders = list(folders)
    if not folders:
        return {}
    folder_ids = [folder.id for folder in folders]
    has_still = FileVariant.objects.filter(
        file_id=OuterRef('file_id'), status=FileStatus.READY, deleted_at__isnull=True,
        metadata__variant_type__in=_still_types(),
    )
    ranked = (
        files_queryset.filter(folder_id__in=folder_ids, deleted_at__isnull=True)
        .filter(Exists(has_still))
        .annotate(preview_rank=Window(
            RowNumber(), partition_by=[F('folder_id')], order_by=[F('created_at').desc(), F('id').desc()],
        ))
        .filter(preview_rank__lte=PREVIEW_LIMIT)
        .values_list('id', 'workspace_id', 'folder_id', 'created_at')
    )
    direct = {}
    for file_id, workspace_id, folder_id, created_at in ranked:
        url = reverse('api-asset-file-poster', args=[workspace_id, file_id])
        direct.setdefault(folder_id, []).append((created_at, url))
    children = {}
    for folder in folders:
        children.setdefault(folder.parent_folder_id, []).append(folder.id)

    result = {}
    for folder in folders:
        own = sorted(direct.get(folder.id, []), reverse=True)
        picked = [url for _, url in own[:PREVIEW_LIMIT]]
        if len(picked) < PREVIEW_LIMIT:
            nested, stack, seen = [], list(children.get(folder.id, [])), {folder.id}
            while stack:
                child = stack.pop()
                if child in seen:
                    continue
                seen.add(child)
                nested.extend(direct.get(child, []))
                stack.extend(children.get(child, []))
            nested.sort(reverse=True)
            picked.extend(url for _, url in nested[:PREVIEW_LIMIT - len(picked)])
        result[folder.id] = picked
    return result
