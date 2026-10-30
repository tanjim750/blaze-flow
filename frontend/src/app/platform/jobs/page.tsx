import Link from "next/link";
import { JobsTable } from "@/components/platform/jobs-table";
import { Empty, ErrorPanel, PageHead, Pager } from "@/components/platform/ui";
import { listJobs } from "@/lib/platform-api";
import { firstParam, query } from "@/lib/platform-view";

const TABS = [
  { kind: "outbox", status: "", label: "All failing" },
  { kind: "outbox", status: "DEAD_LETTER", label: "Dead letters" },
  { kind: "outbox", status: "FAILED", label: "Retrying" },
  { kind: "ai_qa", status: "", label: "AI QA failures" },
];

export default async function PlatformJobs({ searchParams }: PageProps<"/platform/jobs">) {
  const params = await searchParams;
  const kind = firstParam(params.kind) === "ai_qa" ? "ai_qa" : "outbox";
  const status = kind === "outbox" ? firstParam(params.status) : "";
  const offset = Number(firstParam(params.offset)) || 0;
  const result = await listJobs({ kind, status, offset, limit: 50 });
  return <>
    <PageHead title="Jobs & failures" sub="Background work that failed: emails, previews, scans and AI QA. Fix the cause, then retry." />
    <nav className="pf-tabs" aria-label="Job filters">
      {TABS.map((t) => { const on = t.kind === kind && t.status === status; return <Link key={t.label} href={`/platform/jobs${query({ kind: t.kind, status: t.status })}`} className={on ? "active" : undefined} aria-current={on ? "page" : undefined}>{t.label}</Link>; })}
    </nav>
    {!result.ok ? <ErrorPanel detail={result.error.detail} /> : result.data.results.length === 0 ? <Empty>Nothing failing here. 🎉</Empty> : <>
      <JobsTable key={`${kind}:${status}:${offset}`} rows={result.data.results} />
      <Pager total={result.data.total} limit={result.data.limit} offset={result.data.offset} href={(o) => `/platform/jobs${query({ kind, status, offset: o })}`} />
    </>}
  </>;
}
