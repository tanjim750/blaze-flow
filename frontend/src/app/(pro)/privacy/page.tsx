import Link from "next/link";
import { ProLegal } from "@/components/pro/pro-pages";
import { marketingMetadata } from "@/lib/marketing-metadata";
import { siteConfig } from "@/lib/site-config";

export const metadata = marketingMetadata({ title: "Privacy notice", description: `How ${siteConfig.name} collects, uses and protects personal data under UK GDPR.`, path: "/privacy" });

export default function PrivacyPage() {
  const { name, contactEmail, legalEntity } = siteConfig;
  const mail = <a href={`mailto:${contactEmail}`}>{contactEmail}</a>;
  return (
    <ProLegal title="Privacy notice" intro={`How ${name} collects, uses and protects personal data.`}>
      <h2>1. Who we are</h2>
      <p>{name} (“we”, “us”) is provided by {legalEntity}. For personal data we process for our own purposes, such as running accounts, billing and this website, we are the <strong>controller</strong> under the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018. You can contact us about privacy at {mail}.</p>
      <p>When our customers (studios and agencies) upload their projects, files and client feedback to {name}, the customer is the controller of that content and we process it on their behalf as a <strong>processor</strong>. If you are a client of one of our customers, please contact that studio first about your data; we will help them respond.</p>

      <h2>2. What we collect</h2>
      <ul>
        <li><strong>Account details</strong>: name, email address, password (stored hashed), workspace and role, and profile details you choose to add. If you sign in with Google, we receive your name, email address and Google account identifier.</li>
        <li><strong>Content you upload</strong>: videos, images, documents, comments, drawings, voice and screen recordings, tasks, messages and approval decisions.</li>
        <li><strong>Reviewer details</strong>: when someone reviews through a share link, the name and email address they enter, and what they comment on or approve.</li>
        <li><strong>Billing details</strong>: plan, invoices and payment status. Card details are handled by our payment provider and are not stored by us. (Payment provider to be confirmed.)</li>
        <li><strong>Technical data</strong>: IP address, browser and device information, and logs of sign-ins and actions, kept for security, audit and troubleshooting.</li>
        <li><strong>Messages to us</strong>: what you send when you email us or report a problem.</li>
      </ul>

      <h2>3. Why we use it, and our lawful basis</h2>
      <div className="pro-table-wrap"><table>
        <thead><tr><th>Purpose</th><th>Lawful basis</th></tr></thead>
        <tbody>
          <tr><td>Providing the service: accounts, workspaces, review, file storage, notifications</td><td>Contract</td></tr>
          <tr><td>Billing and keeping financial records</td><td>Contract; legal obligation</td></tr>
          <tr><td>Security, fraud prevention, audit logs and service reliability</td><td>Legitimate interests</td></tr>
          <tr><td>Service emails (verification, password resets, review and approval notifications)</td><td>Contract; legitimate interests</td></tr>
          <tr><td>Answering questions and support requests</td><td>Legitimate interests</td></tr>
          <tr><td>Product news and marketing emails, if we send them</td><td>Consent, which you can withdraw at any time</td></tr>
        </tbody>
      </table></div>

      <h2>4. AI Visual QA</h2>
      <p>AI Visual QA reads the text in images and video frames you choose to check, and compares it with copy you provide. It produces suggestions only; a person decides what to do with each one. We do not use your content to train third-party AI models. (Owner to confirm where checks run and whether any third-party AI provider is used.)</p>

      <h2>5. Who we share it with</h2>
      <p>We use carefully chosen service providers (sub-processors) to run {name}, under contracts that require them to protect your data. Depending on configuration these include hosting, file storage, email delivery and payment providers. A current list is available on request. (Owner to publish the list, for example: hosting provider, Cloudflare R2 for file storage, Resend for email, Google for sign-in, and the payment provider.)</p>
      <p>We do not sell personal data. We may disclose data if required by law, or as part of a sale or reorganisation of the business, subject to this notice.</p>

      <h2>6. International transfers</h2>
      <p>Where a provider processes data outside the UK, we rely on UK adequacy regulations or appropriate safeguards such as the UK International Data Transfer Agreement or the UK Addendum to the EU Standard Contractual Clauses.</p>

      <h2>7. How long we keep it</h2>
      <p>We keep account data while your account is active. When a workspace is closed we delete or anonymise its content within a reasonable period, except where we must keep records (for example invoices, typically six years for UK tax purposes). Security logs are kept for a limited period. (Owner to confirm exact retention periods.)</p>

      <h2>8. Security</h2>
      <p>We use encryption in transit, access controls by role, hashed passwords and audit logging. No system is perfectly secure; if a breach affects you we will tell you and the regulator where the law requires.</p>

      <h2>9. Your rights</h2>
      <p>Under UK GDPR you can ask to access, correct or delete your personal data, to restrict or object to how we use it, and to receive it in a portable format. Where we rely on consent you can withdraw it at any time. Email {mail} and we will respond within one month.</p>
      <p>You also have the right to complain to the Information Commissioner’s Office (ICO) at <a href="https://ico.org.uk/make-a-complaint/" rel="noopener noreferrer">ico.org.uk</a>. We would appreciate the chance to help first.</p>

      <h2>10. Cookies</h2>
      <p>See our <Link href="/cookies">cookie policy</Link>.</p>

      <h2>11. Children</h2>
      <p>{name} is a business tool and is not intended for children under 16.</p>

      <h2>12. Changes</h2>
      <p>We will update this notice when our practices change and show the date at the top. For significant changes we will tell account owners by email.</p>
    </ProLegal>
  );
}
