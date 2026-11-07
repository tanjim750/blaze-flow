from django.urls import reverse
from rest_framework import serializers

from app.models import FileStatus, FileVariant, MediaVersion, MediaVersionStageEntry, OutboxEvent, PriorityLevel, WorkflowStageStatus
from app.services.file_processing import HQ_PROXY_VARIANT_TYPE, POSTER_VARIANT_TYPE, PREVIEW_VARIANT_TYPES

# The stills a list may show for a cut: the frame pulled from a video, or an image's own
# thumbnail. Shared with the poster route so the URL is only ever offered when it resolves.
MEDIA_POSTER_VARIANT_TYPES = (POSTER_VARIANT_TYPE, 'IMAGE_THUMBNAIL')


def prime_media_rows(medias):
    """Load what a list of cuts reads per row (variants, open stage entry, preview job) in
    three queries, and hang it on each instance. Every reader below falls back to its own
    query when a row was not primed, so single-object views behave as before."""
    medias = list(medias)
    if not medias:
        return medias
    file_ids = {m.original_file_id for m in medias}
    variants = {}
    for variant in FileVariant.objects.filter(file_id__in=file_ids, deleted_at__isnull=True).order_by('-created_at'):
        variants.setdefault(variant.file_id, []).append(variant)
    entries = {
        entry.media_version_id: entry
        for entry in MediaVersionStageEntry.objects.filter(
            media_version_id__in=[m.id for m in medias], exited_at__isnull=True,
        ).select_related('workflow_stage', 'changed_by_user', 'changed_by_guest_session')
    }
    events = {}
    for event in OutboxEvent.objects.filter(topic='file.preview.requested', aggregate_id__in=[str(f) for f in file_ids]).order_by('created_at'):
        events[event.aggregate_id] = event  # the newest wins, like `latest_preview_event`
    for media in medias:
        media._variants = variants.get(media.original_file_id, [])
        media._open_entry = entries.get(media.id)
        media._preview_event = events.get(str(media.original_file_id))
    return medias


def _variant_type(variant):
    return (variant.metadata or {}).get('variant_type')


def media_poster_variant(media):
    primed = getattr(media, '_variants', None)
    if primed is not None:
        return next((
            v for v in primed
            if v.status == FileStatus.READY and _variant_type(v) in MEDIA_POSTER_VARIANT_TYPES
        ), None)
    return FileVariant.objects.filter(
        file_id=media.original_file_id, status=FileStatus.READY, deleted_at__isnull=True,
        metadata__variant_type__in=MEDIA_POSTER_VARIANT_TYPES,
    ).order_by('-created_at').first()


class MediaUploadSerializer(serializers.Serializer):
    file = serializers.FileField()
    title = serializers.CharField(max_length=200)
    note = serializers.CharField(required=False, allow_blank=True)
    priority = serializers.ChoiceField(choices=PriorityLevel.choices, default=PriorityLevel.MEDIUM)
    allow_download = serializers.BooleanField(default=False)
    initial_stage_id = serializers.UUIDField(required=False)


class MediaVersionListSerializer(serializers.ListSerializer):
    def to_representation(self, data):
        return [self.child.to_representation(media) for media in prime_media_rows(data.all() if hasattr(data, 'all') else data)]


class MediaVersionSerializer(serializers.ModelSerializer):
    file = serializers.SerializerMethodField()
    current_stage = serializers.SerializerMethodField()
    preview_status = serializers.SerializerMethodField()
    # Which proxies the player can choose between: ['hq', 'sd'], ['sd'] or [].
    preview_qualities = serializers.SerializerMethodField()
    poster = serializers.SerializerMethodField()

    class Meta:
        model = MediaVersion
        list_serializer_class = MediaVersionListSerializer
        fields = (
            'id', 'project_id', 'version_number', 'title', 'note', 'priority',
            'allow_download', 'status', 'file', 'current_stage', 'preview_status', 'preview_qualities', 'poster', 'created_at',
        )

    def get_poster(self, media):
        """The still a list shows for this cut, or None until one has been generated.

        `url` is the permission-checked poster route; `width`/`height` are the frame's own
        size so a list can letterbox it instead of cropping it.
        """
        variant = media_poster_variant(media)
        if variant is None:
            return None
        metadata = variant.metadata or {}
        return {
            'url': reverse(
                'api-media-version-poster',
                args=[media.project.workspace_id, media.project_id, media.id],
            ),
            'width': metadata.get('width') or None,
            'height': metadata.get('height') or None,
        }

    def get_file(self, media):
        file_record = media.original_file
        return {
            'id': str(file_record.id),
            'name': file_record.original_name,
            'mime_type': file_record.mime_type,
            'size_bytes': file_record.size_bytes,
        }

    def get_current_stage(self, media):
        entry = media._open_entry if hasattr(media, '_open_entry') else media_stage_entries(media).filter(exited_at__isnull=True).select_related(
            'workflow_stage', 'changed_by_user', 'changed_by_guest_session'
        ).first()
        if not entry or not entry.workflow_stage:
            return None
        changed_by = entry.changed_by_user
        guest = entry.changed_by_guest_session
        return {
            'id': str(entry.workflow_stage.id),
            'name': entry.workflow_stage.name,
            'slug': entry.workflow_stage.slug,
            # Who moved the cut here and when: the review page shows "Approved by … · date".
            'entered_at': entry.entered_at,
            'changed_by': {
                'id': str(changed_by.id),
                'name': changed_by.get_full_name() or changed_by.email,
                'type': 'user',
            } if changed_by else {
                # A client's decision through a review link.
                'id': None, 'name': guest.name or 'Guest reviewer', 'type': 'guest',
            } if guest else None,
        }

    def get_preview_qualities(self, media):
        primed = getattr(media, '_variants', None)
        types = {
            _variant_type(v) for v in primed
            if v.status == FileStatus.READY and _variant_type(v) in (*PREVIEW_VARIANT_TYPES, HQ_PROXY_VARIANT_TYPE)
        } if primed is not None else set(FileVariant.objects.filter(
            file=media.original_file, deleted_at__isnull=True, status=FileStatus.READY,
            metadata__variant_type__in=[*PREVIEW_VARIANT_TYPES, HQ_PROXY_VARIANT_TYPE],
        ).values_list('metadata__variant_type', flat=True))
        qualities = []
        if HQ_PROXY_VARIANT_TYPE in types:
            qualities.append('hq')
        playable = {'VIDEO_PROXY'} if (media.original_file.mime_type or '').startswith('video/') else set(PREVIEW_VARIANT_TYPES)
        if types & playable:
            qualities.append('sd')
        return qualities

    def get_preview_status(self, media):
        from app.services.preview_state import latest_preview_event, preview_status
        primed = getattr(media, '_variants', None)
        if primed is not None:
            variants = [(_variant_type(v), v.status) for v in primed]
        else:
            variants = FileVariant.objects.filter(file=media.original_file, deleted_at__isnull=True).values_list('metadata__variant_type', 'status')
        event = media._preview_event if hasattr(media, '_preview_event') else latest_preview_event(media.original_file_id)
        return preview_status(media.original_file, variants, event)


def media_stage_entries(media):
    return MediaVersionStageEntry.objects.filter(media_version=media)


class WorkflowTransitionSerializer(serializers.Serializer):
    workflow_stage_id = serializers.UUIDField()
    workflow_stage_status_id = serializers.UUIDField(required=False, allow_null=True)


class WorkflowStageSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    slug = serializers.CharField()
    sort_order = serializers.IntegerField()
    statuses = serializers.SerializerMethodField()

    def get_statuses(self, stage):
        statuses = WorkflowStageStatus.objects.filter(
            workflow_stage=stage,
            status='ACTIVE',
        ).order_by('sort_order', 'name')
        return [
            {'id': str(item.id), 'name': item.name, 'slug': item.slug, 'sort_order': item.sort_order}
            for item in statuses
        ]


class StageHistorySerializer(serializers.ModelSerializer):
    stage = serializers.SerializerMethodField()
    stage_status = serializers.SerializerMethodField()

    class Meta:
        model = MediaVersionStageEntry
        fields = ('id', 'stage', 'stage_status', 'snapshot', 'entered_at', 'exited_at', 'created_at')

    def get_stage(self, entry):
        if not entry.workflow_stage:
            return None
        return {'id': str(entry.workflow_stage.id), 'name': entry.workflow_stage.name, 'slug': entry.workflow_stage.slug}

    def get_stage_status(self, entry):
        if not entry.workflow_stage_status:
            return None
        return {'id': str(entry.workflow_stage_status.id), 'name': entry.workflow_stage_status.name, 'slug': entry.workflow_stage_status.slug}
