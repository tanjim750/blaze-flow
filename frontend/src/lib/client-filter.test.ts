import { describe, expect, it } from "vitest";
import { filterClientTree } from "./client-filter";

const clients = [
  { name: "Atlas Fitness", campaigns: [{ name: "Q4 Social Reels" }] },
  { name: "Northlight Coffee", campaigns: [{ name: "Spring Launch Campaign" }, { name: "Holiday Teaser" }] },
];

describe("filterClientTree", () => {
  it("keeps everything for an empty query", () => {
    expect(filterClientTree(clients, "  ")).toHaveLength(2);
  });

  it("matches a client name and keeps all its campaigns", () => {
    const [row, ...rest] = filterClientTree(clients, "atlas");
    expect(rest).toEqual([]);
    expect(row.client.name).toBe("Atlas Fitness");
    expect(row.matchedCampaign).toBe(false);
  });

  it("matches a campaign name and shows only matching campaigns", () => {
    const [row] = filterClientTree(clients, "holiday");
    expect(row.client.name).toBe("Northlight Coffee");
    expect(row.campaigns.map((campaign) => campaign.name)).toEqual(["Holiday Teaser"]);
    expect(row.matchedCampaign).toBe(true);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterClientTree(clients, "zzzz")).toEqual([]);
  });
});
