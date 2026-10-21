import uuid

from django.db import transaction
from django.utils import timezone

from app.models import Project, ProjectAccessMode, ProjectStatus, ResourceAccess


@transaction.atomic
def create_project(*, workspace, created_by_user, authorizing_membership, **validated_data):
    now = timezone.now()
    project = Project(
        id=uuid.uuid4(),
        workspace=workspace,
        created_by_user=created_by_user,
        created_at=now,
        updated_at=now,
        **validated_data,
    )
    project.full_clean()
    project.save()
    if authorizing_membership.project_access_mode == ProjectAccessMode.SELECTED:
        ResourceAccess.objects.create(
            id=uuid.uuid4(),
            workspace_membership=authorizing_membership,
            project=project,
            created_at=now,
        )
    if project.client_team_id:
        from .client_teams import sync_client_project_access
        sync_client_project_access(project)
    return project


def update_project(*, project, **validated_data):
    previous_client_team_id = project.client_team_id
    for field, value in validated_data.items():
        setattr(project, field, value)
    project.updated_at = timezone.now()
    project.full_clean()
    project.save()
    if project.client_team_id != previous_client_team_id:
        from .client_teams import sync_client_project_access
        sync_client_project_access(project, previous_client_team_id=previous_client_team_id)
    return project


def archive_project(*, project):
    project.status = ProjectStatus.ARCHIVED
    project.updated_at = timezone.now()
    project.full_clean()
    project.save(update_fields=['status', 'updated_at'])
    return project
