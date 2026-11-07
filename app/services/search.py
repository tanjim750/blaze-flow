"""Quick search (the ⌘K palette): one call, grouped results, scoped to what the viewer may see.

Each group reuses the permission helper its own page uses (``accessible_projects`` with that
page's permission key, ``visible_tasks``, ``channel_access``), so search never surfaces
something the page itself would hide. Matching is plain ``icontains`` with a per-group cap,
which is fast enough on SQLite for a studio's worth of rows. Postgres full-text (a
``SearchVector`` index) can replace ``_match`` later without changing the response shape.
"""
from django.db.models import Q

from app.models import (
    ChatChannel, ClientTeam, ClientTeamStatus, MediaVersion, MediaVersionStatus, Project, ProjectFile,
    ProjectStatus, WorkspaceMembership, WorkspaceMembershipStatus, WorkspacePrincipalType,
)
from app.permissions import (
    CLIENT_TEAM_READ, MEDIA_READ, PROJECT_FILE_READ, PROJECT_READ, WORKSPACE_MEMBERS_MANAGE,
    accessible_projects, has_workspace_permission,
)

from .dashboard import ROLE_CLIENT, ROLE_OWNER, dashboard_role, my_task_ids, visible_tasks
from .messages import channel_access, channel_label, ensure_workspace_channels

MIN_QUERY = 2
MAX_QUERY = 100
PER_GROUP = 6

HIDDEN_PROJECT_STATUSES = (ProjectStatus.PENDING_DELETION,)


def _match(fields, query):
    condition = Q()
    for field in fields:
        condition |= Q(**{f'{field}__icontains': query})
    return condition


def _person(user):
    if user is None:
        return ''
    return user.get_full_name().strip() or user.email


def quick_search(*, user, workspace, query, limit=PER_GROUP):
    query = ' '.join((query or '').split())[:MAX_QUERY]
    role = dashboard_role(user=user, workspace=workspace)
    result = {'query': query, 'role': role, 'groups': []}
    if len(query) < MIN_QUERY or role is None:
        return result
    client = role == ROLE_CLIENT
    groups = result['groups']

    def add(key, label, items):
        if items:
            groups.append({'key': key, 'label': label, 'items': items})

    # Projects (campaigns).
    project_ids = accessible_projects(user=user, workspace=workspace, permission_key=PROJECT_READ).values('id')
    projects = (Project.objects.filter(workspace=workspace, id__in=project_ids)
                .exclude(status__in=HIDDEN_PROJECT_STATUSES)
                .filter(_match(['name', 'client_team__name'], query))
                .select_related('client_team').order_by('-updated_at')[:limit])
    add('projects', 'Projects', [{
        'id': str(p.id), 'title': p.name,
        'subtitle': p.client_team.name if p.client_team_id else 'Studio project',
        'href': f'/portal/projects/{p.id}' if client else f'/projects?campaign={p.id}',
        'meta': p.status.replace('_', ' ').title(),
    } for p in projects])

    # Clients: the studio's client directory, never shown to clients themselves.
    if not client and role == ROLE_OWNER and has_workspace_permission(user=user, workspace=workspace, permission_key=CLIENT_TEAM_READ):
        clients = (ClientTeam.objects.filter(workspace=workspace, status=ClientTeamStatus.ACTIVE)
                   .filter(_match(['name', 'email', 'city'], query)).order_by('name')[:limit])
        add('clients', 'Clients', [{
            'id': str(c.id), 'title': c.name, 'subtitle': c.email or c.city or 'Client',
            'href': f'/clients?client={c.id}', 'meta': '',
        } for c in clients])

    # Cuts / versions.
    media_ids = accessible_projects(user=user, workspace=workspace, permission_key=MEDIA_READ).values('id')
    versions = (MediaVersion.objects.filter(project__workspace=workspace, project_id__in=media_ids, status=MediaVersionStatus.ACTIVE)
                .exclude(project__status__in=HIDDEN_PROJECT_STATUSES)
                .filter(_match(['title', 'original_file__original_name', 'project__name'], query))
                .select_related('project', 'original_file').order_by('-created_at')[:limit])
    add('cuts', 'Cuts & versions', [{
        'id': str(v.id), 'title': v.title or (v.original_file.original_name if v.original_file_id else f'Version {v.version_number}'),
        'subtitle': f'{v.project.name} · v{v.version_number}',
        'href': f'/review?project={v.project_id}&version={v.id}', 'meta': '',
    } for v in versions])

    # Files (the studio's library). Clients send files from the portal but don't browse the library.
    if not client:
        file_ids = accessible_projects(user=user, workspace=workspace, permission_key=PROJECT_FILE_READ).values('id')
        files = (ProjectFile.objects.filter(workspace=workspace, deleted_at__isnull=True, project_id__in=file_ids)
                 .filter(file__original_name__icontains=query)
                 .select_related('file', 'project').order_by('-created_at')[:limit])
        add('files', 'Files', [{
            'id': str(f.id), 'title': f.file.original_name,
            'subtitle': f.project.name if f.project_id else 'Library',
            'href': f'/files?all=1&q={f.file.original_name[:80]}' + (f'&project={f.project_id}' if f.project_id else ''),
            'meta': '',
        } for f in files])

    # Tasks: team only. Editors see the tasks they can read, theirs first.
    if not client:
        mine = set(my_task_ids(user=user, workspace=workspace))
        tasks = list(visible_tasks(user=user, workspace=workspace)
                     .filter(_match(['title', 'description'], query))
                     .select_related('project').order_by('due_at', '-updated_at')[:limit * 3])
        tasks.sort(key=lambda t: t.id not in mine)
        add('tasks', 'Tasks', [{
            'id': str(t.id), 'title': t.title,
            'subtitle': t.project.name if t.project_id else 'No project',
            'href': f'/tasks?task={t.id}', 'meta': 'Assigned to you' if t.id in mine else '',
        } for t in tasks[:limit]])

    # Chat channels: a project's channel or a client's General, whatever chat would list.
    ensure_workspace_channels(workspace)  # channels are created lazily, as the chat list does
    channel_match = Q(project__name__icontains=query) | Q(client_team__name__icontains=query)
    if query.lower() in 'general':
        channel_match |= Q(project__isnull=True, client_team__isnull=False)
    channels = (ChatChannel.objects.filter(workspace=workspace).filter(channel_match)
                .exclude(project__status__in=HIDDEN_PROJECT_STATUSES)
                .select_related('project', 'client_team', 'workspace').order_by('-last_message_at')[:limit * 3])
    rows = []
    for channel in channels:
        access = channel_access(user=user, chat_channel=channel)
        if not access:
            continue
        rows.append({
            'id': str(channel.id), 'title': channel_label(channel),
            'subtitle': channel.client_team.name if channel.client_team_id else 'Studio',
            'href': f"/portal/chat/{channel.id}" if access['kind'] == 'client' else f'/chat/{channel.id}',
            'meta': '',
        })
        if len(rows) >= limit:
            break
    add('chat', 'Chat', rows)

    # People: the team list is for whoever manages it.
    if role == ROLE_OWNER and has_workspace_permission(user=user, workspace=workspace, permission_key=WORKSPACE_MEMBERS_MANAGE):
        members = (WorkspaceMembership.objects.filter(
            workspace=workspace, status=WorkspaceMembershipStatus.ACTIVE, principal_type=WorkspacePrincipalType.USER,
        ).filter(_match(['user__first_name', 'user__last_name', 'user__email'], query))
            .select_related('user', 'role').order_by('user__first_name')[:limit])
        add('people', 'People', [{
            'id': str(m.id), 'title': _person(m.user), 'subtitle': m.user.email,
            'href': '/team', 'meta': m.role.name if m.role_id else '',
        } for m in members])

    return result
