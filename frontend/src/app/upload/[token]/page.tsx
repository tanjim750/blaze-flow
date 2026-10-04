import type { Metadata } from "next";
import { CircleOff } from "lucide-react";
import { request } from "@/lib/api";
import type { PublicUploadLink } from "@/lib/client-uploads";
import { PublicUploader } from "./uploader";
import "./upload.css";

export const metadata: Metadata = {
  title: "Send files · Blaze Flow",
  description: "Send files to your studio.",
  // The token in the path is the only credential; keep these pages out of search results.
  robots: { index: false, follow: false },
};

/**
 * The public page behind an upload link. No session, no workspace chrome: whoever has the
 * link sees the studio and project it is for, says who they are, and drops files.
 */
export default async function UploadLinkPage({ params }: PageProps<"/upload/[token]">) {
  const { token } = await params;
  const link = await request<PublicUploadLink>(`/public/upload-links/${encodeURIComponent(token)}/`);
  if (!link.ok) {
    const gone = link.error.status === 410;
    return (
      <main className="ul-shell">
        <section className="ul-card ul-closed" role="alert">
          <span className="ul-closed-icon" aria-hidden="true"><CircleOff size={22} /></span>
          <h1>{gone ? "This link is closed" : link.error.status === 404 ? "Link not found" : "Something went wrong"}</h1>
          <p>{link.error.status === 0 ? "The studio's file service could not be reached. Try again in a minute." : link.error.detail}</p>
          <p className="ul-muted">If you still need to send files, ask the studio for a new link.</p>
        </section>
        <footer className="ul-foot">Powered by <strong>Blaze Flow</strong></footer>
      </main>
    );
  }
  return <PublicUploader token={token} link={link.data} />;
}
