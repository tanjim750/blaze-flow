"""Gunicorn settings for the production web container. Every value can be overridden by env.

gthread workers: each worker process serves ``threads`` requests concurrently, so a few slow
clients (uploads, legacy streamed responses) can no longer occupy every slot and starve
/api/health/. Downloads/playback redirect to presigned R2 URLs, so threads mostly wait on
Postgres/R2 API calls. Memory scales with workers (processes), not threads: 3 x ~250 MB.
"""
import os

bind = os.environ.get('GUNICORN_BIND', '0.0.0.0:8000')
worker_class = os.environ.get('GUNICORN_WORKER_CLASS', 'gthread')
workers = int(os.environ.get('GUNICORN_WORKERS', '3'))
threads = int(os.environ.get('GUNICORN_THREADS', '8'))
# Pending connections queued per worker beyond the busy threads.
worker_connections = int(os.environ.get('GUNICORN_WORKER_CONNECTIONS', '1000'))
# With gthread the timeout is a worker-heartbeat watchdog (a hung process), not a
# per-request limit; uploads that still stream through Django keep working. 120 s
# recycles a truly stuck worker without killing healthy long transfers on other threads.
timeout = int(os.environ.get('GUNICORN_TIMEOUT', '120'))
graceful_timeout = int(os.environ.get('GUNICORN_GRACEFUL_TIMEOUT', '30'))
keepalive = int(os.environ.get('GUNICORN_KEEPALIVE', '5'))
max_requests = int(os.environ.get('GUNICORN_MAX_REQUESTS', '1000'))
max_requests_jitter = int(os.environ.get('GUNICORN_MAX_REQUESTS_JITTER', '100'))
worker_tmp_dir = '/dev/shm'
accesslog = '-'
errorlog = '-'
loglevel = os.environ.get('GUNICORN_LOG_LEVEL', 'info')
forwarded_allow_ips = os.environ.get('GUNICORN_FORWARDED_ALLOW_IPS', '*')
