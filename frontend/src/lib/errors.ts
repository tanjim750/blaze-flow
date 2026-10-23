/**
 * Turns a Django REST Framework error body into one human-readable sentence.
 *
 * Kept free of any server-only import so both the server API client and the browser-side
 * auth forms can use it, and so an error reads the same wherever it surfaced.
 *
 * DRF answers with several shapes depending on where validation failed:
 *
 * - `{"detail": "..."}` — permission, throttle, and service errors
 * - `{"password": ["too short", "too common"]}` — field validation
 * - `{"non_field_errors": ["Invalid email or password."]}` — serializer `validate()`
 * - `["..."]` or `"..."` — occasionally, from a raised list/string
 */
const FIELD_LABELS: Record<string, string> = {
  email: "Email",
  password: "Password",
  new_password: "New password",
  current_password: "Current password",
  first_name: "First name",
  last_name: "Last name",
  timezone: "Timezone",
  token: "Link",
  name: "Name",
};

/** `["a", "b"]` → `"a b"`; anything else → its trimmed string form. */
function flatten(value: unknown): string {
  if (Array.isArray(value)) return value.map(flatten).filter(Boolean).join(" ");
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return describeObject(value as Record<string, unknown>);
  return String(value).trim();
}

function describeObject(body: Record<string, unknown>): string {
  if (typeof body.detail === "string") return body.detail;

  // `non_field_errors` is the serializer's own message and needs no field prefix.
  const parts: string[] = [];
  const nonField = body.non_field_errors;
  if (nonField) parts.push(flatten(nonField));

  for (const [field, value] of Object.entries(body)) {
    if (field === "non_field_errors" || field === "detail") continue;
    const message = flatten(value);
    if (!message) continue;
    const label = FIELD_LABELS[field] ?? field.replace(/_/g, " ");
    parts.push(`${label}: ${message}`);
  }
  return parts.filter(Boolean).join(" ");
}

/**
 * Describes a failed response body, falling back to the status when the body says nothing
 * useful. `body` is the raw text, because an error response is not always JSON — a 500
 * from Django in debug mode is HTML, and a proxy timeout is plain text.
 */
export function describeErrorBody(status: number, body: string, statusText = ""): string {
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"')) {
    try {
      const message = flatten(JSON.parse(trimmed));
      if (message) return message;
    } catch {
      /* not JSON after all; fall through to the raw text */
    }
  }
  if (status === 429) return "Too many attempts. Wait a minute and try again.";
  // An HTML error page is never worth showing a user verbatim.
  if (trimmed.startsWith("<")) return statusText || `The API returned ${status}.`;
  return trimmed.slice(0, 300) || statusText || `The API returned ${status}.`;
}
