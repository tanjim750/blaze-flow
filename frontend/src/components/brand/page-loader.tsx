import { KrewsysLoader } from "./krewsys-logo";

/** Branded route-loading state. Stays invisible for 300ms (CSS), so fast navigations only show the top progress bar. */
export function PageLoader({ fullscreen = false, label = "Loading" }: { fullscreen?: boolean; label?: string }) {
  return (
    <div className={`ks-page-loader${fullscreen ? " is-fullscreen" : ""}`} data-testid="page-loader">
      <KrewsysLoader size={56} label={label} />
    </div>
  );
}
