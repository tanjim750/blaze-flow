"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArchiveRestore, Loader2 } from "@/components/icons";
import { toast } from "sonner";
import { setProjectStatusAction } from "../actions";

export type ArchivedRow = { id: string; name: string; client: string; updatedAt: string };

export function ArchivedList({ rows }: { rows: ArchivedRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  if (!rows.length) return <p className="pb-archived-empty">Nothing is archived. Archive a project from its &ldquo;More actions&rdquo; menu.</p>;

  const restore = (row: ArchivedRow) => {
    setBusy(row.id); setError(null);
    start(async () => {
      const result = await setProjectStatusAction(row.id, "ACTIVE");
      setBusy(null);
      if (result.error) { setError(result.planLimit ? `${result.error} Archive another project first.` : result.error); return; }
      toast.success(`Restored ${row.name}`);
      router.refresh();
    });
  };

  return (
    <>
      {error && <p className="pb-archive-error" role="alert">{error}</p>}
      <ul className="pb-archived-list">
        {rows.map((row) => (
          <li key={row.id}>
            <span><strong>{row.name}</strong><small>{row.client || "No client"} · archived {new Date(row.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</small></span>
            <button type="button" onClick={() => restore(row)} disabled={busy !== null} aria-label={`Unarchive ${row.name}`}>
              {busy === row.id ? <Loader2 size={13} className="pb-spin" /> : <ArchiveRestore size={13} />}Unarchive
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
