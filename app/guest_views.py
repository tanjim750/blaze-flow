from django.core.files.storage import default_storage
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import (
    Annotation, AnnotationElement, AnnotationRevision, FileStatus, FileVariant, GuestInvite, GuestInvitePermission,
    GuestReviewAccess, GuestReviewAccessPermission, MediaVersion, Project,
    ReviewComment, ReviewCommentContent, ReviewCommentRevision,
)
from .permissions import REVIEW_COMMENT_MANAGE, active_memberships_for_user, has_project_permission
from .pagination import paginated_response
from .serializers import (
    AnnotationRevisionSerializer, AnnotationSerializer, AnnotationWriteSerializer, ReviewAttachmentSerializer,
    ReviewAttachmentUploadSerializer, ReviewCommentCreateSerializer,
    ReviewCommentRevisionSerializer, ReviewCommentSerializer,
)
from .services.annotations import (
    AnnotationError, create_guest_annotation, delete_guest_annotation,
    update_guest_annotation,
)
from .services.comments import (
    ReviewCommentError, create_guest_review_comment, delete_guest_review_comment,
    edit_guest_review_comment,
)
from .services.guest_access import (
    GUEST_ALLOWED_PERMISSIONS, GuestAccessError, authenticate_guest_access,
    create_guest_invite, exchange_guest_invite, revoke_guest_invite,
    revoke_guest_review_access, rotate_guest_access_key,
)
from .services.review_assets import (
    ReviewAttachmentError, delete_guest_review_attachment, upload_review_attachment,
)


class GuestInviteCreateSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=255, required=False, allow_blank=True)
    permissions = serializers.ListField(
        child=serializers.ChoiceField(choices=sorted(GUEST_ALLOWED_PERMISSIONS)),
        allow_empty=False,
    )
    expires_in_hours = serializers.IntegerField(min_value=1, max_value=24 * 365, default=168)


class GuestExchangeSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=255)
    name = serializers.CharField(max_length=150)
    email = serializers.EmailField(max_length=255)


class GuestReviewCommentEditSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=10000)


def _guest_access(request, project, permission):
    try:
        return authenticate_guest_access(
            project=project,
            access_key=request.headers.get('X-Guest-Access-Key', ''),
            permission=permission,
        )
    except GuestAccessError as exc:
        raise PermissionDenied(str(exc)) from exc


def _invite_data(invite):
    accesses = GuestReviewAccess.objects.filter(guest_invite=invite).select_related(
        'guest_session'
    ).order_by('created_at')
    return {
        'id': str(invite.id), 'project_id': str(invite.project_id), 'label': invite.label,
        'permissions': list(GuestInvitePermission.objects.filter(guest_invite=invite).values_list('permission_key', flat=True)),
        'expires_at': invite.expires_at, 'revoked_at': invite.revoked_at,
        'created_at': invite.created_at,
        'accesses': [{
            'id': str(access.id), 'guest_session_id': str(access.guest_session_id),
            'name': access.guest_session.name, 'email': access.guest_session.email,
            'permissions': list(GuestReviewAccessPermission.objects.filter(guest_review_access=access).values_list('permission_key', flat=True)),
            'last_accessed_at': access.last_accessed_at, 'revoked_at': access.revoked_at,
            'created_at': access.created_at,
        } for access in accesses],
    }


def _guest_manager(request, project):
    if not has_project_permission(user=request.user, project=project, permission_key=REVIEW_COMMENT_MANAGE):
        raise PermissionDenied('You do not have permission to manage guest review links.')
    return active_memberships_for_user(user=request.user, workspace=project.workspace).first()


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def project_guest_invites(request, workspace_id, project_id):
    project = get_object_or_404(Project.objects.select_related('workspace'), id=project_id, workspace_id=workspace_id)
    membership = _guest_manager(request, project)
    if request.method == 'GET':
        invites = GuestInvite.objects.filter(project=project).order_by('-created_at')
        return Response([_invite_data(invite) for invite in invites])
    serializer = GuestInviteCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        invite, token = create_guest_invite(project=project, membership=membership, **serializer.validated_data)
    except GuestAccessError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    data = _invite_data(invite)
    data.update({'token': token, 'warning': 'The token is returned only once. Store and share it securely.'})
    return Response(data, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def project_guest_invite_detail(request, workspace_id, project_id, invite_id):
    project = get_object_or_404(Project.objects.select_related('workspace'), id=project_id, workspace_id=workspace_id)
    membership = _guest_manager(request, project)
    invite = get_object_or_404(GuestInvite, id=invite_id, project=project)
    try:
        revoke_guest_invite(invite=invite, membership=membership, user=request.user)
    except GuestAccessError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def project_guest_access_detail(request, workspace_id, project_id, access_id):
    project = get_object_or_404(Project.objects.select_related('workspace'), id=project_id, workspace_id=workspace_id)
    membership = _guest_manager(request, project)
    access = get_object_or_404(GuestReviewAccess, id=access_id, guest_invite__project=project)
    try:
        revoke_guest_review_access(access=access, membership=membership, user=request.user)
    except GuestAccessError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def guest_exchange(request):
    serializer = GuestExchangeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        access, access_key = exchange_guest_invite(**serializer.validated_data)
    except GuestAccessError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response({
        'project_id': str(access.guest_invite.project_id),
        'guest_session_id': str(access.guest_session_id), 'access_key': access_key,
        'warning': 'The access key is returned only once. Send it as X-Guest-Access-Key.',
    }, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def guest_review(request, project_id):
    project = get_object_or_404(Project, id=project_id)
    _guest_access(request, project, 'media.read')
    media = MediaVersion.objects.filter(project=project, status='ACTIVE').order_by('version_number')
    return Response({
        'project': {'id': str(project.id), 'name': project.name, 'description': project.description},
        'media_versions': [
            {'id': str(item.id), 'title': item.title, 'version_number': item.version_number}
            for item in media
        ],
    })


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def guest_access_key_rotate(request, project_id):
    project = get_object_or_404(Project.objects.select_related('workspace'), id=project_id)
    try:
        access, access_key = rotate_guest_access_key(
            project=project, access_key=request.headers.get('X-Guest-Access-Key', ''),
        )
    except GuestAccessError as exc:
        raise PermissionDenied(str(exc)) from exc
    return Response({
        'guest_session_id': str(access.guest_session_id), 'access_key': access_key,
        'warning': 'The previous key is invalid. This replacement is returned only once.',
    })


@api_view(['GET', 'POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def guest_comments(request, project_id, media_version_id):
    project = get_object_or_404(Project, id=project_id)
    media = get_object_or_404(MediaVersion, id=media_version_id, project=project, status='ACTIVE')
    permission = 'review.comment.read' if request.method == 'GET' else 'review.comment.create'
    access = _guest_access(request, project, permission)
    if request.method == 'GET':
        comments = ReviewComment.objects.filter(media_version=media, deleted_at__isnull=True).select_related('author_user', 'author_guest_session').order_by('created_at')
        return paginated_response(
            request=request, queryset=comments,
            serializer_class=ReviewCommentSerializer,
        )
    serializer = ReviewCommentCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data.copy()
    data.pop('mentioned_user_ids', None)
    parent_id = data.pop('parent_comment_id', None)
    parent = get_object_or_404(ReviewComment, id=parent_id, media_version=media, deleted_at__isnull=True) if parent_id else None
    try:
        comment = create_guest_review_comment(media_version=media, guest_session=access.guest_session, parent_comment=parent, **data)
    except ReviewCommentError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(ReviewCommentSerializer(comment).data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@authentication_classes([])
@permission_classes([AllowAny])
def guest_comment_detail(request, project_id, media_version_id, comment_id):
    project = get_object_or_404(Project, id=project_id)
    media = get_object_or_404(MediaVersion, id=media_version_id, project=project, status='ACTIVE')
    permission = 'review.comment.edit' if request.method == 'PATCH' else 'review.comment.delete'
    access = _guest_access(request, project, permission)
    comment = get_object_or_404(ReviewComment, id=comment_id, media_version=media, deleted_at__isnull=True)
    if comment.author_guest_session_id != access.guest_session_id:
        raise PermissionDenied('Guests can change only their own comments.')
    try:
        if request.method == 'PATCH':
            serializer = GuestReviewCommentEditSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            comment = edit_guest_review_comment(
                comment=comment, guest_session=access.guest_session,
                text=serializer.validated_data['text'],
            )
            return Response(ReviewCommentSerializer(comment).data)
        delete_guest_review_comment(comment=comment, guest_session=access.guest_session)
    except ReviewCommentError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def guest_comment_revisions(request, project_id, media_version_id, comment_id):
    project = get_object_or_404(Project, id=project_id)
    media = get_object_or_404(MediaVersion, id=media_version_id, project=project, status='ACTIVE')
    _guest_access(request, project, 'review.comment.read')
    comment = get_object_or_404(ReviewComment, id=comment_id, media_version=media)
    revisions = ReviewCommentRevision.objects.filter(review_comment=comment).order_by('created_at')
    return Response(ReviewCommentRevisionSerializer(revisions, many=True).data)


@api_view(['GET', 'POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def guest_annotations(request, project_id, media_version_id):
    project = get_object_or_404(Project, id=project_id)
    media = get_object_or_404(MediaVersion, id=media_version_id, project=project, status='ACTIVE')
    permission = 'annotation.read' if request.method == 'GET' else 'annotation.create'
    access = _guest_access(request, project, permission)
    if request.method == 'GET':
        items = Annotation.objects.filter(media_version=media, deleted_at__isnull=True).order_by('created_at')
        return paginated_response(
            request=request, queryset=items, serializer_class=AnnotationSerializer,
        )
    serializer = AnnotationWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data.copy()
    comment_id = data.pop('review_comment_id', None)
    comment = get_object_or_404(ReviewComment, id=comment_id, media_version=media, deleted_at__isnull=True) if comment_id else None
    try:
        item = create_guest_annotation(media_version=media, guest_session=access.guest_session, review_comment=comment, **data)
    except AnnotationError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(AnnotationSerializer(item).data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@authentication_classes([])
@permission_classes([AllowAny])
def guest_annotation_detail(request, project_id, media_version_id, annotation_id):
    project = get_object_or_404(Project, id=project_id)
    media = get_object_or_404(MediaVersion, id=media_version_id, project=project, status='ACTIVE')
    permission = 'annotation.edit' if request.method == 'PATCH' else 'annotation.delete'
    access = _guest_access(request, project, permission)
    annotation = get_object_or_404(Annotation, id=annotation_id, media_version=media, deleted_at__isnull=True)
    if annotation.author_guest_session_id != access.guest_session_id:
        raise PermissionDenied('Guests can change only their own annotations.')
    if request.method == 'DELETE':
        delete_guest_annotation(annotation=annotation, guest_session=access.guest_session)
        return Response(status=status.HTTP_204_NO_CONTENT)
    payload = request.data.copy()
    if 'elements' not in payload:
        payload['elements'] = list(AnnotationElement.objects.filter(annotation=annotation).order_by('sort_order').values('element_type', 'geometry', 'style', 'payload'))
    for field in ('review_comment_id', 'start_time_ms', 'end_time_ms'):
        value = getattr(annotation, field)
        if field not in payload and value is not None:
            payload[field] = str(value) if field == 'review_comment_id' else value
    serializer = AnnotationWriteSerializer(data=payload)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data.copy()
    comment_id = data.pop('review_comment_id', annotation.review_comment_id)
    comment = get_object_or_404(ReviewComment, id=comment_id, media_version=media, deleted_at__isnull=True) if comment_id else None
    try:
        annotation = update_guest_annotation(
            annotation=annotation, guest_session=access.guest_session,
            review_comment=comment, **data,
        )
    except AnnotationError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(AnnotationSerializer(annotation).data)


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def guest_annotation_revisions(request, project_id, media_version_id, annotation_id):
    project = get_object_or_404(Project, id=project_id)
    media = get_object_or_404(MediaVersion, id=media_version_id, project=project, status='ACTIVE')
    _guest_access(request, project, 'annotation.read')
    annotation = get_object_or_404(Annotation, id=annotation_id, media_version=media)
    revisions = AnnotationRevision.objects.filter(annotation=annotation).order_by('created_at')
    return Response(AnnotationRevisionSerializer(revisions, many=True).data)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def guest_attachment_upload(request, project_id, media_version_id, comment_id):
    project = get_object_or_404(Project, id=project_id)
    media = get_object_or_404(MediaVersion, id=media_version_id, project=project, status='ACTIVE')
    access = _guest_access(request, project, 'review.attachment.create')
    comment = get_object_or_404(ReviewComment, id=comment_id, media_version=media, deleted_at__isnull=True)
    if comment.author_guest_session_id != access.guest_session_id:
        raise PermissionDenied('Guests can attach files only to their own comments.')
    serializer = ReviewAttachmentUploadSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        content = upload_review_attachment(
            comment=comment, guest_session=access.guest_session,
            upload=serializer.validated_data['file'],
        )
    except ReviewAttachmentError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(ReviewAttachmentSerializer(content).data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'DELETE'])
@authentication_classes([])
@permission_classes([AllowAny])
def guest_attachment_download(request, project_id, content_id):
    project = get_object_or_404(Project, id=project_id)
    permission = 'media.download' if request.method == 'GET' else 'review.attachment.delete'
    access = _guest_access(request, project, permission)
    content = get_object_or_404(
        ReviewCommentContent.objects.select_related('file'), id=content_id,
        review_comment__media_version__project=project, file__isnull=False,
        file__deleted_at__isnull=True, deleted_at__isnull=True,
    )
    if request.method == 'DELETE':
        if content.review_comment.author_guest_session_id != access.guest_session_id:
            raise PermissionDenied('Guests can delete attachments only from their own comments.')
        try:
            delete_guest_review_attachment(content=content, guest_session=access.guest_session)
        except ReviewAttachmentError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_204_NO_CONTENT)
    if content.file.status != FileStatus.READY:
        return Response({'detail': 'This attachment is still being processed.'}, status=status.HTTP_409_CONFLICT)
    if not default_storage.exists(content.file.object_key):
        raise Http404('The stored attachment was not found.')
    return FileResponse(default_storage.open(content.file.object_key, 'rb'), as_attachment=True, filename=content.file.original_name, content_type=content.file.mime_type)


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def guest_attachment_preview(request, project_id, content_id, variant_id):
    project = get_object_or_404(Project, id=project_id)
    _guest_access(request, project, 'media.read')
    content = get_object_or_404(
        ReviewCommentContent.objects.select_related('file'), id=content_id,
        review_comment__media_version__project=project, file__status=FileStatus.READY,
        file__deleted_at__isnull=True, deleted_at__isnull=True,
    )
    variant = get_object_or_404(
        FileVariant, id=variant_id, file=content.file, status=FileStatus.READY,
        deleted_at__isnull=True,
    )
    if not default_storage.exists(variant.object_key):
        raise Http404('The stored preview was not found.')
    return FileResponse(default_storage.open(variant.object_key, 'rb'), filename=variant.original_name, content_type=variant.mime_type)
