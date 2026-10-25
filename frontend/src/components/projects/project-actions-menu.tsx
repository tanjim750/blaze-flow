"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Ellipsis, Loader2 } from "@/components/icons";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/tasks/task-dialogs";
import { setProjectStatusAction } from "@/app/(app)/projects/actions";
import { PROJECT_STATUSES, statusLabel } from "@/lib/project-status";

/** The project header's ⋯ menu: change status, or archive the project. */
export function ProjectActionsMenu({ projectId, name, status }: { projectId: string; name: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const setStatus = (next: string) => {
    if (next === status) return;
    start(async () => {
      const result = await setProjectStatusAction(projectId, next);
      if (result.error) { toast.error(result.error); return; }
      toast.success(`${name} is now ${statusLabel(next).toLowerCase()}.`);
      router.refresh();
    });
  };

  const archive = () => start(async () => {
    const result = await setProjectStatusAction(projectId, "ARCHIVED");
    setConfirming(false);
    if (result.error) { toast.error(result.error); return; }
    toast.success(`Archived ${name}.`, { action: { label: "Undo", onClick: () => void setProjectStatusAction(projectId, status).then((undo) => { if (undo.error) toast.error(undo.error); router.refresh(); }) } });
    router.push("/projects");
    router.refresh();
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="pb-ghost-button pb-icon-only" type="button" aria-label="More actions" disabled={pending}>
            {pending ? <Loader2 size={15} className="pb-spin" /> : <Ellipsis size={15} />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="pb-actions-menu">
          <DropdownMenuLabel>Status</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={status} onValueChange={setStatus}>
            {PROJECT_STATUSES.map((value) => (
              <DropdownMenuRadioItem key={value} value={value}>{statusLabel(value)}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirming(true)}><Archive size={14} />Archive project…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirming}
        title={`Archive ${name}?`}
        body={<>It leaves the Projects list and stops counting towards your plan&rsquo;s project limit. Files, comments and invoices are kept, and you can unarchive it from <strong>Archived projects</strong>.</>}
        confirmLabel={pending ? "Archiving…" : "Archive"}
        busy={pending}
        onConfirm={archive}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`pb-status is-${status.toLowerCase().replace("_", "-")}`}>{status === "COMPLETED" && <Check size={11} />}{statusLabel(status)}</span>;
}
