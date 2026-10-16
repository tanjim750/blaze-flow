"""Client decisions on the signed-in review page (see ``services/decisions.py``).

``GET`` lists the decisions recorded on one cut (the "Approved by client" proof) and says
what the viewer may do on the review bar, so the page never offers a button the API will
refuse. ``POST`` is how a client-team member approves or requests changes; team members
keep using the workflow and revision-request routes, which is what their buttons call.
"""
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .guest_views import GuestDecisionSerializer
from .models import MediaVersion, Project, ReviewDecision, Workspace
from .permissions import (
    MEDIA_READ, MEDIA_TRANSITION, REVIEW_COMMENT_CREATE, REVIEW_DECISION_CREATE, has_project_permission,
)
from .services.comments import can_see_team_notes
from .services.decisions import ReviewDecisionError, decision_data, record_decision


def review_capabilities(*, user, project):
    """What the review bar may offer this viewer on this project."""
    team = can_see_team_notes(user=user, workspace=project.workspace)
    can_transition = has_project_permission(user=user, project=project, permission_key=MEDIA_TRANSITION)
    can_request = can_transition and has_project_permission(user=user, project=project, permission_key=REVIEW_COMMENT_CREATE)
    can_decide = not team and (
        can_transition or has_project_permission(user=user, project=project, permission_key=REVIEW_DECISION_CREATE)
    )
    return {
        'kind': 'team' if team else 'client',
        # Team buttons: Approve moves the cut to the approval stage; Request changes posts a
        # note and moves it to Revision.
        'can_transition': bool(team and can_transition),
        'can_request_changes': bool(team and can_request),
        # Client buttons: the same two actions, recorded as a client decision.
        'can_decide': bool(can_decide),
    }


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def media_version_decisions(request, workspace_id, project_id, media_version_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    project = get_object_or_404(Project.objects.select_related('workspace'), id=project_id, workspace=workspace)
    media = get_object_or_404(MediaVersion, id=media_version_id, project=project)
    if not has_project_permission(user=request.user, project=project, permission_key=MEDIA_READ):
        raise PermissionDenied('You do not have permission to view this media version.')
    viewer = review_capabilities(user=request.user, project=project)
    if request.method == 'GET':
        records = ReviewDecision.objects.filter(media_version=media).select_related(
            'media_version', 'guest_invite',
        ).order_by('-created_at')
        # Link labels and reviewer emails are the studio's bookkeeping, not the client's.
        private = viewer['kind'] == 'team'
        return Response({
            'results': [decision_data(item, include_private=private) for item in records],
            'viewer': viewer,
        })
    if viewer['kind'] != 'client':
        raise PermissionDenied('Team members approve and request changes from the review bar, not as a client.')
    if not viewer['can_decide']:
        raise PermissionDenied('Your role does not allow approving or requesting changes.')
    serializer = GuestDecisionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        record, _ = record_decision(media_version=media, user=request.user, **serializer.validated_data)
    except ReviewDecisionError as exc:
        return Response({'detail': str(exc)}, status=exc.status)
    return Response(decision_data(record, include_private=False), status=status.HTTP_201_CREATED)
