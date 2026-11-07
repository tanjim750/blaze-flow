import { NextResponse, type NextRequest } from "next/server";
import { isShortCode, shortLinkHost } from "@/lib/short-link";

/**
 * `/` serves two audiences.
 *
 * Signed-in people get their dashboard (`app/(app)/page.tsx`), exactly as before. Visitors
 * with no Django session cookie get the public marketing homepage instead, served from
 * `/welcome` by an internal rewrite so the address bar still reads `/`.
 *
 * Only the cookie's presence is checked; it is never trusted. A stale cookie still falls
 * through to the dashboard, whose layout asks the API and sends a signed-out visitor to
 * `/sign-in` just as it always has. No other route passes through here.
 */
export const SESSION_COOKIE = "sessionid";
export const MARKETING_HOME = "/welcome";

export function proxy(request: NextRequest) {
  // A dedicated short-link domain (SHORT_LINK_BASE_URL=https://xyz.io): its bare /<code> is
  // a guest review link, served by /r/<code> without changing the address bar. On any other
  // host these paths are ordinary routes (e.g. /projects) and pass straight through.
  const path = request.nextUrl.pathname;
  if (path !== "/") {
    const code = path.slice(1);
    const host = (request.headers.get("host") ?? "").toLowerCase();
    if (isShortCode(code) && host && host === shortLinkHost()) {
      return NextResponse.rewrite(new URL(`/r/${code}`, request.url));
    }
    return NextResponse.next();
  }
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  return NextResponse.rewrite(new URL(MARKETING_HOME, request.url));
}

// "/" for the homepage; "/<8 base62>" only matters on a short-link domain (see above).
export const config = { matcher: ["/", "/:code([A-Za-z0-9]{8})"] };
