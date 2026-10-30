import { LifeBuoy, Mail, MessageSquareText } from "@/components/icons";
import { ProCardGrid, ProContactForm, ProPageHero } from "@/components/pro/pro-pages";
import { marketingMetadata } from "@/lib/marketing-metadata";
import { siteConfig } from "@/lib/site-config";

export const metadata = marketingMetadata({
  title: "Contact",
  description: `Questions about ${siteConfig.name}, pricing or a demo? Get in touch.`,
  path: "/contact",
});

export default function ContactPage() {
  const mail = <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a>;
  return (
    <>
      <ProPageHero label="Contact" title="Talk to us" line="Questions, a demo, or moving your studio over. We read every message." />
      <section className="pro-contact" aria-label="Ways to reach us">
        <div className="pro-wrap pro-contact-grid">
          <ProCardGrid headingLevel="h2" items={[
            { icon: <Mail />, title: "Email", line: mail },
            { icon: <MessageSquareText />, title: "Demos", line: "Tell us about your team and we’ll show you around." },
            { icon: <LifeBuoy />, title: "Support", line: <>In the app, use <b>Help → Report a problem</b>.</> },
          ]} />
          <ProContactForm />
        </div>
      </section>
    </>
  );
}
