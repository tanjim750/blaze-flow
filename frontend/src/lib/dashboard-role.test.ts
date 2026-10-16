import { describe, expect, it } from "vitest";
import { chooseLayout, previewNotice, roleFor, viewAsHref } from "./dashboard-role";

const ws = (dashboard_role: unknown, my_membership_id: string | null = "m1") =>
  ({ dashboard_role, my_membership_id }) as Parameters<typeof chooseLayout>[0];

describe("dashboard role", () => {
  it("uses the role the API derived", () => {
    expect(roleFor(ws("owner"))).toBe("owner");
    expect(roleFor(ws("editor"))).toBe("editor");
    expect(roleFor(ws("client", null))).toBe("client");
  });

  it("falls back safely on an older backend: no own membership means client, otherwise editor, never owner", () => {
    expect(roleFor(ws(undefined))).toBe("editor");
    expect(roleFor(ws(null, null))).toBe("client");
    expect(roleFor(ws("superuser"))).toBe("editor");
  });
});

describe("layout selection", () => {
  it("renders each role's own layout by default", () => {
    expect(chooseLayout(ws("owner"), undefined)).toEqual({ role: "owner", layout: "owner", previewing: false, canSwitch: true });
    expect(chooseLayout(ws("editor"), undefined)).toEqual({ role: "editor", layout: "editor", previewing: false, canSwitch: false });
    expect(chooseLayout(ws("client", null), undefined)).toEqual({ role: "client", layout: "client", previewing: false, canSwitch: false });
  });

  it("lets an owner preview the editor and client layouts", () => {
    expect(chooseLayout(ws("owner"), "editor")).toMatchObject({ layout: "editor", previewing: true, canSwitch: true });
    expect(chooseLayout(ws("owner"), "client")).toMatchObject({ layout: "client", previewing: true });
    expect(chooseLayout(ws("owner"), ["client", "editor"])).toMatchObject({ layout: "client" });
    expect(chooseLayout(ws("owner"), "owner")).toMatchObject({ layout: "owner", previewing: false });
  });

  it("ignores ?view= from anyone who is not an owner", () => {
    expect(chooseLayout(ws("editor"), "owner")).toMatchObject({ layout: "editor", previewing: false, canSwitch: false });
    expect(chooseLayout(ws("client", null), "owner")).toMatchObject({ layout: "client", previewing: false });
    expect(chooseLayout(ws("client", null), "editor")).toMatchObject({ layout: "client" });
  });

  it("ignores a view it does not know", () => {
    expect(chooseLayout(ws("owner"), "admin")).toMatchObject({ layout: "owner", previewing: false });
  });

  it("links each layout and labels previews", () => {
    expect(viewAsHref("owner")).toBe("/");
    expect(viewAsHref("editor")).toBe("/?view=editor");
    expect(viewAsHref("client")).toBe("/?view=client");
    expect(previewNotice("owner")).toBeNull();
    expect(previewNotice("editor")).toMatch(/your own/);
    expect(previewNotice("client")).toMatch(/never tasks or team notes/);
  });
});
