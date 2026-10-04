import { listProjectRequests } from "@/lib/api";
import { loadClientsView } from "@/lib/clients-view";
import { ClientsPanel } from "./panel";
import "./clients.css";

/**
 * `?client=<id>` focuses one card. The projects tree links here from each client's
 * Details button, and landing on an unscrolled grid of twenty cards would not be an
 * answer to "show me this client".
 */
export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  const [view, params] = await Promise.all([loadClientsView(), searchParams]);
  const focusId = typeof params.client === "string" ? params.client : null;
  // The requests inbox is for people who may create projects; anyone else gets no link.
  const requests = view.workspaceId ? await listProjectRequests(view.workspaceId, "pending") : null;
  const pending = requests?.ok && requests.data.viewer === "team" ? requests.data.requests.length : null;
  return <><ClientsPanel view={view} focusId={focusId} requestsPending={pending} /></>;
}
