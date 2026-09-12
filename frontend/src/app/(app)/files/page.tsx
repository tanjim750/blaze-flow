import { loadFilesView } from "@/lib/files-view"; import { FilesBrowser } from "./browser"; import "./files.css"; import "@/components/asset-library.css";
export default async function FilesPage() { const view = await loadFilesView(); return <><FilesBrowser view={view} /></>; }
