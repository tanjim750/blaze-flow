from django.conf import settings
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response


def paginated_response(*, request, queryset, serializer_class):
    try:
        limit = int(request.query_params.get('limit', settings.REVIEW_PAGE_SIZE))
        offset = int(request.query_params.get('offset', 0))
    except (TypeError, ValueError) as exc:
        raise ValidationError({'pagination': 'limit and offset must be integers.'}) from exc
    if limit < 1 or limit > settings.REVIEW_MAX_PAGE_SIZE:
        raise ValidationError({
            'limit': f'limit must be between 1 and {settings.REVIEW_MAX_PAGE_SIZE}.'
        })
    if offset < 0:
        raise ValidationError({'offset': 'offset cannot be negative.'})
    total = queryset.count()
    items = queryset[offset:offset + limit]
    response = Response(serializer_class(items, many=True).data)
    response['X-Pagination-Limit'] = str(limit)
    response['X-Pagination-Offset'] = str(offset)
    response['X-Pagination-Total'] = str(total)
    next_offset = offset + limit
    if next_offset < total:
        response['X-Pagination-Next-Offset'] = str(next_offset)
    return response
