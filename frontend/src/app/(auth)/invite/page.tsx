import { getCurrentUser, getInvitePreview } from "@/lib/api";
import { InvitePanel } from "./panel";

/**
 * Landing page for workspace and client-team invitation links (`INVITE_ACCEPT_URL?token=`).
 * Signed in: accept in one click. Signed out: sign in or create an account (allowed even in
 * invite_only mode because the token travels with the sign-up).
 */
export default async function Invite({ searchParams }: PageProps<"/invite">) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const [preview, me] = await Promise.all([
    token ? getInvitePreview(token) : Promise.resolve(null),
    getCurrentUser(),
  ]);
  return (
    <InvitePanel
      token={token}
      invite={preview?.ok ? preview.data : null}
      userEmail={me.ok ? me.data.email : null}
    />
  );
}
