/** Workspace invitations: validation and the shareable link. */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function inviteFieldErrors(email: string, roleId: string): Record<string, string> | null {
  const errors: Record<string, string> = {};
  if (!email.trim()) errors.email = "Enter the person's email address.";
  else if (!EMAIL.test(email.trim())) errors.email = "That doesn't look like an email address.";
  if (!roleId) errors.role_id = "Choose a role.";
  return Object.keys(errors).length ? errors : null;
}

/** The link the invite email carries, for copying when email isn't an option. */
export const inviteLink = (token: string, origin: string) => `${origin.replace(/\/$/, "")}/invite?token=${encodeURIComponent(token)}`;

export function expiryLabel(expiresAt: string, now = new Date()): string {
  const days = Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 86_400_000);
  if (days <= 0) return "Expired";
  return days === 1 ? "Expires tomorrow" : `Expires in ${days} days`;
}
