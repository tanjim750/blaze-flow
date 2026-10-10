/** The page name shown in the mobile top bar, from the route. Longest prefix wins. */
const TITLES: [string, string][] = [
  ["/portal/projects", "Project"],
  ["/portal/requests", "Requests"],
  ["/portal/chat", "Chat"],
  ["/portal", "Portal"],
  ["/projects", "Projects"],
  ["/chat", "Chat"],
  ["/messages", "Messages"],
  ["/tasks", "Tasks"],
  ["/files", "Files"],
  ["/clients", "Clients"],
  ["/team", "Team & Roles"],
  ["/money", "Money"],
  ["/render-queue", "Render Queue"],
  ["/deliverables", "Deliverables"],
  ["/notifications", "Notifications"],
  ["/settings", "Settings"],
  ["/help", "Help"],
  ["/review", "Review"],
];

export function mobileTitle(pathname: string): string {
  if (pathname === "/" || pathname === "") return "Home";
  const hit = TITLES.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + "/"));
  return hit ? hit[1] : "Blaze Flow";
}
