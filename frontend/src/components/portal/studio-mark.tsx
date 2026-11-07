import type { Branding } from "@/lib/portal";
import { studioMonogram } from "@/lib/portal";

/**
 * The studio's logo, or a monogram tile in the studio's colour when there is none. Plain
 * `<img>`: the logo is a small public image from our own API, so there is nothing for
 * next/image to optimise and no remote host to configure.
 */
export function StudioMark({ branding, size = 40 }: { branding: Pick<Branding, "studio_name" | "logo_url">; size?: number }) {
  if (branding.logo_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="pt-mark is-logo" src={branding.logo_url} alt={`${branding.studio_name} logo`} style={{ height: size }} />;
  }
  return <span className="pt-mark" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>{studioMonogram(branding.studio_name)}</span>;
}
