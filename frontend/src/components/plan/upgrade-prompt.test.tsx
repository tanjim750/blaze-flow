import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ProPlans, ProSolo } from "@/components/pro/pro-home";
import { UpgradePrompt } from "./upgrade-prompt";

beforeAll(() => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
});
afterEach(cleanup);

describe("UpgradePrompt", () => {
  it("links to the plan page for the locked feature", () => {
    render(<UpgradePrompt feature="ai_qa" />);
    const link = screen.getByRole("link", { name: /Upgrade to Starter/ });
    expect(link.getAttribute("href")).toBe("/settings/plan?upgrade=ai_qa");
  });
});

describe("pricing Solo", () => {
  it("Starter card links to the Solo section; no fourth card", () => {
    const { container } = render(<ProPlans />);
    expect(screen.getByRole("link", { name: /Solo from \$5\.99\/mo/ }).getAttribute("href")).toBe("/pricing#solo");
    expect(container.textContent).toContain("Working alone?");
  });
  it("Solo section lists what is included and what needs Starter", () => {
    const { container } = render(<ProSolo />);
    expect(container.querySelector("#solo")).not.toBeNull();
    expect(container.textContent).toContain("Client review");
    expect(container.textContent).toContain("AI QA on posters and video");
  });
});
