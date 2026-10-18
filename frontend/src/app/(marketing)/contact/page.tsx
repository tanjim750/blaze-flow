import { LifeBuoy, Mail, MessageSquareText } from "lucide-react";
import { ContactForm } from "@/components/marketing/contact-form";
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
      <section className="mk-page-hero">
        <div className="mk-wrap">
          <p className="mk-eyebrow">Contact</p>
          <h1>Talk to a human.</h1>
          <p>Questions about {siteConfig.name}, pricing, or moving your studio over? We read every message.</p>
        </div>
      </section>
      <section className="mk-section" style={{ paddingTop: 0 }}>
        <div className="mk-wrap mk-contact">
          <div className="mk-contact-cards">
            <div className="mk-card"><Mail aria-hidden="true" /><h2 style={{ fontSize: 18 }}>Email</h2><p><a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a></p></div>
            <div className="mk-card"><MessageSquareText aria-hidden="true" /><h2 style={{ fontSize: 18 }}>Sales and demos</h2><p>Tell us about your team and the work you review, and we’ll show you around.</p></div>
            <div className="mk-card"><LifeBuoy aria-hidden="true" /><h2 style={{ fontSize: 18 }}>Already a customer?</h2><p>Use <b>Help → Report a problem</b> inside the app so we get the details we need.</p></div>
          </div>
          <ContactForm />
        </div>
      </section>
    </>
  );
}
