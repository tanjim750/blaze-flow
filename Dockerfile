# syntax=docker/dockerfile:1
#
# Blaze Flow backend image.
#
#   docker build -t blazeflow-backend .                 # web / outbox worker / scheduler (default)
#   docker build --target ai -t blazeflow-backend-ai .  # + PaddleOCR for run_ai_qa_worker
#
# The default CMD runs gunicorn. Migrations are NOT run on start; run them once per release
# (`docker compose -f docker-compose.prod.yml run --rm migrate`). The dev compose file
# overrides the command, so local development still uses runserver.

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

ARG SUPERCRONIC_VERSION=v0.2.33
ARG SUPERCRONIC_SHA1SUM=71b0d58cc53f6bd72cf2f293e09e294b79c666d8

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg poppler-utils curl ca-certificates \
    && curl -fsSLo /usr/local/bin/supercronic \
        "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64" \
    && echo "${SUPERCRONIC_SHA1SUM}  /usr/local/bin/supercronic" | sha1sum -c - \
    && chmod +x /usr/local/bin/supercronic \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1000 app \
    && useradd --system --uid 1000 --gid app --home-dir /home/app --create-home app

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# ---------------------------------------------------------------------------------------
# AI QA worker image: base + PaddleOCR (requirements-ai.txt) + Hunspell dictionaries.
FROM base AS ai
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libgl1 libglib2.0-0 hunspell-en-gb hunspell-en-us \
    && rm -rf /var/lib/apt/lists/*
COPY requirements-ai.txt .
RUN pip install -r requirements-ai.txt
COPY --chown=app:app . .
RUN DJANGO_SECRET_KEY=build-only-not-secret python manage.py collectstatic --noinput \
    && mkdir -p /app/media /home/app/.paddlex && chown -R app:app /app/media /app/staticfiles /home/app
USER app
CMD ["python", "manage.py", "run_ai_qa_worker"]

# ---------------------------------------------------------------------------------------
# Default image (last stage, so a plain `docker build .` / dev compose gets this).
FROM base AS web
COPY --chown=app:app . .
RUN DJANGO_SECRET_KEY=build-only-not-secret python manage.py collectstatic --noinput \
    && mkdir -p /app/media && chown -R app:app /app/media /app/staticfiles
USER app
EXPOSE 8000
CMD ["gunicorn", "blazeflow.wsgi:application", "--config", "/app/deploy/gunicorn.conf.py"]
