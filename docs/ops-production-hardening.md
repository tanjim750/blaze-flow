# Production hardening: HTTPS, client IP, backups, health checks

Production request path: **browser → Cloudflare → Caddy → Next.js (`frontend`) → Django (`web`)**.
Next serves pages and proxies `/api/*` to Django at `http://web:8000`.

## HTTPS redirect without loops

- **Cloudflare:** SSL/TLS mode **Full (strict)**, plus **Always Use HTTPS**. Never use *Flexible*:
  Cloudflare would then reach Caddy over HTTP, Caddy redirects to HTTPS, and the browser loops
  (`ERR_TOO_MANY_REDIRECTS`).
- **Caddy:** redirects `:80 → :443` automatically and sets `X-Forwarded-Proto: https`.
- **Django:** keep `DJANGO_SECURE_SSL_REDIRECT=false`. Django also receives plain-HTTP calls on
  the internal network (the container healthcheck, and Next server components calling
  `http://web:8000`), and those would be redirected to `https://web:8000` and break.
  `DJANGO_TRUST_PROXY_HTTPS=true` is what makes Django treat the public request as HTTPS, for
  secure cookies, HSTS and CSRF. Next's proxy passes `X-Forwarded-Proto` through unchanged.
  The live `/api/health/` already returns `strict-transport-security: max-age=3600`, which
  shows this works.

## HSTS ramp (3600 → 31536000)

Move one step at a time, each after a week with no HTTPS issues:

| Step | `DJANGO_SECURE_HSTS_SECONDS` / frontend `HSTS_MAX_AGE` |
| --- | --- |
| now | 3600 (1 hour) |
| +1 week | 86400 (1 day) |
| +2 weeks | 604800 (1 week) |
| +3 weeks | 2592000 (30 days) |
| +4 weeks | 31536000 (1 year) |

Browsers remember the value for `max-age` seconds. Lowering it later only helps new
visitors, so don't skip steps. Turn on `DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS` only once
**every** subdomain is HTTPS. Use `..._PRELOAD` only after that, and treat it as permanent.
Keep a single source of truth: if Cloudflare's HSTS feature is on, it overrides the origin
header, so either turn it off or set it to the same value. Keep Django's and the frontend's
values equal (the frontend reads `HSTS_MAX_AGE`, see the security-headers PR).

## Client IP for rate limiting

DRF reads the client IP as the Nth entry **from the right** of `X-Forwarded-For`, where N is
`THROTTLE_TRUSTED_PROXY_COUNT`.

| Hop | What it does to `X-Forwarded-For` |
| --- | --- |
| Cloudflare | appends the browser IP (keeps any client-sent value to its left) |
| Caddy | appends the Cloudflare edge IP, **only keeping the incoming header if the sender is a trusted proxy**. Otherwise it replaces the header. |
| Next `/api` rewrite | adds nothing (it sets the header only when it is missing; checked in Next 16 `base-server.js` / `proxy-request.js`) |
| Django | `REMOTE_ADDR` is the Next container |

- **Before this PR**, the Caddyfile trusted no proxies. Django saw `X-Forwarded-For: <cf-edge>`,
  and any count picked the Cloudflare edge IP. Every visitor arriving through the same
  Cloudflare data centre shared one anonymous rate-limit bucket, so one abuser could lock out
  everyone in that region from login, sign-up and password reset.
- **With this PR**, `deploy/Caddyfile` trusts Cloudflare's published ranges. Django sees
  `<client-sent junk>, <browser>, <cf-edge>`, and `THROTTLE_TRUSTED_PROXY_COUNT=2` picks the
  browser IP. Client-sent values sit further left and are ignored.
- **Other setups:** Caddy without Cloudflare = 1. Cloudflare Tunnel straight to Next = 1, or
  better, the next option.
- **`THROTTLE_TRUST_CF_CONNECTING_IP=true`** keys on Cloudflare's `CF-Connecting-IP` instead,
  and wins over the count. It is the simplest correct option, but **only** when the origin
  accepts traffic exclusively from Cloudflare (Tunnel, or a firewall allowing 80/443 only from
  Cloudflare ranges). Otherwise anyone hitting the origin IP can fake the header.
- **Keep the ranges current:** they are listed in `deploy/Caddyfile` (checked 2026-11-02).
  Compare with https://www.cloudflare.com/ips/ yearly.

### Verify client IP

After deploying, from a phone on mobile data, fail the login 21 times (`LOGIN_THROTTLE_RATE`
is 20/hour) until you get HTTP 429. Then try a login from your laptop on another network: it
must **not** get 429. If it does, the throttle is still keyed on a shared proxy IP.

## Health checks

| Endpoint | Purpose |
| --- | --- |
| `/api/health/live/` | process is up; no DB, no session. Use for uptime monitors. |
| `/api/health/ready/` | `SELECT 1`; 503 if the DB is unreachable. Use for deploy gates. |
| `/api/health/` | legacy DRF view returning `{"message":"ok"}` |

**2026-11-02 investigation of the reported 500 on `https://krewsys.com/api/health/`:** one
passive GET at 16:12 UTC returned **HTTP 200 `{"message":"ok"}`** through Cloudflare. HSTS
(3600), nosniff and X-Frame-Options were present, so the request reached Django over the
trusted HTTPS path. The 500 does not reproduce now, and nothing in the repo makes this view
fail on its own. The likely past causes, from the code:

1. **The legacy view ran DRF's default `SessionAuthentication`.** A request carrying a
   `sessionid` cookie (a signed-in browser, or a monitor reusing cookies) loads the session
   from Postgres. During a DB restart or recreation (see the `db` comment in
   `docker-compose.prod.yml` about `up -d` recreating Postgres) that raises, and the view
   returns 500, whereas cookie-less probes get 200. The API-defaults PR (#138) removes
   authentication from `health_check`, so it never touches the DB.
2. **`DisallowedHost`** if the domain or `web` was missing from `DJANGO_ALLOWED_HOSTS`. That
   is a 400 normally, but it shows as a 500 page when a proxy rewrites errors. Check
   `dc logs web | grep -i disallowed`.
3. **Django down or restarting** while Next is up. Next returns 500 for a failed rewrite
   proxy (Cloudflare would show 502/504 only if Caddy or Next were down too).

Next time it happens, run
`dc logs --since 30m web frontend | grep -iE 'health|error|Traceback'` straight away. The
`x-request-id` response header matches the Django log line.

## Owner checklist (manual, on the server / dashboards)

Nothing below is applied by merging. Each item is a change the owner makes.

**Cloudflare dashboard**
- [ ] SSL/TLS → Overview: **Full (strict)** (not Flexible).
- [ ] SSL/TLS → Edge Certificates: **Always Use HTTPS** on. **HSTS**: either off (the origin
      sends it) or the same value as `DJANGO_SECURE_HSTS_SECONDS`.
- [ ] Optional: Authenticated Origin Pulls, or a firewall allowing 80/443 only from Cloudflare
      ranges (required before `THROTTLE_TRUST_CF_CONNECTING_IP=true`).

**Server: `.env.production`** (then `dc up -d web frontend`)
- [ ] `DJANGO_SECURE_SSL_REDIRECT=false`, `DJANGO_TRUST_PROXY_HTTPS=true`, secure cookies `true`.
- [ ] HSTS ramp: set `DJANGO_SECURE_HSTS_SECONDS` (and frontend `HSTS_MAX_AGE`) to `86400`
      now, and step up weekly per the table above. Put a reminder in the calendar.
- [ ] `THROTTLE_TRUSTED_PROXY_COUNT=2` (Cloudflare → Caddy → Next). Use `1` if the live
      chain is a Cloudflare Tunnel (no Caddy).
- [ ] Or, if the origin is Cloudflare-only: `THROTTLE_TRUST_CF_CONNECTING_IP=true`.
- [ ] `DJANGO_ALLOWED_HOSTS` includes `krewsys.com` (plus `www.` if served) **and** `web`.

**Server: Caddy**
- [ ] After pulling: `dc --profile caddy up -d caddy` so the new `trusted_proxies` takes
      effect, then run the client-IP verification above.

**Backups** (see [backup-restore.md](backup-restore.md))
- [ ] Generate the age key pair off-server; store the private key in the password manager
      plus an offline copy.
- [ ] Create a separate offsite bucket and token; `rclone config` on the server.
- [ ] Fill `deploy/backup/backup.env`; run once by hand; add the cron line.
- [ ] Add a healthchecks.io (or similar) ping URL so a missed backup alerts you.
- [ ] Do a test restore into `restore_test` within a week, then quarterly.

**Monitoring**
- [ ] Point uptime monitors at `/api/health/live/` (and `/api/health/ready/` for DB), not at
      `/api/health/`.
