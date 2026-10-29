# syntax=docker/dockerfile:1
#
# Krewsys backend image.
#
#   docker build -t blazeflow-backend .                 # web / outbox worker / scheduler (default)
#   docker build --target ai -t blazeflow-backend-ai .  # + PaddleOCR for run_ai_qa_worker
#
# Builds natively on linux/amd64 and linux/arm64 (e.g. docker buildx build --platform linux/arm64).
#
# The default CMD runs gunicorn. Migrations are NOT run on start; run them once per release
# (`docker compose -f docker-compose.prod.yml run --rm migrate`). The dev compose file
# overrides the command, so local development still uses runserver.

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Multi-arch: linux/amd64 and linux/arm64 (e.g. Oracle Cloud Ampere A1). TARGETARCH is set by
# BuildKit (docker compose / buildx); the classic builder falls back to dpkg's architecture.
ARG TARGETARCH
# supercronic release binaries, one per architecture. SHA1 sums from the official release
# notes: https://github.com/aptible/supercronic/releases/tag/v0.2.33
ARG SUPERCRONIC_VERSION=v0.2.33
ARG SUPERCRONIC_SHA1SUM_AMD64=71b0d58cc53f6bd72cf2f293e09e294b79c666d8
ARG SUPERCRONIC_SHA1SUM_ARM64=e0f0c06ebc5627e43b25475711e694450489ab00

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg poppler-utils curl ca-certificates \
    && ARCH="${TARGETARCH:-$(dpkg --print-architecture)}" \
    && case "$ARCH" in \
        amd64) SUPERCRONIC_SHA1SUM="${SUPERCRONIC_SHA1SUM_AMD64}" ;; \
        arm64) SUPERCRONIC_SHA1SUM="${SUPERCRONIC_SHA1SUM_ARM64}" ;; \
        *) echo "Unsupported architecture for supercronic: $ARCH" >&2; exit 1 ;; \
       esac \
    && curl -fsSLo /usr/local/bin/supercronic \
        "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${ARCH}" \
    && echo "${SUPERCRONIC_SHA1SUM}  /usr/local/bin/supercronic" | sha1sum -c - \
    && chmod +x /usr/local/bin/supercronic \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1000 app \
    && useradd --system --uid 1000 --gid app --home-dir /home/app --create-home app

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# ---------------------------------------------------------------------------------------
# AI QA worker image: base + PaddleOCR (requirements-ai.txt) + Hunspell dictionaries.
#
# PyPI only ships paddlepaddle for x86_64 Linux. On arm64 the same version is installed first
# from Paddle's official CPU index, https://www.paddlepaddle.org.cn/packages/stable/cpu/
# (its links point at paddle-whl.cdn.bcebos.com; wheel pinned by SHA256, --no-deps); the pip install of
# requirements-ai.txt then sees paddlepaddle==3.3.1 already satisfied and resolves its
# dependencies (and everything else) from PyPI as usual. amd64 is unchanged.
FROM base AS ai
ARG TARGETARCH
ARG PADDLE_ARM64_WHEEL=https://paddle-whl.cdn.bcebos.com/stable/cpu/paddlepaddle/paddlepaddle-3.3.1-cp312-cp312-linux_aarch64.whl
ARG PADDLE_ARM64_SHA256=1302baafdf91e4f4f2108622219d8b519e5593a908c3d7b95d5a9ef24ba48019
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libgl1 libglib2.0-0 hunspell-en-gb hunspell-en-us \
    && rm -rf /var/lib/apt/lists/*
COPY requirements-ai.txt .
RUN ARCH="${TARGETARCH:-$(dpkg --print-architecture)}" \
    && if [ "$ARCH" = "arm64" ]; then \
        pip install --no-deps "paddlepaddle @ ${PADDLE_ARM64_WHEEL}#sha256=${PADDLE_ARM64_SHA256}"; \
       fi \
    && pip install -r requirements-ai.txt
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
