import { notFound } from "next/navigation";
import { AppToaster } from "@/components/app-toaster";
import { PlatformNav } from "@/components/platform/nav";
import { loadSession } from "@/lib/session";
import { getOverview } from "@/lib/platform-api";
import "./platform.css";

/**
 * The staff-only platform admin. Hidden (404, not 403) from everyone without the
 * `access_platform_admin` permission so its existence is not advertised; the API checks
 * the same permission on every call, so this is cosmetic, not the security boundary.
 */
export default async function PlatformLayout({ children }: LayoutProps<"/platform">) {
  const session = await loadSession();
  if (!session.user?.is_platform_staff) notFound();
  const overview = await getOverview(30);
  const count = (code: string) => (overview.ok ? overview.data.attention.find((a) => a.code === code)?.count ?? 0 : 0);
  const badges = { Jobs: count("dead_letters") + count("outbox_failed") + count("ai_qa_failed"), Support: count("new_tickets") };
  return (
    <div className="pf-shell">
      <PlatformNav email={session.user.email} badges={badges} />
      <main className="pf-main">{children}</main>
      <AppToaster />
    </div>
  );
}
