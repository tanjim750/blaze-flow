import Link from "next/link";
import { ArrowLeft, FileX2 } from "lucide-react";
import { InvoiceView } from "@/components/money/invoice-view";
import { getInvoice } from "@/lib/billing-api";
import { NO_BILLING } from "@/lib/money-view";
import { loadWorkspaceContext } from "@/lib/workspace";
import "../../money.css";

/**
 * One invoice, laid out to print (Print uses the browser's print-to-PDF). Team members with
 * billing.view see any invoice; a client-team member sees their own client's once sent.
 */
export default async function InvoicePage({ params }: PageProps<"/money/invoices/[invoiceId]">) {
  const { invoiceId } = await params;
  const context = await loadWorkspaceContext();
  const workspace = context.ok ? context.data.selected : null;
  const invoice = workspace ? await getInvoice(workspace.id, invoiceId) : null;
  const access = workspace?.billing ?? NO_BILLING;
  if (!workspace || !invoice || !invoice.ok) {
    return <div className="money-page"><section className="money-empty is-page" role="alert">
      <FileX2 aria-hidden="true" /><h1>Invoice not found</h1>
      <p>{invoice && !invoice.ok && invoice.error.status !== 404 ? invoice.error.detail : "It may have been deleted, or it isn't shared with you."}</p>
      <Link href={access.view ? "/money" : "/"}><ArrowLeft size={14} aria-hidden="true" />{access.view ? "Back to Money" : "Back to dashboard"}</Link>
    </section></div>;
  }
  return <InvoiceView workspaceId={workspace.id} invoice={invoice.data} canManage={access.manage} backHref={access.view ? "/money" : "/"} now={new Date().toISOString()} />;
}
