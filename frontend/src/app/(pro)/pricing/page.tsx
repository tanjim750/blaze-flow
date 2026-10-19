import Link from "next/link";
import { Lock, ShieldCheck, UploadCloud, Users } from "lucide-react";
import { ProClosing, ProFaq, ProPlans, type FaqItem } from "@/components/pro/pro-home";
import { ProCardGrid, ProPageHero } from "@/components/pro/pro-pages";
import { ProCompare } from "@/components/pro/pro-pricing";
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

const TRUST = [
  { icon: <ShieldCheck />, title: "UK GDPR", line: <>How we handle data is in the <Link href="/privacy">privacy notice</Link>.</> },
  { icon: <Users />, title: "Roles", line: "Owners, editors, viewers and client reviewers each see only their part." },
  { icon: <Lock />, title: "Team-only notes", line: "Internal comments never reach the client." },
  { icon: <UploadCloud />, title: "Only needed cookies", line: <>No ad or tracking cookies. See the <Link href="/cookies">cookie policy</Link>.</> },
];

export default function PricingPage() {
  return (
    <>
      <ProPageHero label="Pricing" title="Pricing for studios" line={`Every plan starts with a ${trialDays}-day free trial. Prices in ${currency}.`} />
      <section className="pro-plans-section" aria-label="Plans">
        <div className="pro-wrap">
          <ProPlans headingLevel="h2" />
        </div>
      </section>
      <ProCompare />
      <section className="pro-trust" aria-labelledby="pro-trust-title">
        <div className="pro-wrap">
          <h2 id="pro-trust-title" className="pro-h2">Your clients’ work, handled carefully</h2>
          <ProCardGrid headingLevel="h3" items={TRUST} />
        </div>
      </section>
      <ProFaq items={FAQ} />
      <ProClosing />
    </>
  );
}
