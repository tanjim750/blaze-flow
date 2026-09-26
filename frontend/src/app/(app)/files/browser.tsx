"use client";
import { TriangleAlert } from "lucide-react"; import { AssetLibrary } from "@/components/asset-library"; import type { FilesView } from "@/lib/files-view";
export function FilesBrowser({ view }: { view: FilesView }) { return <div className="files-page">{view.notice && <p className="files-notice" role="status"><TriangleAlert />{view.notice}</p>}<AssetLibrary view={view} /></div>; }
