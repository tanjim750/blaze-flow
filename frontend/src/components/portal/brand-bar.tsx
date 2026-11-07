import type { ReactNode } from "react";
import type { Branding } from "@/lib/portal";
import { accentStyle } from "@/lib/portal";
import { StudioMark } from "./studio-mark";

/** The top of every client-facing portal screen: the studio's mark, name and welcome line. */
export function PortalBrandBar({ branding, eyebrow = "Client portal", children }: { branding: Branding; eyebrow?: string; children?: ReactNode }) {
  return <header className="pt-brand" style={accentStyle(branding.brand_color)}>
    <StudioMark branding={branding} size={42} />
    <div className="pt-brand-copy">
      <small>{eyebrow}</small>
      <strong>{branding.studio_name}</strong>
      {branding.portal_welcome && <p>{branding.portal_welcome}</p>}
    </div>
    {children && <div className="pt-brand-actions">{children}</div>}
  </header>;
}
