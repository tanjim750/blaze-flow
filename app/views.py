from rest_framework.decorators import api_view
from rest_framework.response import Response

from .events import DomainEvent, dispatch
from .serializers import MessageSerializer


@api_view(['GET'])
def health_check(request):
    dispatch(DomainEvent(name='health.checked'))
    serializer = MessageSerializer({'message': 'ok'})
    return Response(serializer.data)
