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
