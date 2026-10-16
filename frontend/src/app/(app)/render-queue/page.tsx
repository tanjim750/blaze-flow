import { guardRoute } from "@/lib/route-guard";
import { loadRenderQueue } from "@/lib/render-queue-view"; import { RenderQueuePanel } from "./panel"; import "./render-queue.css";
export default async function RenderQueuePage() {
  await guardRoute("/render-queue"); const queue = await loadRenderQueue(); return <><RenderQueuePanel items={queue.items} notice={queue.notice} /></>; }
