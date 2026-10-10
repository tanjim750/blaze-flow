import { loadFilesView } from "@/lib/files-view"; import { FilesBrowser } from "./browser"; import "./files.css"; import "@/components/asset-library.css";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function FilesPage({ searchParams }: { searchParams: SearchParams }) {
  const [view, params] = await Promise.all([loadFilesView(), searchParams]);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (typeof value === "string") query.set(key, value);
  return <FilesBrowser view={view} initialQuery={query.toString()} />;
}
