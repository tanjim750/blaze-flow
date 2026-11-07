/**
 * Short guest share links: `<SHORT_LINK_BASE_URL>/<code>`, eight base62 characters, like
 * Frame.io's f.io/Z70ayQFE. The API builds the URL; the frontend only has to recognise a
 * code and, when SHORT_LINK_BASE_URL is a dedicated short domain (no path), resolve that
 * domain's bare `/<code>` (see `proxy.ts`).
 */
export const SHORT_CODE_PATTERN = /^[A-Za-z0-9]{8}$/;
export const DEFAULT_SHORT_LINK_BASE_URL = "https://krewsys.com/r";

export const isShortCode = (value: string): boolean => SHORT_CODE_PATTERN.test(value);

/**
 * The host whose bare `/<code>` paths are short links, or null when the base URL keeps a
 * path (the default `https://krewsys.com/r` is served by the `/r/[code]` route instead).
 */
export function shortLinkHost(base: string | undefined = process.env.SHORT_LINK_BASE_URL): string | null {
  try {
    const url = new URL((base || DEFAULT_SHORT_LINK_BASE_URL).trim());
    return url.pathname.replace(/\/+$/, "") === "" ? url.host.toLowerCase() : null;
  } catch {
    return null;
  }
}
