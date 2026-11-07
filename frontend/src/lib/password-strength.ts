/**
 * A light, dependency-free password strength hint. It is guidance only: Django's
 * validators (length, commonness, similarity to your name, all-numeric) are the real gate.
 */
export type Strength = { score: 0 | 1 | 2 | 3 | 4; label: string; hint: string };

const COMMON = ["password", "123456", "qwerty", "letmein", "welcome", "admin", "blazeflow", "krewsys", "iloveyou", "abc123"];

export function passwordStrength(password: string, context: string[] = []): Strength {
  if (!password) return { score: 0, label: "", hint: "Use at least 8 characters." };
  const lower = password.toLowerCase();
  if (password.length < 8) return { score: 1, label: "Too short", hint: `${8 - password.length} more character${8 - password.length === 1 ? "" : "s"} needed.` };
  if (/^\d+$/.test(password)) return { score: 1, label: "Weak", hint: "Numbers alone are easy to guess." };
  if (COMMON.some((word) => lower.includes(word))) return { score: 1, label: "Weak", hint: "Avoid common words and patterns." };
  if (context.some((part) => part && part.length >= 3 && lower.includes(part.toLowerCase()))) {
    return { score: 1, label: "Weak", hint: "Avoid using your name or email." };
  }
  let variety = 0;
  if (/[a-z]/.test(password)) variety++;
  if (/[A-Z]/.test(password)) variety++;
  if (/\d/.test(password)) variety++;
  if (/[^A-Za-z0-9]/.test(password)) variety++;
  const lengthPoints = password.length >= 16 ? 2 : password.length >= 12 ? 1 : 0;
  const raw = Math.min(4, Math.max(2, 1 + lengthPoints + (variety >= 3 ? 1 : 0) + (variety === 4 ? 1 : 0)));
  const score = raw as 2 | 3 | 4;
  if (score === 2) return { score, label: "Fair", hint: "Longer is stronger — try a short phrase." };
  if (score === 3) return { score, label: "Good", hint: "Nice. A few more characters makes it great." };
  return { score, label: "Strong", hint: "Great password." };
}
