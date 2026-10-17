# Deploying Blaze Flow to a single server

This is the production path: one Linux VM running `docker-compose.prod.yml`, Cloudflare in
front, Cloudflare R2 for files. The dev stack (`docker-compose.yml`, runserver, pgAdmin,
source mounts) is for local work only and must never be exposed.

## What runs

| Service | Image | Purpose |
|---|---|---|
| `db` | postgres:16-alpine | Database, `postgres_data` volume, not published to the host |
| `migrate` | backend (`web` target) | One-shot `manage.py migrate` (profile `release`; run per deploy) |
| `web` | backend | gunicorn on :8000 (internal), whitenoise serves `/static/` |
| `outbox-worker` | backend | `run_outbox_worker`: emails, notifications, previews, FFmpeg proxies |
| `ai-qa-worker` | backend (`ai` target, + PaddleOCR) | `run_ai_qa_worker` (AI Visual QA) |
| `scheduler` | backend | supercronic running `deploy/crontab` (maintenance commands) |
| `frontend` | frontend (Next.js standalone) | Public UI on :3000, proxies `/api/*` to `web` |
| `caddy` | caddy:2 (profile `caddy`) | Optional TLS reverse proxy on :80/:443 |
| `clamav` | clamav (profile `malware`; `CLAMAV_IMAGE` on ARM) | Optional virus scanning |

Migrations never run on container start; restarting any service is safe.

Health endpoints (on Django, also reachable through the frontend at the same paths):

- `GET /api/health/live/` — liveness, no DB and no writes. Point uptime monitors here.
- `GET /api/health/ready/` — runs `SELECT 1`; returns 503 if the DB is unreachable.
- `GET /api/health/` — legacy, now side-effect free.

## 1. Server

1. Create a VM (e.g. Hetzner CX43: 8 vCPU / 16 GB; CX33 works without ClamAV), Debian 12 or
   Ubuntu 24.04, SSH key only.
2. Firewall: allow 22 from your IP. If you use Caddy, allow 80/443 **only from Cloudflare's
   IP ranges** (https://www.cloudflare.com/ips/). With a Cloudflare Tunnel, open nothing else.
3. Install Docker Engine + compose plugin (https://docs.docker.com/engine/install/), then:
   ```sh
   sudo adduser --disabled-password deploy && sudo usermod -aG docker deploy
   ```
4. Enable unattended security upgrades (`apt install unattended-upgrades`).

### ARM64 hosts (e.g. Oracle Cloud Ampere A1)

The stack builds and runs natively on `linux/arm64` as well as `linux/amd64`; `dc build` on
the server picks the right architecture automatically, nothing to configure for the backend
or frontend. What differs:

- `scheduler`: the Dockerfile downloads the arm64 supercronic binary (checksum-pinned).
- `ai-qa-worker`: PyPI has no Linux arm64 `paddlepaddle` wheel, so the `ai` target installs
  the same version from Paddle's official CPU index (SHA256-pinned). OCR runs on CPU; its
  speed on ARM has not been benchmarked, so size `AI_QA_CPU_LIMIT`/`AI_QA_MEMORY_LIMIT`
  to the VM (A1 Free Tier: up to 4 OCPU / 24 GB) and watch the first jobs.
- `clamav` (profile `malware`): the default `clamav/clamav` image is amd64-only. Set
  `CLAMAV_IMAGE=clamav/clamav-debian:stable` in `.env.production`.
- Building images elsewhere for an ARM server: `docker buildx build --platform linux/arm64`
  (slow under QEMU emulation; building on the server itself is simpler).

CI builds the `web`, `ai` and frontend images on a native arm64 runner and smoke-tests them.

## 2. Code and configuration

```sh
sudo -iu deploy
git clone https://github.com/tanjim750/blaze-flow.git && cd blaze-flow
git checkout <release branch or tag>
cp .env.production.example .env.production
chmod 600 .env.production
```

Edit `.env.production`. Every variable is documented in the file. At minimum set:

- `DJANGO_SECRET_KEY` — `python3 -c "import secrets; print(secrets.token_urlsafe(64))"`
- `POSTGRES_PASSWORD` — `openssl rand -base64 36`
- `DJANGO_ALLOWED_HOSTS` — your public host **plus `web`** (internal calls use `http://web:8000`)
- `DJANGO_CSRF_TRUSTED_ORIGINS`, `APP_BASE_URL`, `PASSWORD_RESET_URL`, `EMAIL_VERIFICATION_URL`
- R2: `STORAGE_DRIVER=s3`, `AWS_*` (bucket-scoped token)
- Email: `RESEND_API_KEY`, `DEFAULT_FROM_EMAIL` (see [Email with Resend](#email-with-resend))
- `SIGNUP_MODE=invite_only` (see [Sign-up mode](#sign-up-mode))
- `APP_DOMAIN` if using Caddy
- `THROTTLE_TRUSTED_PROXY_COUNT` / `THROTTLE_TRUST_CF_CONNECTING_IP` (see §6)

Store a copy of `.env.production` in a password manager. Never commit it (`.env*` is
ignored except the `*.example` templates).

All compose commands below use this alias:

```sh
alias dc='docker compose -f docker-compose.prod.yml --env-file .env.production'
```

### Email with Resend

Blaze Flow sends verification, password-reset, invitation and mention emails as branded
HTML + plain text. Configuration is environment-only:

| Set | Result |
| --- | --- |
| `RESEND_API_KEY` (`EMAIL_TRANSPORT=api`, the default) | Resend HTTPS API: `POST https://api.resend.com/emails` on port 443 (`blazeflow.email_backends.resend`) |
| `RESEND_API_KEY` + `EMAIL_TRANSPORT=smtp` | Resend SMTP relay: `smtp.resend.com:465`, SSL, user `resend`, password = the key |
| `EMAIL_HOST` (+ `EMAIL_PORT/USER/PASSWORD/USE_TLS`) | Any other SMTP provider |
| neither | Console backend — emails are printed to the `web` / `outbox` logs, nothing is sent |
| `EMAIL_BACKEND` | Always wins (escape hatch) |

**Use the API transport in production.** Hetzner (and many other hosts) block outbound SMTP
ports 25/465/587 on new servers, so `smtp.resend.com` simply times out. The API backend only
needs outbound HTTPS, supports HTML + text, cc/bcc, reply-to, custom headers and attachments,
honours `EMAIL_TIMEOUT`, and reports Resend's error message (never the key) on failure.

1. **Create the key.** Resend → API Keys → *Create API key*, name it `blazeflow-production`,
   permission **Sending access**, domain = your sending domain. Put it in `.env.production`
   as `RESEND_API_KEY=` (never in git).
2. **Verify the domain.** Resend → Domains → *Add domain*. Use a subdomain such as
   `mail.example.com` so marketing tools on the apex never clash. Resend shows the exact
   records; on Cloudflare (DNS → Records) add them with **Proxy status: DNS only**:

   | Type | Name (on `mail.example.com`) | Content | Purpose |
   | --- | --- | --- | --- |
   | MX | `send.mail` | `feedback-smtp.<region>.amazonses.com` (priority 10) | bounce/return path |
   | TXT | `send.mail` | `v=spf1 include:amazonses.com ~all` | **SPF** |
   | TXT | `resend._domainkey.mail` | `p=MIGfMA0G…` (long key from Resend) | **DKIM** |
   | TXT | `_dmarc` (recommended) | `v=DMARC1; p=none; rua=mailto:dmarc@example.com` | DMARC |

   Copy values from the Resend dashboard verbatim (the region and DKIM key are per-account).
   Resend's *Auto configure* button can write them to Cloudflare for you. Click *Verify*;
   it usually turns green within minutes.
3. **Sender.** Set `DEFAULT_FROM_EMAIL="Blaze Flow <no-reply@mail.example.com>"` — the
   address must be on the verified domain.
   *Sandbox caveat:* before a domain is verified you can only send from
   `onboarding@resend.dev`, and Resend then delivers **only to the email address of the
   Resend account owner**. Everyone else's verification/invite emails will be rejected, so
   verify the domain before inviting real users.
4. **Test.** After `dc up -d`:

   ```sh
   dc exec web python manage.py send_test_email you@example.com
   ```

   It prints the backend and sender used, and fails loudly with the provider's error
   (bad key, unverified domain, …). The platform admin overview shows *Email: sending via Resend API*
   (or *SMTP* / *Resend SMTP*) when mail really leaves the server and *Email: console (not
   sent)* otherwise.

How emails are sent: mention notifications go through the outbox worker (retries and dead
letters). Verification, password-reset and invitation emails are sent inline by the request
because they carry one-time tokens that are only ever stored hashed; on failure the token is
invalidated and the user can resend (the UI enforces a 60-second cooldown, the API throttles).

### Sign-up mode

`SIGNUP_MODE=open` (default, used in development) lets anyone register.
`SIGNUP_MODE=invite_only` (recommended for production) only lets someone create an account
when they hold a valid invitation: the link from a workspace invite or client-team invite, or
a pending workspace invite addressed to the email they sign up with (email or Google).
Existing users always sign in normally. Everyone else sees a friendly "sign-up is by
invitation" page. Platform admins see the current mode on `/platform`.

## 3. Build, migrate, start

```sh
dc build                         # backend, backend-ai (PaddleOCR, large), frontend
dc up -d db
dc run --rm migrate              # release step: run on every deploy, before `up`
dc up -d                         # add --profile caddy and/or --profile malware as needed
dc exec web python manage.py createsuperuser        # first deploy only
dc exec web python manage.py grant_platform_admin you@example.com
curl -fsS http://127.0.0.1:3000/api/health/live/
```

`NEXT_PUBLIC_GOOGLE_CLIENT_ID` and the API rewrite target are baked into the frontend at
build time: rebuild `frontend` after changing them.

Not using AI Visual QA yet? Skip the large Paddle image: set `AI_VISUAL_QA_ENABLED=false`
and start everything except the worker:
`dc up -d db web outbox-worker scheduler frontend`.

## 4. Put it on the internet

**Option A: Cloudflare Tunnel (no open ports, recommended).** Install `cloudflared` on the
host, `cloudflared tunnel login`, create a tunnel, and route `app.<domain>` to
`http://127.0.0.1:3000`. Set `THROTTLE_TRUSTED_PROXY_COUNT=1` and
`THROTTLE_TRUST_CF_CONNECTING_IP=true`.

**Option B: Caddy.** Set `APP_DOMAIN=app.<domain>`, point an orange-clouded A record at the
server, Cloudflare SSL mode **Full (strict)**, and run `dc --profile caddy up -d`. Firewall
80/443 to Cloudflare IPs only, then set `THROTTLE_TRUSTED_PROXY_COUNT=2` and
`THROTTLE_TRUST_CF_CONNECTING_IP=true`.

Either way, leave `DJANGO_SECURE_SSL_REDIRECT=false` (HTTPS is enforced at Cloudflare/Caddy;
Django only sees the internal hop from Next) and keep `DJANGO_TRUST_PROXY_HTTPS=true`.

Cloudflare's proxy rejects request bodies over 100 MB on Free/Pro. Enable direct-to-R2
uploads (`DIRECT_UPLOADS_ENABLED=true` + bucket CORS) or lower the `MAX_*_BYTES` limits.

Django admin (`/admin/`) is not routed by the frontend, so it is not public. To use it,
temporarily publish `web` on localhost only (add `ports: ["127.0.0.1:8000:8000"]` in an
override file) and open it through an SSH tunnel: `ssh -L 8000:127.0.0.1:8000 deploy@server`.

## 5. Scheduled maintenance

The `scheduler` service runs `deploy/crontab` with supercronic (UTC):

| When | Command |
|---|---|
| every 30 min | `expire_direct_uploads` |
| 02:15 daily | `process_expired_subscriptions` |
| 02:30 daily | `purge_auth_tokens` |
| 02:45 daily | `purge_review_files` |

Manual only: `requeue_dead_letters` (after fixing a delivery problem) and
`check_operational_alerts --workspace-id <id>`. Logs: `dc logs -f scheduler`.

## 6. Client IPs and rate limiting

Throttles key anonymous requests on the client IP. DRF takes it from `X-Forwarded-For`,
counting back `THROTTLE_TRUSTED_PROXY_COUNT` proxies (Next is always one).
`THROTTLE_TRUST_CF_CONNECTING_IP=true` uses Cloudflare's `CF-Connecting-IP` header instead.
Only enable it when the origin cannot be reached except through Cloudflare, otherwise anyone
can forge the header and dodge the limits.

## 7. Deploying an update

```sh
git pull
dc build
dc run --rm migrate
dc up -d
dc ps            # web should become "healthy"
```

## 8. Backups

```sh
dc exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > blazeflow-$(date +%F).dump
```

Run it nightly from the host crontab and copy it off the box (Storage Box or a separate R2
bucket). Test a restore before beta:
`dc exec -T db pg_restore -U blazeflow -d blazeflow --clean < file.dump`.

## 9. Logs and troubleshooting

All services log to stdout (`DJANGO_LOG_LEVEL`, gunicorn access log), rotated by Docker
(10 MB × 5). `dc logs -f web outbox-worker ai-qa-worker`. A `DisallowedHost` error means
`web` or your domain is missing from `DJANGO_ALLOWED_HOSTS`; a 403 CSRF failure means the
origin is missing from `DJANGO_CSRF_TRUSTED_ORIGINS`.
