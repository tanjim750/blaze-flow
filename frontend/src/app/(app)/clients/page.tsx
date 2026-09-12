import { loadClientsView } from "@/lib/clients-view";
import { ClientsPanel } from "./panel";
import "./clients.css";

export default async function ClientsPage() {
  const view = await loadClientsView();
  return <><ClientsPanel view={view} /></>;
}
