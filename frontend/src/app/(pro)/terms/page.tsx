import Link from "next/link";
import { ProLegal } from "@/components/pro/pro-pages";
import { marketingMetadata } from "@/lib/marketing-metadata";
import { siteConfig } from "@/lib/site-config";

export const metadata = marketingMetadata({ title: "Terms of service", description: `The terms that apply when you use ${siteConfig.name}.`, path: "/terms" });

export default function TermsPage() {
  const { name, contactEmail, legalEntity, jurisdiction, pricing } = siteConfig;
  const mail = <a href={`mailto:${contactEmail}`}>{contactEmail}</a>;
  return (
    <ProLegal title="Terms of service" intro={`The agreement between you and ${name} when you use the service.`}>
      <h2>1. About these terms</h2>
      <p>These terms apply to your use of {name}, provided by {legalEntity} (“we”, “us”). By creating an account or using the service you agree to them on behalf of yourself and, if applicable, the business you represent (“you”). {name} is intended for business use.</p>

      <h2>2. Your account</h2>
      <ul>
        <li>Keep your sign-in details secure and tell us promptly about any unauthorised use.</li>
        <li>Workspace owners are responsible for who they invite, the roles they give and the review links they share.</li>
        <li>You must give accurate information and be at least 18 years old to open an account.</li>
      </ul>

      <h2>3. Subscriptions, trials and payment</h2>
      <ul>
        <li>{name} Pro costs {pricing.symbol}{pricing.proMonthly} per month in {pricing.currency}, unless we agree otherwise in writing. (Owner to confirm whether this is per workspace or per user, and how VAT is shown.)</li>
        <li>New accounts may start with a {pricing.trialDays}-day free trial. At the end of the trial you need a paid subscription to keep using Pro features.</li>
        <li>Subscriptions renew monthly until cancelled. You can cancel at any time, and cancellation takes effect at the end of the current billing period. Fees already paid are not refunded except where the law requires. (Owner to confirm the cancellation and refund policy.)</li>
        <li>We may change prices with at least 30 days’ notice; changes apply from your next renewal.</li>
      </ul>

      <h2>4. Your content</h2>
      <p>You keep all rights in the files, comments and other content you upload. You give us permission to host, copy, transcode, display and process that content only as needed to provide the service to you and the people you share it with, including running features you choose, such as AI Visual QA.</p>
      <p>You are responsible for having the rights and permissions needed for your content, and for the personal data in it. Where we process personal data on your behalf, our data processing terms apply (to be published; see our <Link href="/privacy">privacy notice</Link>).</p>

      <h2>5. Acceptable use</h2>
      <p>Do not use {name} to break the law, infringe others’ rights, upload malware, attempt to access other customers’ data, overload or reverse-engineer the service, or share content that is unlawful or abusive. We may suspend accounts that put the service or other users at risk.</p>

      <h2>6. AI features</h2>
      <p>AI Visual QA gives automated suggestions that may be wrong or incomplete. Always check the results; you remain responsible for approving final work.</p>

      <h2>7. Availability and changes</h2>
      <p>We work hard to keep {name} available and secure but do not promise it will be uninterrupted or error-free. We may improve or change features; if we remove something material to a paid plan we will give reasonable notice.</p>

      <h2>8. Ending the agreement</h2>
      <p>You can close your account at any time. We may end or suspend the service for serious or repeated breach of these terms, or for non-payment. After closure you will have a reasonable period to export your content before it is deleted, as described in the privacy notice.</p>

      <h2>9. Liability</h2>
      <p>Nothing in these terms limits liability that cannot be limited by law, including for death or personal injury caused by negligence, or fraud. Otherwise, we are not liable for indirect or consequential loss, or loss of profit, revenue, data or goodwill, and our total liability in any 12-month period is limited to the fees you paid us in that period. (Owner to confirm the liability cap with a legal adviser.)</p>

      <h2>10. General</h2>
      <p>These terms are governed by the law of {jurisdiction}, and its courts have exclusive jurisdiction. If any part is found unenforceable, the rest still applies. We may update these terms; we will notify account owners of material changes in advance.</p>

      <h2>11. Contact</h2>
      <p>Questions about these terms: {mail}.</p>
    </ProLegal>
  );
}
