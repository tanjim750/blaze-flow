import { Eye } from "@/components/icons";
import { exitWorkspaceViewAction } from "@/app/platform/workspaces/actions";

/** Shown above every app page while platform staff are viewing someone else's workspace. */
export function PlatformViewBanner({ workspaceId, name }: { workspaceId: string; name: string }) {
  return <div className="pf-view-banner" role="status">
    <Eye size={16} aria-hidden />
    <span>Viewing <b>{name}</b> as platform staff, read-only</span>
    <form action={exitWorkspaceViewAction}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <button type="submit" className="pf-view-banner-exit">Exit</button>
    </form>
  </div>;
}
