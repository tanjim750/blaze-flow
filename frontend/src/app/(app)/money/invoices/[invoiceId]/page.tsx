import { guardRoute } from "@/lib/route-guard";
import Link from "next/link";
import { ArrowLeft, Eye, FileX2 } from "@/components/icons";
import { InvoiceView } from "@/components/money/invoice-view";
import { getInvoice } from "@/lib/billing-api";
import { NO_BILLING, visibleToClient } from "@/lib/money-view";
import { loadWorkspaceContext } from "@/lib/workspace";
import "../../money.css";
import "../../../home.css";

/**
 * One invoice, laid out to print (Print uses the browser's print-to-PDF). Team members with
 * billing.view see any invoice; a client-team member sees their own client's once sent.
 */
export default async function InvoicePage({ params, searchParams }: PageProps<"/money/invoices/[invoiceId]">) {
  await guardRoute("/money/invoices");
  const { invoiceId } = await params;
  const context = await loadWorkspaceContext();
  const workspace = context.ok ? context.data.selected : null;
  const invoice = workspace ? await getInvoice(workspace.id, invoiceId) : null;
  // "View as client" shows the client's read-only invoice (no payment-admin actions).
  const query = await searchParams;
  const asClient = query.view === "client";
  const stripeReturn = query.stripe === "success" || query.stripe === "cancel" ? query.stripe : null;
  const access = asClient ? NO_BILLING : workspace?.billing ?? NO_BILLING;
  if (!workspace || !invoice || !invoice.ok) {
    return <div className="money-page"><section className="money-empty is-page" role="alert">
      <FileX2 aria-hidden="true" /><h1>Invoice not found</h1>
      <p>{invoice && !invoice.ok && invoice.error.status !== 404 ? invoice.error.detail : "It may have been deleted, or it isn't shared with you."}</p>
      <Link href={access.view ? "/money" : "/"}><ArrowLeft size={14} aria-hidden="true" />{access.view ? "Back to Money" : "Back to dashboard"}</Link>
    </section></div>;
  }
  if (!asClient) return <InvoiceView workspaceId={workspace.id} invoice={invoice.data} canManage={access.manage} backHref={access.view ? "/money" : "/"} now={new Date().toISOString()} stripeReturn={stripeReturn} />;
  // Owner previewing as the client: a banner says so, drafts stay hidden (a client never sees
  // one), and the read-only view has no payment-admin actions (canManage is off).
  const banner = <div className="preview-banner invoice-client-preview" role="status">
    <Eye size={14} aria-hidden="true" />
    <p><strong>Preview: client view.</strong> This is the read-only invoice {invoice.data.bill_to.name} sees.</p>
    <Link href={`/money/invoices/${invoice.data.id}`}>Exit preview</Link>
  </div>;
  if (!visibleToClient(invoice.data.status)) {
    return <div className="money-page">{banner}<section className="money-empty is-page" role="status">
      <FileX2 aria-hidden="true" /><h1>Not visible to the client yet</h1>
      <p>{invoice.data.number} is still a draft. {invoice.data.bill_to.name} sees it once it&rsquo;s sent.</p>
      <Link href="/?view=client#invoices"><ArrowLeft size={14} aria-hidden="true" />Back to client dashboard</Link>
    </section></div>;
  }
  return <div className="money-page">{banner}<InvoiceView workspaceId={workspace.id} invoice={invoice.data} canManage={false} backHref="/?view=client#invoices" now={new Date().toISOString()} /></div>;
}
