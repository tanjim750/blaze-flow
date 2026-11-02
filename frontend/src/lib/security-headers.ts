/**
 * Security response headers for every page and route, wired in `next.config.ts`.
 *
 * They live here (not in deploy/Caddyfile) so they ship with the app in every deployment,
 * including `next start` without Caddy, and so unit tests can check them.
 *
 * About the CSP:
 * - script-src uses 'unsafe-inline' because Next injects inline bootstrap/hydration scripts
 *   and layout.tsx has an inline theme script. A nonce would make every page dynamic, which
 *   we don't want yet. Plugin/object injection and framing are still blocked.
 * - Google Identity Services (sign in with Google) needs accounts.google.com for script,
 *   style, frame and connect.
 * - Direct browser uploads PUT to presigned R2 URLs (*.r2.cloudflarestorage.com), and
 *   downloads/previews 302 to them, so img/media/connect allow those URLs. Images and media
 *   also allow any https: source, so a custom R2 domain keeps working.
 * - Fonts come from next/font, which self-hosts them, so font-src 'self' data: is enough.
 * - Sentry runs server-side only (sentry-sdk in Django); the browser loads no Sentry
 *   script. Add its ingest origin with CSP_EXTRA_CONNECT_SRC if a browser SDK is added.
 * - Payments (Stripe, PayPal, ...) are full-page redirects to hosted checkouts, not
 *   embedded Stripe.js, so no frame or script origin is needed. If Stripe.js is embedded
 *   later, add js.stripe.com to script-src/frame-src.
 */
export type HeaderPair = { key: string; value: string };

export function buildCsp(opts: { dev?: boolean; extraConnect?: string[] } = {}): string {
  const extra = (opts.extraConnect ?? []).filter(Boolean);
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'", "https:"],
    "script-src": ["'self'", "'unsafe-inline'", "https://accounts.google.com", ...(opts.dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'", "https://accounts.google.com"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "media-src": ["'self'", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", "https://*.r2.cloudflarestorage.com", "https://accounts.google.com", ...(opts.dev ? ["ws:", "wss:"] : []), ...extra],
    "frame-src": ["'self'", "https://accounts.google.com"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!opts.dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

export function securityHeaders(env: Record<string, string | undefined> = process.env): HeaderPair[] {
  const dev = env.NODE_ENV !== "production";
  const extraConnect = (env.CSP_EXTRA_CONNECT_SRC ?? "").split(/[\s,]+/);
  const headers: HeaderPair[] = [
    { key: "Content-Security-Policy", value: buildCsp({ dev, extraConnect }) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ];
  // Browsers ignore HSTS on plain http, but don't send it from dev servers at all.
  // max-age comes from env so the rollout can ramp (see .env.production.example).
  if (!dev) {
    const maxAge = env.HSTS_MAX_AGE ?? "31536000";
    headers.push({ key: "Strict-Transport-Security", value: `max-age=${maxAge}; includeSubDomains` });
  }
  return headers;
}
