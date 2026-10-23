import { NextResponse, type NextRequest } from "next/server";

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
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  return NextResponse.rewrite(new URL(MARKETING_HOME, request.url));
}

export const config = { matcher: "/" };
