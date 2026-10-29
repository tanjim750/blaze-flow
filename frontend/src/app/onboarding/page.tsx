import { redirect } from "next/navigation";
import { listWorkspaces } from "@/lib/api";
import { loadSession } from "@/lib/session";
import { OnboardingForm } from "./form";
import { KrewsysLogo } from "@/components/brand/krewsys-logo";
import "./onboarding.css";

export default async function OnboardingPage() {
  const session = await loadSession();
  if (!session.user) redirect("/sign-in");
  const workspaces = await listWorkspaces();
  if (workspaces.ok && workspaces.data.length) redirect("/");

  return <main className="onboarding-page">
    <header><KrewsysLogo height={32} /></header>
    <OnboardingForm verified={Boolean(session.user.email_verified_at)} email={session.user.email} defaultTimezone={session.user.timezone || "UTC"} />
  </main>;
}
