"use client";
import { useSearchParams } from "next/navigation"; import { TriangleAlert } from "lucide-react"; import { AssetLibrary } from "@/components/asset-library"; import type { FilesView } from "@/lib/files-view";
// The live query string, not only the server's: Back from review can restore a cached
// render of /files whose props predate the search the user typed (mirrored into the URL).
export function FilesBrowser({ view, initialQuery = "" }: { view: FilesView; initialQuery?: string }) { const live = useSearchParams()?.toString() ?? initialQuery; return <div className="files-page">{view.notice && <p className="files-notice" role="status"><TriangleAlert />{view.notice}</p>}<AssetLibrary view={view} initialQuery={live} syncUrl /></div>; }
