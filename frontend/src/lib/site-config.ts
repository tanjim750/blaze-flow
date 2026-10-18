/**
 * The one place the product's public identity lives.
 *
 * Every marketing page, page title, Open Graph card, sitemap and robots entry reads from
 * here, so renaming the product (or moving domains) is a one-file change. Keep copy that
 * names the product as `${siteConfig.name}` rather than typing the name out.
 *
 * `url` can be overridden per deployment with NEXT_PUBLIC_SITE_URL (no trailing slash).
 */
const DOMAIN = "blazeflow.app"; // PLACEHOLDER: confirm the production domain.

export const siteConfig = {
  name: "Blaze Flow",
  tagline: "Review, approve and deliver video work without the email chains.",
  description:
    "The review and delivery workspace for video and creative agencies: frame-accurate feedback, client approvals, AI proofreading of on-screen text, files, tasks and a branded client portal.",
  domain: DOMAIN,
  url: (process.env.NEXT_PUBLIC_SITE_URL || `https://${DOMAIN}`).replace(/\/$/, ""),
  contactEmail: "msshamim2821@gmail.com",
  /** Company/legal entity shown in the legal pages. PLACEHOLDER until the owner confirms. */
  legalEntity: "Blaze Flow (company details to be confirmed)",
  /** Where the business is based, for the legal pages. */
  jurisdiction: "England and Wales",
  links: {
    signUp: "/sign-up",
    signIn: "/sign-in",
  },
  pricing: {
    currency: "GBP",
    symbol: "£",
    proMonthly: 29,
    trialDays: 14,
  },
} as const;

export type SiteConfig = typeof siteConfig;

/** `Page title · Blaze Flow`, the format every public page uses. */
export function pageTitle(title?: string): string {
  return title ? `${title} · ${siteConfig.name}` : `${siteConfig.name} — ${siteConfig.tagline}`;
}

/** Public, indexable marketing routes. The sitemap is built from this list. */
export const publicRoutes = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/features", priority: 0.9, changeFrequency: "monthly" },
  { path: "/pricing", priority: 0.9, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.6, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/cookies", priority: 0.3, changeFrequency: "yearly" },
] as const;
