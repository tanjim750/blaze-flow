import { Bell, Columns2, FileCheck2, Keyboard, Lock, MessagesSquare, Mic, ShieldCheck, UploadCloud } from "lucide-react";
import { ProClosing } from "@/components/pro/pro-home";
import { ProCardGrid, ProFeatureRow, ProPageHero } from "@/components/pro/pro-pages";
import { marketingMetadata } from "@/lib/marketing-metadata";
import { siteConfig } from "@/lib/site-config";

export const metadata = marketingMetadata({
  title: "Features",
  description: `Frame-accurate review, AI Visual QA for on-screen text, a client portal, files, tasks and invoices in ${siteConfig.name}.`,
  path: "/features",
});

const MORE = [
  { icon: <Columns2 />, title: "Compare versions", line: "Play V2 next to V1 in sync." },
  { icon: <Mic />, title: "Voice and screen notes", line: "Record a note on the frame instead of typing it." },
  { icon: <Lock />, title: "Team-only notes", line: "Internal comments the client never sees." },
  { icon: <ShieldCheck />, title: "Roles", line: "Owners, editors, viewers and client reviewers." },
  { icon: <MessagesSquare />, title: "Project chat", line: "Messages next to the work, per project." },
  { icon: <Bell />, title: "Notifications", line: "In the app and by email when a client replies." },
  { icon: <FileCheck2 />, title: "Deliverables", line: "Approved cuts to download, with who signed off." },
  { icon: <Keyboard />, title: "Search", line: "Find any project, file or task, with shortcuts." },
  { icon: <UploadCloud />, title: "In the browser", line: "Nothing to install for you or your clients." },
];

export default function FeaturesPage() {
  return (
    <>
      <ProPageHero label="Features" title="Everything between the cut and the invoice" line="Review, proofreading, the client portal, files, tasks and money in one app." />
      <ProFeatureRow id="review" label="Review" title="Notes on the exact frame" line="Clients click a frame or an area and leave a note or a drawing. They approve the version they watched." points={["Time-ranged comments and drawings", "Open notes carry over to the next version", "Approve and request-changes on review links"]} shot="review" />
      <ProFeatureRow id="ai-qa" label="AI Visual QA" title="A proofreader for posters and titles" line="It reads the text in artwork and video frames and checks it against the approved copy." points={["Spelling in UK and US English", "Changed prices, dates and missing lines", "A person accepts every finding"]} shot="aiqaVideo" flip />
      <ProFeatureRow id="portal" label="Client portal" title="A portal with your logo" line="Clients see cuts waiting on them, approved work, invoices and messages." points={["Your logo and studio name", "Clients send files up to 1 GB each", "Progress and sign-off records"]} shot="portal" />
      <ProFeatureRow id="files" label="Files" title="Files sorted by client and project" line="Thumbnails, durations and review stage on every upload." points={["1 GB uploads in a background tray", "Grid and list views, folders, filters"]} shot="files" flip />
      <ProFeatureRow id="tasks" label="Tasks" title="Tasks that keep the frame" line="Turn notes into tasks with the version attached, and track them on a board." points={["Board and list views", "Your own stages, due dates and priorities"]} shot="tasks" />
      <section className="pro-more" aria-labelledby="pro-more-title">
        <div className="pro-wrap">
          <h2 id="pro-more-title" className="pro-h2 is-center">And the rest</h2>
          <ProCardGrid items={MORE} />
        </div>
      </section>
      <ProClosing />
    </>
  );
}
