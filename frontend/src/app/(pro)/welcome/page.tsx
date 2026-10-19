import Link from "next/link";
import { ProBento, ProClosing, ProFaq, ProHero, ProMoneyScene, ProPortalScene, ProPricing, ProQaScene } from "@/components/pro/pro-home";
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
  { q: "Do my clients need an account?", a: `Not to review. A review link lets them watch, comment and approve in the browser. Invite them to the portal if they want all their projects in one place.` },
  { q: "What does AI Visual QA check?", a: `The text in posters, stills and video frames: spelling, and anything that differs from the approved copy, such as a changed price or a missing word. It only suggests. A person accepts each finding.` },
  { q: "How big can uploads be?", a: `Up to 1 GB per file.` },
  { q: "How much does it cost?", a: `${name} Pro is ${symbol}${proMonthly} a month, billed in GBP, after a ${trialDays}-day free trial.` },
  { q: "Where is my data stored?", a: <>See the <Link href="/privacy">privacy notice</Link>, or <Link href="/contact">contact us</Link>.</> },
];

export default function MarketingHome() {
  return (
    <>
      <ProHero />
      <ProQaScene />
      <ProPortalScene />
      <ProMoneyScene />
      <ProBento />
      <ProPricing />
      <ProFaq items={FAQ} />
      <ProClosing />
    </>
  );
}
