import Link from "next/link";
import { Check } from "lucide-react";
import { Marked } from "@/components/marketing/playful";
import { Faq, FinalCta, PageHero, ProPriceCard, SectionHead, type FaqItem } from "@/components/marketing/sections";
import { marketingMetadata } from "@/lib/marketing-metadata";
import { siteConfig } from "@/lib/site-config";

const { symbol, proMonthly, trialDays } = siteConfig.pricing;

export const metadata = marketingMetadata({
  title: "Pricing",
  description: `${siteConfig.name} Pro is ${symbol}${proMonthly} a month with a ${trialDays}-day free trial. Review, approvals, AI Visual QA, client portal, files and tasks included.`,
  path: "/pricing",
});

/*
 * PLACEHOLDER: the Free card mirrors the FREE plan limits that ship as defaults in the
 * backend (PLAN_LIMITS in blazeflow/settings.py). It is labelled as a draft on the page until
 * the owner confirms whether a free plan is offered publicly, and on what terms.
 */
const FREE_DRAFT = ["1 workspace", "Up to 3 projects", "5 GB of storage", "Review links and client comments"];

const FAQ: FaqItem[] = [
  { q: "How does the free trial work?", a: `Sign up and you get ${trialDays} days of ${siteConfig.name} Pro to run a real project end to end. After the trial, Pro is ${symbol}${proMonthly} a month.` },
  { q: "What currency do you bill in?", a: "Prices are in pounds sterling (GBP)." },
  { q: "Do my clients pay anything?", a: "No. Clients review through links or your client portal at no cost to them." },
  { q: "Can I cancel?", a: <>Yes, you can stop your subscription. The details are in our <Link href="/terms">terms</Link>.</> },
  { q: "We’re a bigger team. Can we talk?", a: <>Of course. <Link href="/contact">Contact us</Link> and tell us about your studio.</> },
];

export default function PricingPage() {
  return (
    <>
      <PageHero
        eyebrow="Pricing"
        tone="tomato"
        title={<>Simple pricing for <Marked kind="circle">busy</Marked> studios.</>}
        lede={`One plan with every feature. Try it free for ${trialDays} days, then ${symbol}${proMonthly} a month.`}
      />

      <section className="mk-section mk-section-tight" aria-label="Plans">
        <div className="mk-wrap">
          <div className="mk-prices">
            <ProPriceCard headingLevel="h2" />
            <div className="mk-price is-placeholder" data-placeholder="true">
              <h2>Free <span className="mk-badge is-draft">Placeholder · to confirm</span></h2>
              <div className="mk-price-amount"><b>{symbol}0</b><span>per month</span></div>
              <p className="mk-muted">Draft plan shown for review. Limits mirror the app’s current defaults and are not yet a public offer.</p>
              <Link className="mk-btn is-ghost" href={siteConfig.links.signUp}>Create an account</Link>
              <ul className="mk-checks">
                {FREE_DRAFT.map((item) => <li key={item}><Check aria-hidden="true" />{item}</li>)}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="mk-section" aria-labelledby="mk-pricing-faq">
        <div className="mk-wrap">
          <SectionHead center eyebrow="FAQ" title={<span id="mk-pricing-faq">Pricing questions</span>} />
          <Faq items={FAQ} />
        </div>
      </section>

      <FinalCta />
    </>
  );
}
