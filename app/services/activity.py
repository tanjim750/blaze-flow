"""The activity feed: audited events, permission-scoped and turned into readable rows.

The feed reads ``AuditLog`` and nothing else. Each row is shown only if the viewer could
see the thing it is about:

* task events need ``task.read`` on the task's project; tasks outside any project are
  internal and only workspace users (not client-team members) see them;
* review-note events need ``review.comment.read`` and media events ``media.read`` on the
  project;
* guest-link events need ``review.comment.manage`` (the permission that manages links);
* events about a team-only note (``team_only``) never reach client-team members.

Guests have no session on these routes, so they get nothing.
"""
import csv
import io
import uuid
from datetime import timezone as dt_timezone
from urllib.parse import urlencode

from django.db.models import Max, Q

from app.models import (
    AuditActorType, AuditLog, GuestInvite, GuestReviewAccess, MediaVersion, MediaVersionStageEntry, NotificationKind, Project,
    ReviewComment, ReviewCommentContent, ReviewCommentContentType, ReviewDecision, Task,
)
from app.permissions import (
    MEDIA_READ, PROJECT_FILE_READ, PROJECT_READ, REVIEW_COMMENT_MANAGE, REVIEW_COMMENT_READ, TASK_READ,
    accessible_projects, has_workspace_permission,
)

from .comments import can_see_team_notes
from .notifications import stage_outcome

CATEGORIES = {
    'tasks': (
        'task.created', 'task.assigned', 'task.unassigned', 'task.stage.moved', 'task.due_date.changed',
    ),
    'comments': ('review.comment.created', 'review.comment.resolved', 'review.comment.reopened'),
    'media': (
        'media.uploaded', 'media.workflow.transitioned', 'media.revision.requested',
        'review.decision.approved', 'review.decision.changes_requested',
    ),
    'guests': (
        'guest.invite.created', 'guest.link.opened', 'guest.media.viewed',
        'guest.invite.revoked', 'guest.access.revoked', 'guest.invite.updated',
    ),
    # Files a client sent in. Link management rows are written team-only, so clients see
    # their own uploads here but never the links.
    'uploads': ('client_upload.received', 'upload_link.created', 'upload_link.revoked'),
}
CATEGORY_PERMISSIONS = {
    'tasks': TASK_READ, 'comments': REVIEW_COMMENT_READ, 'media': MEDIA_READ, 'guests': REVIEW_COMMENT_MANAGE,
    'uploads': PROJECT_READ,
}
CATEGORY_OF = {action: category for category, actions in CATEGORIES.items() for action in actions}
FEED_ACTIONS = tuple(CATEGORY_OF)
CSV_MAX_ROWS = 5000


class ActivityFilterError(ValueError):
    pass


def _uuid(value, field):
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise ActivityFilterError(f'{field} must be an id.') from exc


def visible_activity(*, user, workspace):
    """Every feed event in ``workspace`` the viewer may see, newest first."""
    sees_team = can_see_team_notes(user=user, workspace=workspace)
    allowed = Q(pk__in=[])
    for category, permission in CATEGORY_PERMISSIONS.items():
        project_ids = accessible_projects(user=user, workspace=workspace, permission_key=permission).values('id')
        allowed |= Q(action__in=CATEGORIES[category], project_id__in=project_ids)
    if sees_team and has_workspace_permission(user=user, workspace=workspace, permission_key=TASK_READ):
        allowed |= Q(action__in=CATEGORIES['tasks'], project__isnull=True)
    rows = AuditLog.objects.filter(workspace=workspace).filter(allowed)
    # A client decision is one row ("Rachel Kim approved 'Hero' V2 as the client"); the stage
    # move it caused is part of it, not a second event.
    rows = rows.exclude(
        action__in=('media.workflow.transitioned', 'review.comment.created'), metadata__has_key='review_decision_id',
    )
    if not sees_team:
        rows = rows.filter(team_only=False)
    return rows.select_related('actor_user', 'actor_guest_session').order_by('-created_at', '-id')


def filter_activity(rows, *, project=None, actor=None, types=None):
    """``actor`` is a user id or ``guests``; ``types`` is a comma list of categories or actions."""
    if project:
        rows = rows.filter(project_id=_uuid(project, 'project'))
    if actor:
        if actor == 'guests':
            rows = rows.filter(actor_type=AuditActorType.GUEST)
        else:
            rows = rows.filter(actor_user_id=_uuid(actor, 'actor'))
    if types:
        actions = set()
        for item in (part.strip() for part in types.split(',')):
            if not item:
                continue
            if item in CATEGORIES:
                actions.update(CATEGORIES[item])
            elif item in CATEGORY_OF:
                actions.add(item)
            else:
                raise ActivityFilterError(f'Unknown activity type "{item}". Use one of: {", ".join(CATEGORIES)}.')
        if actions:
            rows = rows.filter(action__in=actions)
    return rows


# ---------------------------------------------------------------------------- hydration

def _initials(name):
    parts = [part for part in (name or '').split() if part]
    if not parts:
        return '?'
    return f'{parts[0][0]}{parts[-1][0] if len(parts) > 1 else ""}'.upper()


def _actor(row):
    if row.actor_type == AuditActorType.GUEST and row.actor_guest_session_id:
        name = row.actor_guest_session.name or 'A guest reviewer'
        return {'type': 'guest', 'id': None, 'name': name, 'initials': _initials(name), 'avatar_url': None}
    user = row.actor_user
    if user is None and row.action == 'client_upload.received':
        # Sent through a public upload link: the sender typed their name, there is no account.
        name = (row.metadata or {}).get('uploader_name') or 'A client'
        return {'type': 'client', 'id': None, 'name': name, 'initials': _initials(name), 'avatar_url': None}
    if user is None:
        return {'type': 'system', 'id': None, 'name': 'Blaze Flow', 'initials': 'BF', 'avatar_url': None}
    name = user.get_full_name() or user.email
    return {'type': 'user', 'id': str(user.id), 'name': name, 'initials': _initials(name), 'avatar_url': user.avatar_url or None}


def _review_href(project_id, media_version_id=None, comment_id=None, share=False):
    query = {'project': str(project_id)}
    if media_version_id:
        query['version'] = str(media_version_id)
    if comment_id:
        query['comment'] = str(comment_id)
    if share:
        query['share'] = '1'
    return f'/review?{urlencode(query)}'


def _version_decision(entry):
    if entry is None or entry.workflow_stage is None:
        return None
    kind = stage_outcome(entry.workflow_stage)
    if kind == NotificationKind.MEDIA_APPROVED:
        return 'approved'
    if kind == NotificationKind.MEDIA_CHANGES_REQUESTED:
        return 'changes_requested'
    return None


DECISION_LABELS = {None: 'no decision yet', 'approved': 'approved', 'changes_requested': 'changes requested'}


class _Lookups:
    """Everything a page of rows refers to, fetched in a handful of queries."""

    def __init__(self, rows, *, sees_team):
        self.sees_team = sees_team
        ids = {}
        for row in rows:
            ids.setdefault(row.entity_type, set()).add(row.entity_id)
        meta = [row.metadata or {} for row in rows]

        def keys(values):
            out = set()
            for value in values:
                try:
                    out.add(uuid.UUID(str(value)))
                except (TypeError, ValueError):
                    pass
            return out

        self.projects = {str(p.id): p for p in Project.objects.filter(id__in={row.project_id for row in rows if row.project_id})}
        self.tasks = {str(t.id): t for t in Task.objects.filter(id__in=keys(ids.get('task', ())))}
        comment_ids = keys(ids.get('review_comment', ())) | keys(m.get('review_comment_id') for m in meta)
        self.comments = {
            str(c.id): c for c in ReviewComment.objects.filter(id__in=comment_ids).select_related('parent_comment')
        }
        self.excerpts = {}
        for content in ReviewCommentContent.objects.filter(
            review_comment_id__in=[c.id for c in self.comments.values()],
            content_type=ReviewCommentContentType.TEXT, deleted_at__isnull=True,
        ).order_by('sort_order'):
            self.excerpts.setdefault(str(content.review_comment_id), content.text_content or '')
        media_ids = keys(ids.get('media_version', ())) | {c.media_version_id for c in self.comments.values()} | keys(
            m.get('media_version_id') for m in meta
        )
        self.media = {str(m.id): m for m in MediaVersion.objects.filter(id__in=media_ids)}
        entry_ids = keys(m.get('from_entry_id') for m in meta) | keys(m.get('to_entry_id') for m in meta)
        self.entries = {str(e.id): e for e in MediaVersionStageEntry.objects.filter(id__in=entry_ids).select_related('workflow_stage')}
        self.current_stage = {
            str(e.media_version_id): e for e in MediaVersionStageEntry.objects.filter(
                media_version_id__in=[m.id for m in self.media.values()], exited_at__isnull=True,
            ).select_related('workflow_stage')
        }
        invite_ids = keys(ids.get('guest_invite', ())) | keys(m.get('guest_invite_id') for m in meta)
        self.invites = {str(i.id): i for i in GuestInvite.objects.filter(id__in=invite_ids)}
        # Projects whose Files the viewer can open; a client-upload row links there only then.
        self.file_projects = set()

    def comment_visible(self, comment):
        if comment is None:
            return False
        team = comment.visibility == 'team' or (comment.parent_comment and comment.parent_comment.visibility == 'team')
        return self.sees_team or not team


def _clip(text, limit=140):
    text = ' '.join((text or '').split())
    return text if len(text) <= limit else f'{text[:limit - 1]}…'


def _stage_name(ref):
    return (ref or {}).get('name') or 'no stage'


def _cut_label(media, meta):
    title = (media.title if media else None) or meta.get('title') or 'a cut'
    number = media.version_number if media else meta.get('version_number')
    return title, number


def describe(row, lookups):
    """One feed row: who, did what, to which object (with a link), and what changed."""
    meta = row.metadata or {}
    action = row.action
    project = lookups.projects.get(str(row.project_id)) if row.project_id else None
    item = {
        'id': str(row.id), 'created_at': row.created_at, 'action': action,
        'category': CATEGORY_OF.get(action), 'actor': _actor(row),
        'project': {'id': str(project.id), 'name': project.name} if project else None,
        'verb': action, 'object': None, 'before': None, 'after': None, 'detail': {},
        'team_only': row.team_only,
    }
    actor = item['actor']['name']
    obj = None
    if action.startswith('task.'):
        task = lookups.tasks.get(row.entity_id)
        title = meta.get('task_title') or (task.title if task else 'a task')
        live = task is not None and task.deleted_at is None
        obj = {'type': 'task', 'id': row.entity_id, 'label': title, 'href': f"/tasks?{urlencode({'task': row.entity_id})}" if live else None}
        if action == 'task.created':
            stage = meta.get('stage') or {}
            item.update(verb='created', after=stage.get('name'))
            item['detail'] = {'stage_kind': stage.get('kind')}
            summary = f"{actor} created '{title}'" + (f" in {stage['name']}" if stage.get('name') else '')
        elif action == 'task.stage.moved':
            before, after = meta.get('from_stage') or {}, meta.get('to_stage') or {}
            item.update(verb='moved', before=_stage_name(before), after=_stage_name(after))
            item['detail'] = {'from_kind': before.get('kind'), 'to_kind': after.get('kind'), 'reason': meta.get('reason')}
            summary = f"{actor} moved '{title}' from {item['before']} → {item['after']}"
        elif action == 'task.due_date.changed':
            item.update(verb='changed the due date of', before=meta.get('before'), after=meta.get('after'))
            summary = f"{actor} changed the due date of '{title}' from {(meta.get('before') or 'none')[:10]} → {(meta.get('after') or 'none')[:10]}"
        elif action in ('task.assigned', 'task.unassigned'):
            assignee = (meta.get('assignee') or {}).get('name') or 'someone'
            item['detail'] = {'assignee': assignee}
            if action == 'task.assigned':
                item.update(verb='assigned', after=assignee)
                summary = f"{actor} assigned '{title}' to {assignee}"
            else:
                item.update(verb='unassigned', before=assignee)
                summary = f"{actor} unassigned {assignee} from '{title}'"
    elif action.startswith('review.comment.'):
        comment = lookups.comments.get(row.entity_id)
        media = lookups.media.get(str(comment.media_version_id)) if comment else lookups.media.get(meta.get('media_version_id') or '')
        title, number = _cut_label(media, meta)
        obj = {
            'type': 'media_version', 'id': str(media.id) if media else None, 'label': title,
            'href': _review_href(media.project_id, media.id, comment.id if comment and comment.deleted_at is None else None) if media else None,
        }
        reply = bool(comment and comment.parent_comment_id)
        excerpt = lookups.excerpts.get(row.entity_id) if comment and comment.deleted_at is None and lookups.comment_visible(comment) else None
        item['detail'] = {'version_number': number, 'reply': reply, 'excerpt': _clip(excerpt) if excerpt else None}
        verb = {
            'review.comment.created': 'replied on' if reply else 'commented on',
            'review.comment.resolved': 'resolved a note on', 'review.comment.reopened': 'reopened a note on',
        }[action]
        item['verb'] = verb
        summary = f"{actor} {verb} '{title}'" + (f' V{number}' if number else '')
    elif action.startswith('review.decision.'):
        media = lookups.media.get(row.entity_id)
        title, number = _cut_label(media, meta)
        comment_id = meta.get('review_comment_id')
        obj = {'type': 'media_version', 'id': row.entity_id, 'label': title,
               'href': _review_href(media.project_id, media.id, comment_id) if media and media.status == 'ACTIVE' else None}
        decision = meta.get('decision')
        item['detail'] = {
            'version_number': number, 'decision': decision, 'client_decision': True,
            'open_notes_count': meta.get('open_notes_count'),
            'excerpt': _clip(lookups.excerpts.get(comment_id)) if comment_id and lookups.excerpts.get(comment_id) else None,
            'guest_name': meta.get('reviewer_name'),
        }
        stage = (meta.get('stage') or {}).get('name')
        if meta.get('workflow_transitioned'):
            item['after'] = stage
        suffix = f' V{number}' if number else ''
        if decision == 'approved':
            item['verb'] = 'approved'
            summary = f"{actor} approved '{title}'{suffix} as the client"
        else:
            item['verb'] = 'requested changes on'
            summary = f"{actor} requested changes on '{title}'{suffix} as the client"
    elif action.startswith('media.'):
        media = lookups.media.get(row.entity_id)
        title, number = _cut_label(media, meta)
        obj = {'type': 'media_version', 'id': row.entity_id, 'label': title,
               'href': _review_href(media.project_id, media.id) if media and media.status == 'ACTIVE' else None}
        item['detail'] = {'version_number': number}
        suffix = f' V{number}' if number else ''
        if action == 'media.uploaded':
            item['verb'] = 'uploaded'
            summary = f"{actor} uploaded '{title}'{suffix}"
        elif action == 'media.revision.requested':
            item['verb'] = 'requested changes on'
            summary = f"{actor} requested changes on '{title}'{suffix}"
        else:
            source = lookups.entries.get(meta.get('from_entry_id') or '')
            target = lookups.entries.get(meta.get('to_entry_id') or '')
            before = (meta.get('from_stage') or {}).get('name') or (source.workflow_stage.name if source and source.workflow_stage else None)
            after = (meta.get('to_stage') or {}).get('name') or (target.workflow_stage.name if target and target.workflow_stage else None)
            item.update(verb='moved', before=before, after=after)
            decision = _version_decision(target)
            item['detail']['decision'] = decision
            if decision == 'approved':
                item['verb'] = 'approved'
                summary = f"{actor} approved '{title}'{suffix}"
            else:
                summary = f"{actor} moved '{title}'{suffix} from {before or '?'} → {after or '?'}"
    elif action.startswith('guest.'):
        invite = lookups.invites.get(meta.get('guest_invite_id') or row.entity_id)
        label = meta.get('label') or (invite.label if invite else None) or 'Untitled link'
        href = _review_href(row.project_id, share=True) if row.project_id else None
        obj = {'type': 'guest_invite', 'id': str(invite.id) if invite else meta.get('guest_invite_id'), 'label': label, 'href': href}
        guest = meta.get('guest_name')
        item['detail'] = {'guest_name': guest}
        if action == 'guest.invite.created':
            item['verb'] = 'created review link'
            summary = f"{actor} created review link '{label}'"
        elif action == 'guest.link.opened':
            item['verb'] = 'opened review link'
            summary = f"{actor} opened review link '{label}'"
        elif action == 'guest.media.viewed':
            media = lookups.media.get(meta.get('media_version_id') or row.entity_id)
            title, number = _cut_label(media, meta)
            decision = _version_decision(lookups.current_stage.get(str(media.id))) if media else None
            item['verb'] = 'opened review link'
            item['detail'].update(version_number=number, media_title=title, decision=decision)
            if media and media.status == 'ACTIVE':
                obj = {'type': 'media_version', 'id': str(media.id), 'label': title, 'href': _review_href(media.project_id, media.id)}
            summary = f"{actor} opened review link · {title} V{number} · {DECISION_LABELS[decision]}"
        elif action == 'guest.invite.updated':
            allow = bool(meta.get('allow_decisions'))
            item.update(verb='allowed decisions on review link' if allow else 'turned off decisions on review link')
            item['detail']['allow_decisions'] = allow
            summary = f"{actor} {item['verb']} '{label}'"
        elif action == 'guest.invite.revoked':
            item['verb'] = 'revoked review link'
            summary = f"{actor} revoked review link '{label}'"
        else:
            item.update(verb='revoked guest access for', before=guest)
            summary = f"{actor} revoked {guest or 'a guest'}'s access to '{label}'"
    elif action == 'client_upload.received':
        name = meta.get('file_name') or 'a file'
        folder = meta.get('folder_id')
        href = f"/files?{urlencode({'folder': folder})}" if folder and str(row.project_id) in lookups.file_projects else None
        obj = {'type': 'project_file', 'id': row.entity_id, 'label': name, 'href': href}
        label = meta.get('label')
        item['verb'] = 'sent'
        item['detail'] = {'via': meta.get('via'), 'link_label': label}
        summary = f"{actor} sent '{name}'" + (f" through upload link '{label}'" if label else ' from the client portal')
    elif action.startswith('upload_link.'):
        label = meta.get('label') or 'Untitled link'
        href = f"/projects?{urlencode({'campaign': str(row.project_id), 'tab': 'client-uploads'})}" if row.project_id else None
        obj = {'type': 'upload_link', 'id': row.entity_id, 'label': label, 'href': href}
        item['verb'] = 'created upload link' if action == 'upload_link.created' else 'turned off upload link'
        summary = f"{actor} {item['verb']} '{label}'"
    else:  # pragma: no cover - FEED_ACTIONS is closed
        summary = f'{actor} {action}'
    item['object'] = obj
    item['summary'] = summary
    return item


def describe_rows(rows, *, user, workspace):
    rows = list(rows)
    sees_team = can_see_team_notes(user=user, workspace=workspace)
    lookups = _Lookups(rows, sees_team=sees_team)
    if any(row.action == 'client_upload.received' for row in rows):
        lookups.file_projects = {
            str(pid) for pid in accessible_projects(user=user, workspace=workspace, permission_key=PROJECT_FILE_READ).values_list('id', flat=True)
        }
    out = []
    for row in rows:
        # Belt and braces: a note made team-only after the event was written still stays hidden.
        if not sees_team and row.action.startswith('review.comment.'):
            comment = lookups.comments.get(row.entity_id)
            if comment is not None and not lookups.comment_visible(comment):
                continue
        out.append(describe(row, lookups))
    return out


def _safe_cell(value):
    """Spreadsheet apps run cells that start with these as formulas."""
    text = '' if value is None else str(value)
    return f"'{text}" if text[:1] in ('=', '+', '-', '@', '\t', '\r') else text


CSV_COLUMNS = ('time_utc', 'actor', 'actor_type', 'category', 'action', 'summary', 'project', 'object', 'before', 'after', 'link')


def activity_csv(items):
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CSV_COLUMNS)
    for item in items:
        obj = item['object'] or {}
        writer.writerow([_safe_cell(value) for value in (
            item['created_at'].astimezone(dt_timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            item['actor']['name'], item['actor']['type'], item['category'], item['action'], item['summary'],
            (item['project'] or {}).get('name'), obj.get('label'), item['before'], item['after'], obj.get('href'),
        )])
    return buffer.getvalue()


def guest_link_status(*, project, invites):
    """``{invite_id: {...}}``: when each link was last opened, on which cut, and its decision."""
    wanted = {str(invite.id) for invite in invites}
    status = {key: {'visits': 0, 'last_opened_at': None, 'last_version_number': None,
                    'last_media_version_id': None, 'decision': None} for key in wanted}
    rows = AuditLog.objects.filter(
        project=project, action__in=('guest.link.opened', 'guest.media.viewed'),
    ).order_by('-created_at')[:1000]
    for row in rows:
        meta = row.metadata or {}
        key = meta.get('guest_invite_id')
        if key not in wanted:
            continue
        entry = status[key]
        entry['visits'] += 1
        if entry['last_opened_at'] is None:
            entry['last_opened_at'] = row.created_at
        if row.action == 'guest.media.viewed' and entry['last_media_version_id'] is None:
            entry['last_media_version_id'] = meta.get('media_version_id')
            entry['last_version_number'] = meta.get('version_number')
    # Links redeemed before guest visits were audited still have the access row's own clock.
    unseen = [key for key, entry in status.items() if entry['last_opened_at'] is None]
    if unseen:
        for row in GuestReviewAccess.objects.filter(guest_invite_id__in=unseen, last_accessed_at__isnull=False).values('guest_invite_id').annotate(last=Max('last_accessed_at')):
            status[str(row['guest_invite_id'])]['last_opened_at'] = row['last']
    # The real decision: the latest one a reviewer made through this link, and on which cut.
    # A team approval of the same cut is not the client's decision, so it is not shown here.
    for record in ReviewDecision.objects.filter(guest_invite_id__in=wanted).select_related('media_version').order_by('created_at'):
        entry = status[str(record.guest_invite_id)]
        entry.update(
            decision=record.decision, decision_version_number=record.media_version.version_number,
            decision_media_version_id=str(record.media_version_id), decided_at=record.created_at,
            decided_by=record.reviewer_name,
        )
    for entry in status.values():
        entry.setdefault('decision_version_number', None)
        entry.setdefault('decision_media_version_id', None)
        entry.setdefault('decided_at', None)
        entry.setdefault('decided_by', None)
    return status
