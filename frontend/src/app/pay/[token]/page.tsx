import { paymentReturn } from "@/lib/payment-gateways";
import type { Metadata } from "next";
import { CircleOff } from "@/components/icons";
import { request } from "@/lib/api";
import type { InvoiceDetail } from "@/lib/money-view";
import { PublicPayView, type PublicInvoice } from "./pay-view";
import "./pay.css";

export const metadata: Metadata = {
  title: "Pay invoice · Blaze Flow",
  description: "Pay your invoice online.",
  // The token in the path is the only credential; keep these pages out of search results.
  robots: { index: false, follow: false },
};

/**
 * The shareable pay link: anyone with it sees the invoice (no login, no internal notes) and can
 * pay it through Stripe Checkout on the studio's own Stripe account.
 */
export default async function PayPage({ params, searchParams }: PageProps<"/pay/[token]">) {
  const { token } = await params;
  const query = await searchParams;
  const back = paymentReturn(query);
  const provider = typeof query.provider === "string" ? query.provider : null;
  const invoice = await request<InvoiceDetail & { studio_name: string }>(`/public/pay/${encodeURIComponent(token)}/`);
  if (!invoice.ok) {
    return <main className="pay-shell">
      <section className="pay-card pay-closed" role="alert">
        <span className="pay-closed-icon" aria-hidden="true"><CircleOff size={22} /></span>
        <h1>{invoice.error.status === 404 ? "Payment link not found" : "Something went wrong"}</h1>
        <p>{invoice.error.status === 0 ? "The payment service could not be reached. Try again in a minute." : invoice.error.detail}</p>
        <p className="pay-muted">Ask the studio for a new link if you still need to pay.</p>
      </section>
      <footer className="pay-foot">Powered by <strong>Blaze Flow</strong></footer>
    </main>;
  }
  return <PublicPayView token={token} invoice={invoice.data as PublicInvoice} back={back} provider={provider} />;
}
