import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MarketingHome from "@/app/(marketing)/welcome/page";
import PricingPage from "@/app/(marketing)/pricing/page";
import PrivacyPage from "@/app/(marketing)/privacy/page";
import TermsPage from "@/app/(marketing)/terms/page";
import CookiesPage from "@/app/(marketing)/cookies/page";
import FeaturesPage from "@/app/(marketing)/features/page";
import ContactPage from "@/app/(marketing)/contact/page";
import { siteConfig } from "@/lib/site-config";
import { buildMailto } from "./contact-form";
import { DemoVideo } from "./demo-video";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
afterEach(cleanup);

// jsdom has no IntersectionObserver; motion's whileInView needs one to mount. An inert one
// means nothing ever "enters the viewport", which is fine: the content is in the DOM either way.
class InertObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
globalThis.IntersectionObserver ??= InertObserver as unknown as typeof IntersectionObserver;

function mockMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}

describe("marketing homepage", () => {
  beforeEach(() => {
    mockMotion(true);
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
  });

  it("leads with a headline for video agencies and the brand from siteConfig", () => {
    render(<MarketingHome />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/circle it\..*scribble it\..*ship it\./i);
    expect(screen.getAllByText(new RegExp(siteConfig.name)).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { level: 2, name: "Built for video agencies, studios and freelancers" })).toBeInTheDocument();
  });

  it("sends every call to action to the existing sign-up and log-in pages", () => {
    render(<MarketingHome />);
    const trial = screen.getAllByRole("link", { name: /free trial/i });
    expect(trial.length).toBeGreaterThan(0);
    for (const link of trial) expect(link).toHaveAttribute("href", "/sign-up");
    for (const link of screen.getAllByRole("link", { name: /^log in$/i })) expect(link).toHaveAttribute("href", "/sign-in");
  });

  it("shows the product moments with real screenshots, the demo clip, pricing and FAQ", () => {
    const { container } = render(<MarketingHome />);
    for (const title of [/draw right on the frame/i, /proofreader/i, /home for every client/i, /big files/i, /tasks/i]) {
      expect(screen.getByRole("heading", { level: 3, name: title })).toBeInTheDocument();
    }
    const images = [...container.querySelectorAll("img")];
    expect(images.length).toBeGreaterThanOrEqual(7);
    for (const image of images) expect(decodeURIComponent(image.getAttribute("src") ?? "")).toMatch(/\/marketing\//);
    // Only the hero's front card (the LCP image) loads eagerly; everything below the fold is lazy.
    const eager = images.filter((image) => image.getAttribute("loading") !== "lazy");
    expect(eager.map((image) => image.getAttribute("alt"))).toEqual([expect.stringMatching(/^Review page/)]);
    expect(container.querySelector("video")).toHaveAttribute("poster", "/marketing/demo-poster.webp");
    expect(screen.getAllByText("£29").length).toBeGreaterThan(0);
    expect(screen.getByText("Do my clients need an account to review?")).toBeInTheDocument();
  });
});

describe("DemoVideo", () => {
  let play: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: vi.fn() });
    // No IntersectionObserver in jsdom, so the component starts straight away.
    vi.stubGlobal("IntersectionObserver", undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is muted, looping, inline and has no autoplay attribute (playback starts after the motion check)", () => {
    mockMotion(false);
    const { container } = render(<DemoVideo label="Product tour" />);
    const video = container.querySelector("video")!;
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute("loop");
    expect(video).toHaveAttribute("playsinline");
    expect(video).not.toHaveAttribute("autoplay");
    expect(video).toHaveAttribute("poster", "/marketing/demo-poster.webp");
    expect(play).toHaveBeenCalled();
  });

  it("stays paused on the poster for prefers-reduced-motion, with a Play control", () => {
    mockMotion(true);
    render(<DemoVideo label="Product tour" />);
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Play product demo" })).toBeInTheDocument();
  });

  it("lets the visitor play on demand", async () => {
    mockMotion(true);
    render(<DemoVideo label="Product tour" />);
    await act(async () => screen.getByRole("button", { name: "Play product demo" }).click());
    expect(play).toHaveBeenCalledTimes(1);
  });
});

describe("pricing", () => {
  it("shows Pro at £29 a month with a 14-day trial and labels any other card as a placeholder", () => {
    const { container } = render(<PricingPage />);
    expect(screen.getByRole("heading", { level: 2, name: /^Pro/ })).toBeInTheDocument();
    expect(screen.getAllByText("£29").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/14-day free trial/).length).toBeGreaterThan(0);
    for (const card of container.querySelectorAll(".mk-price:not(.is-featured)")) {
      expect(within(card as HTMLElement).getByText(/placeholder/i)).toBeInTheDocument();
    }
  });
});

describe("legal pages", () => {
  it.each([["privacy", PrivacyPage], ["terms", TermsPage], ["cookies", CookiesPage]])("%s opens with the draft / not-legal-advice banner", (_name, Page) => {
    render(<Page />);
    const banner = screen.getByTestId("legal-draft-banner");
    expect(banner).toHaveTextContent(/draft for review/i);
    expect(banner).toHaveTextContent(/not legal advice/i);
    expect(screen.getAllByRole("link", { name: siteConfig.contactEmail }).length).toBeGreaterThan(0);
  });

  it("privacy mentions UK GDPR and the ICO", () => {
    render(<PrivacyPage />);
    expect(screen.getAllByText(/UK GDPR/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "ico.org.uk" })).toBeInTheDocument();
  });
});

describe("features and contact", () => {
  it("renders the features page", () => {
    render(<FeaturesPage />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /proofreader/i })).toBeInTheDocument();
  });

  it("contact shows the address and composes a mailto without sending anything", () => {
    render(<ContactPage />);
    expect(screen.getAllByRole("link", { name: siteConfig.contactEmail }).length).toBeGreaterThan(0);
    const href = buildMailto({ name: "Ada", email: "ada@studio.example", company: "", topic: "Demo request", message: "Hi there" });
    expect(href.startsWith(`mailto:${siteConfig.contactEmail}?subject=`)).toBe(true);
    expect(decodeURIComponent(href)).toContain("Demo request");
    expect(decodeURIComponent(href)).toContain("Email: ada@studio.example");
    expect(decodeURIComponent(href)).not.toContain("Company:");
  });
});
