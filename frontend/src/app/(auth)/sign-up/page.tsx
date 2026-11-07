import { getAuthConfig, getInvitePreview } from "@/lib/api";
import { SignUpForm } from "./form";
import { SignupClosed } from "./closed";

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

/**
 * Sign-up honours SIGNUP_MODE from Django. In invite_only mode the form still renders for
 * anyone arriving with an invite token (or who can use the "I have an invite" path); the
 * API makes the final decision, so a closed page here is a courtesy, not the gate.
 */
export default async function SignUp({ searchParams }: PageProps<"/sign-up">) {
  const params = await searchParams;
  const invite = one(params.invite);
  const [config, preview] = await Promise.all([
    getAuthConfig(),
    invite ? getInvitePreview(invite) : Promise.resolve(null),
  ]);
  const validInvite = preview?.ok && preview.data.state === "valid" ? preview.data : null;
  const forceForm = one(params.invited) === "1";
  if (config.signup_mode === "invite_only" && !validInvite && !forceForm) return <SignupClosed />;
  return (
    <SignUpForm
      inviteToken={validInvite ? invite : undefined}
      invite={validInvite}
      inviteOnly={config.signup_mode === "invite_only"}
      next={one(params.next)}
    />
  );
}
