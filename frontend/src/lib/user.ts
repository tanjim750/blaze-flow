/**
 * Display helpers for a user, free of any server-only import.
 *
 * `lib/session` reaches for `next/headers` through `lib/api`, which cannot cross into a
 * client component. The app shell renders the signed-in user's name and initials, so these
 * live here instead — the same reason `lib/timecode` is its own module.
 */
export type NamedUser = { first_name: string; last_name: string; email: string };

/** What the app shell needs to render an account menu: strings, no API types. */
export type ShellUser = { name: string; email: string; initials: string };

export const displayName = (user: NamedUser) =>
  `${user.first_name} ${user.last_name}`.trim() || user.email;

/** "Ada Lovelace" → "AL"; falls back to the email's first letter. */
export function initialsFor(user: NamedUser): string {
  const initials = `${user.first_name.charAt(0)}${user.last_name.charAt(0)}`.trim();
  return (initials || user.email.charAt(0)).toUpperCase();
}

export const toShellUser = (user: NamedUser): ShellUser => ({
  name: displayName(user),
  email: user.email,
  initials: initialsFor(user),
});
