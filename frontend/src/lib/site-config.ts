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
  name: "Krewsys",
  tagline: "Review, approve and deliver video work without the email chains.",
  description:
    "The review and delivery workspace for video and creative agencies: frame-accurate feedback, client approvals, AI proofreading of on-screen text, files, tasks and a branded client portal.",
  domain: DOMAIN,
  url: (process.env.NEXT_PUBLIC_SITE_URL || `https://${DOMAIN}`).replace(/\/$/, ""),
  contactEmail: "msshamim2821@gmail.com",
  /** Company/legal entity shown in the legal pages. PLACEHOLDER until the owner confirms. */
  legalEntity: "Krewsys (company details to be confirmed)",
  /** Where the business is based, for the legal pages. */
  jurisdiction: "England and Wales",
  links: {
    signUp: "/sign-up",
    signIn: "/sign-in",
  },
  pricing: {
    currency: "USD",
    symbol: "$",
    /** The highlighted plan's monthly price; keep equal to the Pro entry in `plans`. */
    proMonthly: 39.99,
    trialDays: 14,
  },
  /**
   * The three subscription plans, in USD per month. The homepage pricing band, /pricing,
   * the terms and the OG card all read from here. `toConfirm` shows a small "To confirm"
   * note on the card until the owner signs the plans off.
   */
  plans: [
    { id: "starter", name: "Starter", monthly: 19.99, features: ["1 TB storage", "Up to 20 users", "Unlimited clients"], highlighted: false, toConfirm: true },
    { id: "pro", name: "Pro", monthly: 39.99, features: ["2 TB storage", "Up to 50 users", "Unlimited clients"], highlighted: true, toConfirm: true },
    { id: "scale", name: "Scale", monthly: 119.99, features: ["4 TB storage", "Unlimited users", "Unlimited clients and projects"], highlighted: false, toConfirm: true },
  ],
  /**
   * Solo: the one-person plan. Deliberately not in `plans` (no fourth big card): the Starter
   * card links to a small "Working alone?" details block on /pricing#solo instead. The app's
   * plan picker and upgrade prompts read the same entry. Keep `monthly` equal to the backend's
   * PLATFORM_SOLO_PRICE_MINOR (599).
   */
  solo: {
    id: "solo",
    name: "Solo",
    monthly: 5.99,
    storage: "200 GB storage",
    users: "Just you (1 user)",
    included: [
      "Projects, task board and due dates",
      "Clients, contacts and project history",
      "Client review links and approvals",
      "Simple invoicing and getting paid",
      "200 GB storage",
      "Unlimited clients",
    ],
    excluded: ["Team members and editor roles", "Editor payouts", "AI QA on posters and video", "More than 200 GB storage"],
  },
  /**
   * Monthly-only for now. Set a yearly price per plan here (and flip this on) to show the
   * monthly/yearly toggle on /pricing; without one the toggle stays hidden.
   */
  yearlyBilling: false,
  /**
   * The /pricing comparison table. Values are per plan, in `plans` order. `true` is a tick,
   * `false` is a dash, a string is shown as written, and "to confirm" is drawn as undecided.
   * Storage, team members and clients come from `plans` and are added by the page.
   */
  compare: [
    { group: "Review and AI", rows: [
      { label: "Frame-accurate review and drawings", values: [true, true, true] },
      { label: "Compare versions side by side", values: [true, true, true] },
      { label: "AI typo check on posters and video", values: ["to confirm", true, true] },
    ] },
    { group: "Clients and money", rows: [
      { label: "Client portal", values: [true, true, true] },
      { label: "Your logo on the portal", values: ["to confirm", true, true] },
      { label: "Invoices and editor pay", values: ["to confirm", true, true] },
    ] },
    { group: "Files and team", rows: [
      { label: "Uploads up to 1 GB per file", values: [true, true, true] },
      { label: "Tasks, roles and team-only notes", values: [true, true, true] },
      { label: "Support", values: ["Email", "Email", "to confirm"] },
    ] },
  ],
} as const;

export type Plan = (typeof siteConfig.plans)[number];

export type SiteConfig = typeof siteConfig;

/** `Page title · Krewsys`, the format every public page uses. */
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
