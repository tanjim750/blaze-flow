import Link from "next/link";
import { ProClosing, ProFaq, ProPlans, type FaqItem } from "@/components/pro/pro-home";
import { ProPageHero } from "@/components/pro/pro-pages";
import { marketingMetadata } from "@/lib/marketing-metadata";
import { siteConfig } from "@/lib/site-config";

const { trialDays, currency } = siteConfig.pricing;

export const metadata = marketingMetadata({
  title: "Pricing",
  description: `${siteConfig.name} has three plans, each with a ${trialDays}-day free trial. Prices in ${currency}.`,
  path: "/pricing",
});

const FAQ: FaqItem[] = [
  { q: "How does the free trial work?", a: `Every plan starts with ${trialDays} days free, so you can run a real client job end to end.` },
  { q: "What currency do you bill in?", a: `US dollars (${currency}), per month.` },
  { q: "Do my clients pay anything?", a: "No. Clients review through links or your portal for free." },
  { q: "Can I cancel?", a: <>Yes. The details are in the <Link href="/terms">terms</Link>.</> },
  { q: "We’re a bigger team. Can we talk?", a: <>Yes. <Link href="/contact">Contact us</Link>.</> },
];

export default function PricingPage() {
  return (
    <>
      <ProPageHero label="Pricing" title="Three plans" line={`Every plan starts with a ${trialDays}-day free trial. Prices in ${currency}.`} />
      <section className="pro-plans-section" aria-label="Plans">
        <div className="pro-wrap">
          <ProPlans headingLevel="h2" />
          <p className="pro-fine is-center">Plans and prices are still to be confirmed.</p>
        </div>
      </section>
      <ProFaq items={FAQ} />
      <ProClosing />
    </>
  );
}
