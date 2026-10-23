"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MessagesSquare } from "lucide-react";
import { chatHref, fetchUnread } from "@/lib/messages";

/**
 * Opens the project's chat channel. Optional `quote` is passed as `#quote=` so the
 * composer can prefill a chip when the chat page lands.
 */
export function DiscussInChatButton({ workspaceId, projectId, side = "client", label = "Discuss in chat", quote = "" }: {
  workspaceId: string; projectId: string; side?: "client" | "team"; label?: string; quote?: string;
}) {
  const [href, setHref] = useState(side === "team" ? "/chat" : "/portal/chat");
  useEffect(() => {
    void fetchUnread(workspaceId).then((result) => {
      if (!result.ok) return;
      const row = result.data.projects.find((project) => project.project_id === projectId);
      if (!row?.chat_channel_id) return;
      const kind = row.viewer_kind === "client" ? "client" : "team";
      const chosen = side === "team" && kind === "team" ? "team" : "client";
      const base = chatHref(row.chat_channel_id, kind, chosen);
      setHref(quote ? `${base}#quote=${encodeURIComponent(quote.slice(0, 280))}` : base);
    });
  }, [workspaceId, projectId, side, quote]);
  return <Link className="pt-ghost" href={href} style={{ height: 30, padding: "0 10px", fontSize: 12 }}><MessagesSquare size={13} />{label}</Link>;
}
