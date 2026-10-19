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
  { q: "Do my clients need an account to review?", a: `No. You send them a link. They can watch, comment on the frame, and approve or ask for changes in the browser. If a client wants one place for all their projects with you, invite them to your client portal.` },
  { q: "What does AI Visual QA check?", a: `It reads the text in posters, stills and video frames and flags likely spelling mistakes. If you give it the approved copy, it also flags words, prices and dates that differ from that copy, and lines that are missing. Each finding is boxed on the image or frame, with a time range on video. It only suggests. Nothing changes until someone accepts a finding or turns it into a comment.` },
  { q: "How big can uploads be?", a: `Up to 1 GB per file. Uploads run in a tray in the background, so you can keep working while a master goes up.` },
  { q: "How much does it cost?", a: `${name} Pro is ${symbol}${proMonthly} a month, billed in GBP. The first ${trialDays} days are free.` },
  { q: "Can I keep internal notes away from the client?", a: `Yes. Each comment is either visible to the client or team-only. You can also preview the review page as the client will see it before you send the link.` },
  { q: "Where is my data stored?", a: <>Our <Link href="/privacy">privacy notice</Link> explains how we handle personal data. For anything it doesn&rsquo;t cover, <Link href="/contact">contact us</Link>.</> },
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
