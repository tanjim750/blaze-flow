import Link from "next/link";
import { ProClosing, ProFaq, ProFlow, ProHero, ProPricing, ProQa, ProSpecs, ProStatement, ProTour } from "@/components/pro/pro-home";
import type { FaqItem } from "@/components/marketing/sections";
import { marketingMetadata } from "@/lib/marketing-metadata";
import { siteConfig } from "@/lib/site-config";

/**
 * The public homepage. Signed-out visitors reach it at `/` through the rewrite in
 * `src/proxy.ts`; signed-in people keep getting their dashboard at `/`.
 */
export const metadata = marketingMetadata({ path: "/" });

const name = siteConfig.name;
const { symbol, proMonthly, trialDays } = siteConfig.pricing;

const FAQ: FaqItem[] = [
  { q: "Do my clients need an account to review?", a: `No. Send a review link and they can watch, comment on exact frames and approve or request changes from the browser. If you want them to have a home for every project, invite them to your branded client portal instead.` },
  { q: "What does AI Visual QA actually check?", a: `It reads the text in your posters, stills and video frames and flags likely typos. Paste or pick the client's approved copy and it also flags words, prices and dates that differ from it, or lines that are missing. Each finding is outlined on the image or frame (with a time range on video), and nothing changes until a person accepts it or turns it into a comment.` },
  { q: "How big can uploads be?", a: `Files up to 1 GB each. Uploads run in a background tray, so you can keep working while a master makes its way up.` },
  { q: "How much does it cost?", a: `${name} Pro is ${symbol}${proMonthly} a month, billed in GBP, with a ${trialDays}-day free trial so you can run a real project through it first.` },
  { q: "Can I keep internal notes away from the client?", a: `Yes. Every comment is either client-visible or team-only, and you can preview the review exactly as the client will see it before you share.` },
  { q: "Where is my data stored?", a: <>See our <Link href="/privacy">privacy notice</Link> for how we handle personal data, or <Link href="/contact">get in touch</Link> with specific questions.</> },
];

export default function MarketingHome() {
  return (
    <>
      <ProHero />
      <ProSpecs />
      <ProStatement />
      <ProTour />
      <ProQa />
      <ProFlow />
      <ProPricing />
      <ProFaq items={FAQ} />
      <ProClosing />
    </>
  );
}
