import { LifeBuoy, Mail, MessageSquareText } from "lucide-react";
import { ContactForm } from "@/components/marketing/contact-form";
import { Marked } from "@/components/marketing/playful";
import { PageHero } from "@/components/marketing/sections";
import { marketingMetadata } from "@/lib/marketing-metadata";
import { siteConfig } from "@/lib/site-config";

export const metadata = marketingMetadata({
  title: "Contact",
  description: `Questions about ${siteConfig.name}, pricing or a demo for your agency? Get in touch.`,
  path: "/contact",
});

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        tone="mint"
        title={<>Talk to a <Marked kind="wave">human.</Marked></>}
        lede={`Questions about ${siteConfig.name}, pricing, or moving your studio over? We read every message.`}
      />
      <section className="mk-section mk-section-tight" aria-label="Ways to reach us">
        <div className="mk-wrap mk-contact">
          <div className="mk-contact-cards">
            <div className="mk-card is-sun"><span className="mk-card-icon" aria-hidden="true"><Mail /></span><h2>Email</h2><p><a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a></p></div>
            <div className="mk-card is-sky"><span className="mk-card-icon" aria-hidden="true"><MessageSquareText /></span><h2>Sales and demos</h2><p>Tell us about your team and the work you review, and we’ll show you around.</p></div>
            <div className="mk-card is-pink"><span className="mk-card-icon" aria-hidden="true"><LifeBuoy /></span><h2>Already a customer?</h2><p>Use <b>Help → Report a problem</b> inside the app so we get the details we need.</p></div>
          </div>
          <ContactForm />
        </div>
      </section>
    </>
  );
}
