import { Bell, Columns2, FileCheck2, FolderOpen, Keyboard, ListChecks, Lock, MessageSquareText, MessagesSquare, Mic, PoundSterling, ScanText, ShieldCheck, Sparkles, UploadCloud } from "lucide-react";
import { FeatureBlock, FinalCta, SectionHead } from "@/components/marketing/sections";
import { Screenshot } from "@/components/marketing/screenshot";
import { marketingMetadata } from "@/lib/marketing-metadata";
import { siteConfig } from "@/lib/site-config";

export const metadata = marketingMetadata({
  title: "Features",
  description: `Video and poster review with frame-accurate notes, AI Visual QA for on-screen text, a branded client portal, files, tasks and invoices: everything in ${siteConfig.name}.`,
  path: "/features",
});

const MORE = [
  { icon: <Columns2 />, title: "Compare versions", body: "Put V2 next to V1 and play them in sync to check exactly what changed." },
  { icon: <Mic />, title: "Voice, screen and camera notes", body: "When typing it out would take longer, record it against the frame instead." },
  { icon: <Lock />, title: "Team-only notes", body: "Keep internal comments away from the client, and preview what they will see before you share." },
  { icon: <ShieldCheck />, title: "Roles and permissions", body: "Owners, editors, read-only viewers and client reviewers each see what they need, and nothing else." },
  { icon: <MessagesSquare />, title: "Project chat", body: "Conversations live next to the work, per project, for the team and the client." },
  { icon: <Bell />, title: "Notifications", body: "Know the moment a client comments, approves or asks for changes, in the app and by email." },
  { icon: <PoundSterling />, title: "Invoices and money", body: "See what has been billed, collected and is still outstanding across your clients." },
  { icon: <FileCheck2 />, title: "Deliverables", body: "Approved versions ready to download, with a record of who signed off and when." },
  { icon: <Keyboard />, title: "Search everything", body: "Jump to any project, file or task from a single search, with keyboard shortcuts throughout." },
];

export default function FeaturesPage() {
  return (
    <>
      <section className="mk-page-hero">
        <div className="mk-wrap">
          <p className="mk-eyebrow">Features</p>
          <h1>Built around the cut, the client and the deadline.</h1>
          <p>{siteConfig.name} replaces the email threads, spreadsheets and file-transfer links between your edit suite and your client’s inbox.</p>
        </div>
      </section>

      <section className="mk-section" style={{ paddingTop: 0 }} aria-label="Dashboard">
        <div className="mk-wrap"><Screenshot name="dashboard" eager sizes="(max-width: 1200px) 100vw, 1120px" /></div>
      </section>

      <section className="mk-section" aria-label="Core features">
        <div className="mk-wrap">
          <FeatureBlock
            id="review"
            icon={<MessageSquareText />}
            eyebrow="Review and approvals"
            title="Video and poster review that clients actually use."
            body="Open any cut, still or PDF in the review player. Reviewers click a frame or an area of the image and leave a note or a drawing, and approve or request changes on the exact version they watched."
            points={["Frame-accurate, time-ranged comments", "Drawings held on screen for a frame, 3, 5 or 10 seconds, or a range", "Carry open notes forward from the last version as a checklist", "Review links with optional approve and request-changes buttons"]}
            screen="review"
          />
          <FeatureBlock
            id="ai-qa"
            icon={<ScanText />}
            tone="amber"
            eyebrow="AI Visual QA"
            title="A proofreader for posters, titles and lower thirds."
            body="AI Visual QA reads the text in your artwork and video frames, then checks it for spelling and against the copy the client approved. Every finding is drawn on the image, or tied to a time range on video, so you can see it in context in seconds."
            points={["Spelling checks for UK and US English", "Compare against approved copy: changed words, prices and dates, missing lines", "Accept, dismiss, or add findings as comments and tasks", "Suggestions only: a person confirms every change"]}
            screen="aiqaVideo"
            inset="aiqaPoster"
            flipped
          />
          <FeatureBlock
            id="portal"
            icon={<Sparkles />}
            tone="teal"
            eyebrow="Client portal"
            title="Your studio’s own client portal."
            body="Invite a client team and they get a home for everything with you: cuts waiting on them, approved work to download, invoices, messages, and a form to start a new project."
            points={["Your logo and studio name on top", "Clients send files to you, up to 1 GB each", "Project progress and sign-off records"]}
            screen="portal"
          />
          <FeatureBlock
            id="files"
            icon={<FolderOpen />}
            tone="green"
            eyebrow="Files and big uploads"
            title="A files browser that knows about review."
            body="Every upload is organised by client and project, with thumbnails, durations and review stage. Filter, search, move and open anything straight into review."
            points={["Uploads up to 1 GB per file in a background tray", "Grid and list views, folders and filters", "Stages show where each file is in the approval process"]}
            screen="files"
            flipped
          />
          <FeatureBlock
            id="tasks"
            icon={<ListChecks />}
            eyebrow="Tasks"
            title="Tasks that remember which frame they came from."
            body="Turn a single note, or a batch of them, into tasks with the version attached. Track work on a board with stages you define, filter by assignee, client or due date."
            points={["Board and list views", "Customisable stages", "Due dates, priorities and overdue warnings"]}
            screen="tasks"
          />
        </div>
      </section>

      <section className="mk-section" aria-labelledby="mk-more-title">
        <div className="mk-wrap">
          <SectionHead center eyebrow="And the rest" title={<span id="mk-more-title">The details that save an afternoon a week.</span>} />
          <div className="mk-grid">
            {MORE.map((item) => <div key={item.title} className="mk-card mk-reveal">{item.icon}<h3>{item.title}</h3><p>{item.body}</p></div>)}
            <div className="mk-card mk-reveal"><UploadCloud /><h3>Works in the browser</h3><p>Nothing to install for you or your clients. Open a link and start reviewing.</p></div>
          </div>
        </div>
      </section>

      <FinalCta />
    </>
  );
}
