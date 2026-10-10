"""AI Visual QA API. Team members only: guests and client-team members get a plain 404."""
from django.conf import settings
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .ai_qa.service import (
    AIQAError, add_glossary_term, cancel_review, create_comment_from_finding, decide_finding, is_supported,
    retry_review, start_review,
)
from .models import AIFinding, AIReview, GlossaryTerm, MediaVersion, Project, Workspace
from .pagination import paginated_response
from .permissions import (
    REVIEW_COMMENT_CREATE, REVIEW_COMMENT_READ, has_project_permission, has_workspace_permission,
)
from .serializers.ai_qa import (
    AIFindingCommentSerializer, AIFindingSerializer, AIFindingUpdateSerializer,
    AIReviewSerializer, AIReviewStartSerializer, GlossaryTermSerializer, GlossaryTermWriteSerializer,
)
from .serializers.comments import ReviewCommentSerializer
from .services.comments import can_see_team_notes


def _enabled():
    if not settings.AI_VISUAL_QA_ENABLED:
        raise Http404


def _error(exc):
    return Response({'code': exc.code, 'detail': exc.message}, status=exc.status)


def _media(request, workspace_id, project_id, media_version_id, *, write):
    _enabled()
    workspace = get_object_or_404(Workspace, id=workspace_id)
    project = get_object_or_404(Project, id=project_id, workspace=workspace)
    media_version = get_object_or_404(
        MediaVersion.objects.select_related('original_file', 'project__workspace'),
        id=media_version_id, project=project,
    )
    key = REVIEW_COMMENT_CREATE if write else REVIEW_COMMENT_READ
    if not (can_see_team_notes(user=request.user, workspace=workspace)
            and has_project_permission(user=request.user, project=project, permission_key=key)):
        raise Http404  # never confirm to outsiders that a run or finding exists
    return workspace, project, media_version


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def ai_review_list_create(request, workspace_id, project_id, media_version_id):
    _, _, media_version = _media(request, workspace_id, project_id, media_version_id, write=request.method == 'POST')
    if request.method == 'GET':
        latest = AIReview.objects.filter(media_version=media_version).select_related('requested_by').first()
        can_run = has_project_permission(user=request.user, project=media_version.project, permission_key=REVIEW_COMMENT_CREATE)
        return Response({
            'supported': is_supported(media_version), 'can_run': can_run,
            'engine': settings.AI_QA_ENGINE,
            'max_video_seconds': settings.AI_QA_MAX_VIDEO_SECONDS,
            'latest': AIReviewSerializer(latest).data if latest else None,
        })
    serializer = AIReviewStartSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        review, created = start_review(media_version=media_version, user=request.user, **serializer.validated_data)
    except AIQAError as exc:
        return _error(exc)
    return Response(AIReviewSerializer(review).data, status=status.HTTP_202_ACCEPTED if created else status.HTTP_200_OK)


def _review(media_version, review_id):
    return get_object_or_404(AIReview.objects.select_related('requested_by'), id=review_id, media_version=media_version)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def ai_review_detail(request, workspace_id, project_id, media_version_id, review_id):
    _, _, media_version = _media(request, workspace_id, project_id, media_version_id, write=False)
    return Response(AIReviewSerializer(_review(media_version, review_id)).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def ai_review_retry(request, workspace_id, project_id, media_version_id, review_id):
    _, _, media_version = _media(request, workspace_id, project_id, media_version_id, write=True)
    try:
        review = retry_review(review=_review(media_version, review_id), user=request.user)
    except AIQAError as exc:
        return _error(exc)
    return Response(AIReviewSerializer(review).data, status=status.HTTP_202_ACCEPTED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def ai_review_cancel(request, workspace_id, project_id, media_version_id, review_id):
    _, _, media_version = _media(request, workspace_id, project_id, media_version_id, write=True)
    try:
        review = cancel_review(review=_review(media_version, review_id), user=request.user)
    except AIQAError as exc:
        return _error(exc)
    return Response(AIReviewSerializer(review).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def ai_review_findings(request, workspace_id, project_id, media_version_id, review_id):
    _, _, media_version = _media(request, workspace_id, project_id, media_version_id, write=False)
    review = _review(media_version, review_id)
    findings = AIFinding.objects.filter(ai_review=review).select_related('comment')
    for param, field in (('category', 'category'), ('band', 'band'), ('status', 'status')):
        value = request.query_params.get(param)
        if value:
            findings = findings.filter(**{f'{field}__in': value.split(',')})
    return paginated_response(request=request, queryset=findings, serializer_class=AIFindingSerializer)


def _finding(media_version, finding_id):
    return get_object_or_404(AIFinding.objects.select_related('comment', 'media_version__project'), id=finding_id, media_version=media_version)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def ai_finding_detail(request, workspace_id, project_id, media_version_id, finding_id):
    _, _, media_version = _media(request, workspace_id, project_id, media_version_id, write=True)
    serializer = AIFindingUpdateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        finding = decide_finding(finding=_finding(media_version, finding_id), user=request.user, **serializer.validated_data)
    except AIQAError as exc:
        return _error(exc)
    return Response(AIFindingSerializer(finding).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def ai_finding_comment(request, workspace_id, project_id, media_version_id, finding_id):
    _, _, media_version = _media(request, workspace_id, project_id, media_version_id, write=True)
    serializer = AIFindingCommentSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    try:
        comment, created = create_comment_from_finding(
            finding=_finding(media_version, finding_id), user=request.user,
            visibility=data['visibility'], text=data.get('text'),
        )
    except AIQAError as exc:
        return _error(exc)
    finding = AIFinding.objects.get(comment=comment)
    return Response(
        {'comment': ReviewCommentSerializer(comment).data, 'finding': AIFindingSerializer(finding).data},
        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
    )


def _glossary_workspace(request, workspace_id, *, write):
    _enabled()
    workspace = get_object_or_404(Workspace, id=workspace_id)
    allowed = can_see_team_notes(user=request.user, workspace=workspace) and has_workspace_permission(
        user=request.user, workspace=workspace, permission_key=REVIEW_COMMENT_CREATE if write else REVIEW_COMMENT_READ,
    )
    if not allowed:
        raise Http404
    return workspace


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def glossary_list_create(request, workspace_id):
    workspace = _glossary_workspace(request, workspace_id, write=request.method == 'POST')
    if request.method == 'GET':
        terms = GlossaryTerm.objects.filter(workspace=workspace, enabled=True)
        project_id = request.query_params.get('project')
        terms = terms.filter(project__isnull=True) | terms.filter(project_id=project_id) if project_id else terms.filter(project__isnull=True)
        return Response(GlossaryTermSerializer(terms.order_by('normalized')[:1000], many=True).data)
    serializer = GlossaryTermWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    project = get_object_or_404(Project, id=data['project_id'], workspace=workspace) if data.get('project_id') else None
    try:
        term = add_glossary_term(workspace=workspace, project=project, term=data['term'], user=request.user, kind=data['kind'])
    except AIQAError as exc:
        return _error(exc)
    return Response(GlossaryTermSerializer(term).data, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def glossary_detail(request, workspace_id, term_id):
    workspace = _glossary_workspace(request, workspace_id, write=True)
    term = get_object_or_404(GlossaryTerm, id=term_id, workspace=workspace)
    term.enabled = False
    term.save(update_fields=['enabled', 'updated_at'])
    return Response(status=status.HTTP_204_NO_CONTENT)
