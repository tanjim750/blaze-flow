import { redirect } from "next/navigation";
import { Flame } from "lucide-react";
import { listWorkspaces } from "@/lib/api";
import { loadSession } from "@/lib/session";
import { OnboardingForm } from "./form";
import "./onboarding.css";

export default async function OnboardingPage() {
  const session = await loadSession();
  if (!session.user) redirect("/sign-in");
  const workspaces = await listWorkspaces();
  if (workspaces.ok && workspaces.data.length) redirect("/");

  return <main className="onboarding-page">
    <header><span><Flame size={18} /></span><strong>Blaze Flow</strong></header>
    <OnboardingForm verified={Boolean(session.user.email_verified_at)} email={session.user.email} defaultTimezone={session.user.timezone || "UTC"} />
  </main>;
}
