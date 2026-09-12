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
  return <><ClientsPanel view={view} focusId={focusId} /></>;
}
