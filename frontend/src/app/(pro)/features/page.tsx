import { Bell, Columns2, FileCheck2, Keyboard, Lock, MessagesSquare, Mic, ShieldCheck, UploadCloud } from "@/components/icons";
import { ProClosing } from "@/components/pro/pro-home";
import { ProPinnedStory, ProLiveBento } from "@/components/pro/pro-features";
import { ProCardGrid, ProPageHero } from "@/components/pro/pro-pages";
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
      <ProPinnedStory />
      <ProLiveBento />
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
