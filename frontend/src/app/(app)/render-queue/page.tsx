import { loadRenderQueue } from "@/lib/render-queue-view"; import { RenderQueuePanel } from "./panel"; import "./render-queue.css";
export default async function RenderQueuePage() { const queue = await loadRenderQueue(); return <><RenderQueuePanel items={queue.items} notice={queue.notice} /></>; }
