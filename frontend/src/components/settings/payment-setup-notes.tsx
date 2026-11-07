import type { ReactNode } from "react";
import { CircleHelp, ExternalLink, Info, ShieldCheck } from "@/components/icons";

/** Plain-English, step-by-step setup notes for each payment option in Settings → Billing. */
export type SetupNote = { title: string; steps: ReactNode[]; links: { label: string; href: string }[]; tip?: ReactNode };

export const SETUP_NOTES: Record<string, SetupNote> = {
  stripe: {
    title: "Stripe",
    steps: [
      <>Press <strong>Connect Stripe</strong> on the Stripe card.</>,
      <>Stripe opens its own sign-up. Enter your business details and the bank account you want paid into. Stripe may ask for ID.</>,
      <>When Stripe sends you back here, the card shows your status. If it says something is still needed, press <strong>Continue onboarding</strong> (or <strong>Add missing details</strong>) and complete it.</>,
      <>While Stripe is in <strong>test mode</strong>, no real money moves. Once Stripe approves your account it goes live and clients can pay by card.</>,
    ],
    links: [{ label: "Stripe sign-up", href: "https://dashboard.stripe.com/register" }],
    tip: "Paid invoices are marked paid automatically.",
  },
  paypal: {
    title: "PayPal",
    steps: [
      <>You need a PayPal <strong>Business</strong> account. Then log in to the PayPal developer dashboard with it.</>,
      <>Go to <strong>Apps &amp; Credentials</strong>. Choose <strong>Sandbox</strong> to test or <strong>Live</strong> for real payments, then press <strong>Create App</strong>.</>,
      <>Open the app and copy the <strong>Client ID</strong> and the <strong>Secret</strong>.</>,
      <>Press <strong>Set up PayPal</strong>, paste both, pick the same mode (Sandbox or Live), press <strong>Save keys</strong>, then <strong>Test connection</strong>.</>,
      <>Optional: copy the webhook URL shown on the card, add it as a webhook in your PayPal app, and paste the <strong>Webhook ID</strong> back here.</>,
    ],
    links: [
      { label: "PayPal Business sign-up", href: "https://www.paypal.com/business" },
      { label: "PayPal developer dashboard", href: "https://developer.paypal.com/dashboard/applications" },
    ],
    tip: "Paid invoices are marked paid automatically.",
  },
  wise: {
    title: "Wise",
    steps: [
      <>Open a Wise Business account if you don&rsquo;t have one.</>,
      <>In Wise, open your currency balance → <strong>Receive</strong> → <strong>Account details</strong>.</>,
      <>Press <strong>Add Wise details</strong> and paste them exactly as Wise shows them (account holder, account number or IBAN, sort code / routing / SWIFT, bank). Add one block per currency.</>,
      <>Optional: paste your Wise <strong>Quick Pay</strong> link so clients can pay in a click.</>,
    ],
    links: [{ label: "Wise Business sign-up", href: "https://wise.com/business/" }],
    tip: <>How it works: the client sees your details on the invoice, sends the money, and presses <strong>I&rsquo;ve paid</strong>. You get a notice; check the money arrived, then press <strong>Confirm received</strong> on the invoice to mark it paid (or <strong>Not received</strong>).</>,
  },
  payoneer: {
    title: "Payoneer",
    steps: [
      <>Open a Payoneer account if you don&rsquo;t have one.</>,
      <>In Payoneer, go to <strong>Receive</strong> → <strong>Receiving accounts</strong> and copy the details for each currency.</>,
      <>Press <strong>Add Payoneer details</strong> and paste them. Optional: add a Payoneer payment request link (Get Paid → Request a Payment).</>,
    ],
    links: [{ label: "Payoneer sign-up", href: "https://www.payoneer.com/" }],
    tip: <>How it works: the client pays you and presses <strong>I&rsquo;ve paid</strong>. Someone on your team checks Payoneer and presses <strong>Confirm received</strong> on the invoice to mark it paid.</>,
  },
  paymongo: {
    title: "PayMongo (Philippines)",
    steps: [
      <>Sign up for PayMongo and finish its business verification.</>,
      <>In the PayMongo dashboard, open <strong>Developers</strong> → <strong>API keys</strong> and copy the <strong>Public key</strong> and <strong>Secret key</strong> (test keys start with <code>pk_test_</code> / <code>sk_test_</code>).</>,
      <>In <strong>Developers</strong> → <strong>Webhooks</strong>, add the webhook URL shown on the PayMongo card and copy its <strong>signing secret</strong>.</>,
      <>Press <strong>Set up PayMongo</strong>, paste the three values, choose Sandbox or Live, press <strong>Save keys</strong>, then <strong>Test connection</strong> and turn it on.</>,
    ],
    links: [{ label: "PayMongo sign-up", href: "https://dashboard.paymongo.com/signup" }],
  },
  safepay: {
    title: "Safepay (Pakistan)",
    steps: [
      <>Sign up for a Safepay merchant account.</>,
      <>In the Safepay dashboard, open the <strong>Developer</strong> section and copy your <strong>API key</strong> (the public merchant key) and <strong>Secret key</strong>.</>,
      <>Add the webhook URL shown on the Safepay card as a webhook, and copy the <strong>Webhook shared secret</strong>.</>,
      <>Press <strong>Set up Safepay</strong>, paste them, choose Sandbox or Live, press <strong>Save keys</strong>, then <strong>Test connection</strong> and turn it on.</>,
    ],
    links: [{ label: "Safepay sign-up", href: "https://getsafepay.com/" }],
  },
  sslcommerz: {
    title: "SSLCOMMERZ (Bangladesh)",
    steps: [
      <>Register a merchant account with SSLCOMMERZ (use a sandbox account first to test).</>,
      <>SSLCOMMERZ emails you a <strong>Store ID</strong> and <strong>Store password</strong>.</>,
      <>In the SSLCOMMERZ merchant panel, set the IPN URL to the one shown on the SSLCOMMERZ card.</>,
      <>Press <strong>Set up SSLCOMMERZ</strong>, paste the Store ID and Store password, choose Sandbox or Live, press <strong>Save keys</strong>, then <strong>Test connection</strong> and turn it on.</>,
    ],
    links: [{ label: "SSLCOMMERZ sign-up", href: "https://signup.sslcommerz.com/register" }],
  },
};

/** A collapsible "How to set this up" note under one payment option. */
export function PaymentSetupNote({ provider }: { provider: string }) {
  const note = SETUP_NOTES[provider];
  if (!note) return null;
  return <details className="setup-note" data-provider={provider}>
    <summary><CircleHelp aria-hidden="true" />How to set up {note.title}</summary>
    <ol>{note.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
    {note.tip && <p className="setup-note-tip">{note.tip}</p>}
    <p className="setup-note-links">{note.links.map((link) => <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">{link.label}<ExternalLink aria-hidden="true" /></a>)}</p>
  </details>;
}

/** Short overview at the top of the payment options: who does what. */
export function PaymentSetupOverview() {
  return <div className="setup-overview" role="note" aria-label="How payments work">
    <Info aria-hidden="true" />
    <div>
      <strong>How payments work</strong>
      <ul>
        <li><strong>Owners and admins</strong> set this up once: pick a payment option below and follow its &ldquo;How to set up&rdquo; steps.</li>
        <li><strong>Editors and members</strong> don&rsquo;t need to do anything.</li>
        <li><strong>Clients</strong> pay from the link on their invoice. You&rsquo;ll see the invoice marked paid (Wise and Payoneer need a quick confirm from you).</li>
      </ul>
    </div>
  </div>;
}

/** What editors and members see instead of setup steps. */
export function PaymentsReadOnlyNote() {
  return <div className="setup-overview is-readonly" role="note" aria-label="Payments are managed by an owner or admin">
    <ShieldCheck aria-hidden="true" />
    <div>
      <strong>An owner or admin manages payments</strong>
      <p>You don&rsquo;t need to do anything here. Payment options are set up by the workspace owner or an admin, and clients pay from the link on their invoice. Ask them if something looks wrong.</p>
    </div>
  </div>;
}
