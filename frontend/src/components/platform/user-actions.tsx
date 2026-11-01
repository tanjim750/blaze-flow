"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, MailCheck } from "@/components/icons";
import { platformActions } from "@/lib/platform-client";
import { ReasonDialog } from "./reason-dialog";

type Action = "resend-verification" | "password-reset";
const COPY: Record<Action, { title: string; description: string; confirm: string }> = {
  "resend-verification": { title: "Resend verification email", description: "Sends a fresh verification link to the user. Older links stop working.", confirm: "Send verification" },
  "password-reset": { title: "Send password reset", description: "Emails a reset link to the user. Their current password keeps working until they use it.", confirm: "Send reset link" },
};

export function UserActions({ userId, email, verified }: { userId: string; email: string; verified: boolean }) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  return <div className="pf-actions">
    <button type="button" className="pf-btn" disabled={verified} title={verified ? "Already verified" : undefined} onClick={() => setAction("resend-verification")}><MailCheck size={15} />Resend verification</button>
    <button type="button" className="pf-btn" onClick={() => setAction("password-reset")}><KeyRound size={15} />Send password reset</button>
    {action && <ReasonDialog
      open onOpenChange={(open) => !open && setAction(null)}
      title={COPY[action].title} description={`${COPY[action].description} (${email})`} confirmLabel={COPY[action].confirm}
      onConfirm={async (reason) => {
        const result = await platformActions.userAction(userId, action, reason);
        if (!result.ok) return result.detail;
        toast.success(result.data.detail);
        router.refresh();
        return null;
      }}
    />}
  </div>;
}
