"use client";

import { useRef } from "react";
import { viewWorkspaceAction } from "@/app/platform/workspaces/actions";

/** A workspaces-table row: clicking anywhere (except a link or button) opens the read-only view. */
export function WorkspaceRow({ id, name, children }: { id: string; name: string; children: React.ReactNode }) {
  const form = useRef<HTMLFormElement>(null);
  return <tr className="pf-row-click" tabIndex={0} aria-label={`View ${name} read-only`}
    onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,form")) form.current?.requestSubmit(); }}
    onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) form.current?.requestSubmit(); }}>
    {children}
    <td data-label="" className="pf-row-action">
      <form ref={form} action={viewWorkspaceAction}><input type="hidden" name="workspaceId" value={id} /><button type="submit" className="pf-btn is-small">View</button></form>
    </td>
  </tr>;
}
