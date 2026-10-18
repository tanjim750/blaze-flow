import Link from "next/link";
import { CheckCircle2, Clapperboard, Film, FolderOpen, ListChecks, MessageSquareText, ScanText, Sparkles, Users, Video, Wand2 } from "lucide-react";
import { DemoVideo } from "@/components/marketing/demo-video";
import { Faq, FeatureBlock, FinalCta, PrimaryCtas, ProPriceCard, SectionHead, type FaqItem } from "@/components/marketing/sections";
import { marketingMetadata } from "@/lib/marketing-metadata";
import { siteConfig } from "@/lib/site-config";

/**
 * The public homepage. Signed-out visitors reach it at `/` through the rewrite in
 * `src/proxy.ts`; signed-in people keep getting their dashboard at `/`.
 */
export const metadata = marketingMetadata({ path: "/" });

const BUILT_FOR = [
  { icon: <Clapperboard />, label: "Video production agencies" },
  { icon: <Film />, label: "Post-production studios" },
  { icon: <Wand2 />, label: "Motion and animation teams" },
  { icon: <Video />, label: "Social content studios" },
  { icon: <Users />, label: "Freelance editors" },
];

const name = siteConfig.name;
const { symbol, proMonthly, trialDays } = siteConfig.pricing;

const FAQ: FaqItem[] = [
  { q: "Do my clients need an account to review?", a: `No. Send a review link and they can watch, comment on exact frames and approve or request changes from the browser. If you want them to have a home for every project, invite them to your branded client portal instead.` },
  { q: "What does AI Visual QA actually check?", a: `It reads the text in your posters, stills and video frames and flags likely typos. Paste or pick the client's approved copy and it also flags words, prices and dates that differ from it, or lines that are missing. Each finding is outlined on the image or frame (with a time range on video), and nothing changes until a person accepts it or turns it into a comment.` },
  { q: "How big can uploads be?", a: `Files up to 1 GB each. Uploads run in a background tray, so you can keep working while a master renders its way up.` },
  { q: "How much does it cost?", a: `${name} Pro is ${symbol}${proMonthly} a month, billed in GBP, with a ${trialDays}-day free trial so you can run a real project through it first.` },
  { q: "Can I keep internal notes away from the client?", a: `Yes. Every comment is either client-visible or team-only, and you can preview the review exactly as the client will see it before you share.` },
  { q: "Where is my data stored?", a: <>See our <Link href="/privacy">privacy notice</Link> for how we handle personal data, or <Link href="/contact">get in touch</Link> with specific questions.</> },
];

export default function MarketingHome() {
  return (
    <>
      <section className="mk-hero" aria-labelledby="mk-hero-title">
        <div className="mk-wrap">
          <div className="mk-hero-copy">
            <span className="mk-pill"><b>New</b> AI Visual QA catches typos before your client does</span>
            <h1 id="mk-hero-title">Client feedback on every frame. <em>Approvals without the chase.</em></h1>
            <p className="mk-hero-lede">
              {name} is the review and delivery workspace for video agencies. Share a cut, collect
              frame-accurate notes and drawings, proofread on-screen text with AI, and get approvals
              your whole team can see.
            </p>
            <PrimaryCtas />
            <p className="mk-fineprint">{trialDays}-day free trial · then {symbol}{proMonthly} a month</p>
          </div>
          <div className="mk-hero-media">
            <div className="mk-frame">
              <div className="mk-frame-inner">
                <div className="mk-frame-bar" aria-hidden="true"><i /><i /><i /><span>{siteConfig.domain}</span></div>
                <DemoVideo label={`${name} product tour: dashboard, files, a video review with drawings, AI Visual QA on a poster and a video, and the tasks board`} />
              </div>
            </div>
            <div className="mk-hero-callouts" aria-hidden="true">
              <div className="mk-callout is-left"><MessageSquareText /><div>Note at 00:02<small>“Hold on the cup a touch longer”</small></div></div>
              <div className="mk-callout is-right"><CheckCircle2 /><div>Approved by client<small>V4 · signed off</small></div></div>
            </div>
          </div>
        </div>
      </section>

      <section className="mk-strip" aria-label="Who it is for">
        <div className="mk-wrap">
          <p>Built for video agencies, studios and freelancers</p>
          <ul>{BUILT_FOR.map((item) => <li key={item.label}>{item.icon}{item.label}</li>)}</ul>
        </div>
      </section>

      <section className="mk-section" aria-labelledby="mk-features-title">
        <div className="mk-wrap">
          <SectionHead
            eyebrow="One workspace, first cut to final file"
            title={<span id="mk-features-title">Everything between “here’s V1” and “approved”.</span>}
            lede="No more timestamps typed into emails, screenshots of screenshots or final_FINAL_v7.mp4."
          />
          <FeatureBlock
            id="review"
            icon={<MessageSquareText />}
            eyebrow="Review and approvals"
            title="Feedback pinned to the exact frame."
            body="Reviewers click the moment that matters and leave a note or a drawing; your team can add voice notes and screen recordings too. Every note shows on the timeline, on the frame and in one list you can work through."
            points={["Drawings that stay on screen for a frame, a few seconds or a range", "Versions with side-by-side compare", "Approve or request changes on the exact version"]}
            screen="review"
            link={{ href: "/features#review", label: "More on review" }}
          />
          <FeatureBlock
            id="ai-qa"
            icon={<ScanText />}
            tone="amber"
            eyebrow="AI Visual QA"
            title="Catch the typo before the client does."
            body="Run a check on a poster or a cut and it reads every line of on-screen text. Compare it with the approved copy and it flags spelling slips, changed prices and missing lines, highlighted right on the image or frame."
            points={["Findings outlined on the artwork, with time ranges on video", "Compare against pasted or saved approved copy", "Suggestions only: turn a finding into a comment or task in one click"]}
            screen="aiqaPoster"
            inset="aiqaVideo"
            flipped
            link={{ href: "/features#ai-qa", label: "How AI Visual QA works" }}
          />
          <FeatureBlock
            id="portal"
            icon={<Sparkles />}
            tone="teal"
            eyebrow="Client portal"
            title="A front door for every client, in your brand."
            body="Clients get one place for cuts waiting on them, approved deliverables to download, messages and new project requests, with your studio’s logo on top."
            points={["Cuts to review and approvals in one list", "Deliverables with a sign-off record", "Clients can send you files and project requests"]}
            screen="portal"
          />
          <FeatureBlock
            id="files"
            icon={<FolderOpen />}
            tone="green"
            eyebrow="Files and big uploads"
            title="Every asset, by client and project."
            body="Browse footage, stills and documents by client, filter by stage and type, and open anything straight into review. Large masters upload in the background while you keep working."
            points={["Uploads up to 1 GB per file", "Thumbnails, durations and review stages at a glance", "Keyboard shortcuts for the people who live in it"]}
            screen="files"
            flipped
          />
          <FeatureBlock
            id="tasks"
            icon={<ListChecks />}
            eyebrow="Tasks and dashboard"
            title="Turn notes into work, and work into delivery."
            body="Turn any review note into a task with the frame attached. Move work across stages your team defines, and see what is overdue and waiting on clients from the dashboard."
            points={["Board and list views with custom stages", "Notes become tasks with one click", "A dashboard per role: owner, editor and client"]}
            screen="tasks"
          />
        </div>
      </section>

      <section className="mk-section" aria-labelledby="mk-how-title">
        <div className="mk-wrap">
          <SectionHead center eyebrow="How it works" title={<span id="mk-how-title">Three steps from upload to sign-off.</span>} />
          <ol className="mk-steps">
            <li className="mk-reveal"><h3>Upload the cut</h3><p>Drop in a video, poster or PDF. {name} makes a review copy and keeps every version together.</p></li>
            <li className="mk-reveal"><h3>Share and collect notes</h3><p>Send a review link or invite the client to their portal. Notes land on the exact frame, ready to resolve or turn into tasks.</p></li>
            <li className="mk-reveal"><h3>Approve and deliver</h3><p>The client approves the exact version. Deliverables are ready to download, with a record of who signed off and when.</p></li>
          </ol>
        </div>
      </section>

      <section className="mk-section" aria-labelledby="mk-pricing-title">
        <div className="mk-wrap">
          <SectionHead center eyebrow="Pricing" title={<span id="mk-pricing-title">One plan. Every feature.</span>} lede={`Try ${name} Pro free for ${trialDays} days. No sales call needed.`} />
          <div className="mk-prices is-single mk-reveal"><ProPriceCard /></div>
          <p className="mk-fineprint" style={{ textAlign: "center", marginTop: 20 }}><Link className="mk-link" href="/pricing">Full pricing details</Link></p>
        </div>
      </section>

      <section className="mk-section" aria-labelledby="mk-faq-title">
        <div className="mk-wrap">
          <SectionHead center eyebrow="FAQ" title={<span id="mk-faq-title">Questions agencies ask us.</span>} />
          <Faq items={FAQ} />
        </div>
      </section>

      <FinalCta />
    </>
  );
}
