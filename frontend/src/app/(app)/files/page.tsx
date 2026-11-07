import { redirect } from "next/navigation";
import { guardRoute } from "@/lib/route-guard";
import { legacyFilesHref } from "@/lib/projects-home";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function FilesPage({ searchParams }: { searchParams: SearchParams }) {
  await guardRoute("/files");
  redirect(legacyFilesHref(await searchParams));
}
