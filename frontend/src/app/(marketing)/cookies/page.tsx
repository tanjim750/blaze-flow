import { LegalPage } from "@/components/marketing/legal-page";
import { marketingMetadata } from "@/lib/marketing-metadata";
import { siteConfig } from "@/lib/site-config";

export const metadata = marketingMetadata({ title: "Cookie policy", description: `The cookies and similar storage ${siteConfig.name} uses, and why.`, path: "/cookies" });

/** Kept in step with the cookies the app actually sets (Django session/CSRF, two UI cookies). */
const COOKIES = [
  { name: "sessionid", purpose: "Keeps you signed in after you log in.", duration: "Up to 2 weeks", type: "Strictly necessary" },
  { name: "csrftoken", purpose: "Protects forms and actions against cross-site request forgery.", duration: "Up to 1 year", type: "Strictly necessary" },
  { name: "blazeflow_workspace", purpose: "Remembers which workspace you last selected.", duration: "1 year", type: "Strictly necessary (functional)" },
  { name: "blazeflow_rail", purpose: "Remembers whether you collapsed the sidebar.", duration: "1 year", type: "Strictly necessary (functional)" },
];

export default function CookiesPage() {
  const { name, contactEmail } = siteConfig;
  return (
    <LegalPage title="Cookie policy" intro={`What ${name} stores in your browser, and why.`}>
      <h2>Our approach</h2>
      <p>{name} uses only the cookies it needs to work. We do not use advertising or cross-site tracking cookies, and this public website sets no cookies of its own. Because these cookies are strictly necessary, the UK’s Privacy and Electronic Communications Regulations (PECR) do not require consent for them, but we still want you to know what they are.</p>

      <h2>Cookies we set</h2>
      <div className="mk-table-wrap"><table>
        <thead><tr><th>Name</th><th>Purpose</th><th>Duration</th><th>Type</th></tr></thead>
        <tbody>{COOKIES.map((cookie) => <tr key={cookie.name}><td><code>{cookie.name}</code></td><td>{cookie.purpose}</td><td>{cookie.duration}</td><td>{cookie.type}</td></tr>)}</tbody>
      </table></div>

      <h2>Other browser storage</h2>
      <p>Inside the app we use your browser’s local storage for conveniences such as unsent comment drafts, upload progress and player preferences. This stays on your device and is not used to track you.</p>

      <h2>Third parties</h2>
      <p>If you choose “Sign in with Google”, Google may set its own cookies under its own policy. If we add analytics or any non-essential cookies in future, we will ask for your consent first and update this page. (Owner to confirm before adding any analytics.)</p>

      <h2>Managing cookies</h2>
      <p>You can block or delete cookies in your browser settings. If you block the strictly necessary cookies above, you will not be able to sign in.</p>

      <h2>Contact</h2>
      <p>Questions: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.</p>
    </LegalPage>
  );
}
