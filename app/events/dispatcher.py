from collections import defaultdict


_subscribers = defaultdict(list)


def subscribe(event_name, handler):
    _subscribers[event_name].append(handler)


def dispatch(event):
    for handler in _subscribers[event.name]:
        handler(event)
