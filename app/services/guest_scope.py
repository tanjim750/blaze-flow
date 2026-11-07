"""Dynamic scope: moving a file out or deleting a folder immediately removes access."""
from app.models import ProjectFolder, ProjectFile, MediaVersion


def folder_ids(access):
    root = access.guest_invite.shared_folder_id
    if root is None:
        return None
    rows = dict(ProjectFolder.objects.filter(
        project_id=access.guest_invite.project_id, deleted_at__isnull=True,
    ).values_list('id', 'parent_folder_id'))
    if root not in rows:
        return set()
    found = {root}
    while True:
        children = {fid for fid, parent in rows.items() if parent in found} - found
        if not children:
            return found
        found.update(children)


def scoped_media(access):
    qs = MediaVersion.objects.filter(project_id=access.guest_invite.project_id, status='ACTIVE')
    invite = access.guest_invite
    if invite.shared_media_version_id is not None:
        qs = qs.filter(id=invite.shared_media_version_id)
    ids = folder_ids(access)
    if ids is not None:
        files = ProjectFile.objects.filter(project_id=invite.project_id, folder_id__in=ids, deleted_at__isnull=True)
        qs = qs.filter(original_file_id__in=files.values('file_id'))
    return qs
