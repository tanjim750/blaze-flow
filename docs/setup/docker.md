# Docker Setup

Build and start Django with Postgres:

```bash
docker compose up --build
```

Start existing containers without rebuilding:

```bash
docker compose up
```

Run containers in the background:

```bash
docker compose up -d
```

## Optional ClamAV

Start the malware profile and select the production scanner adapter:

```bash
docker compose --profile malware up -d clamav
```

Set this in `.env`, then restart `web` and `worker`:

```env
FILE_SECURITY_SCANNER=app.services.file_processing.ClamAVTcpScanner
CLAMAV_HOST=clamav
CLAMAV_PORT=3310
```

Wait for ClamAV signatures and health logs before accepting uploads.

## S3-compatible private storage

Set `STORAGE_DRIVER=s3`, `AWS_STORAGE_BUCKET_NAME`, and the relevant region/endpoint credentials in `.env`. Rebuild after dependency changes:

```bash
docker compose build web worker
docker compose up -d web worker
```

Never commit access keys. Prefer workload/IAM credentials in production.

Stop containers:

```bash
docker compose down
```

## Bash Access

Open a shell in the running Django container:

```bash
docker compose exec web bash
```

If `bash` is unavailable, use `sh`:

```bash
docker compose exec web sh
```

Open a one-off Django container shell:

```bash
docker compose run --rm web bash
```

## Django Commands

Run migrations:

```bash
docker compose run --rm web python manage.py migrate
```

Create migrations:

```bash
docker compose run --rm web python manage.py makemigrations
```

Create a superuser:

```bash
docker compose run --rm web python manage.py createsuperuser
```
