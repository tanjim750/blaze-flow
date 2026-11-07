import { beforeEach, describe, expect, it } from "vitest";
import { clearGuestSession, guestEmailProblem, readGuestSession, REMEMBER_DAYS, writeGuestSession } from "./guest-client";

const session = { token: "tok", projectId: "p", guestSessionId: "g", accessKey: "k", name: "QA Client" };

describe("guest join (R12)", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  it("rejects an email without a domain inline", () => {
    expect(guestEmailProblem("bad-email")).toMatch(/full email/);
    expect(guestEmailProblem("a@b")).toMatch(/full email/);
    expect(guestEmailProblem(" qa@studio.com ")).toBeNull();
  });
  it("remembers the guest on revisit until it expires, and forgets on request", () => {
    writeGuestSession(session, { now: 0 });
    expect(readGuestSession("tok", 1000)).toEqual(session);
    expect(readGuestSession("tok", REMEMBER_DAYS * 86_400_000 + 1)).toBeNull();
    writeGuestSession(session);
    clearGuestSession("tok");
    expect(readGuestSession("tok")).toBeNull();
  });
  it("keeps the key to the tab when 'remember me' is off", () => {
    writeGuestSession(session, { remember: false });
    expect(localStorage.length).toBe(0);
    expect(readGuestSession("tok")).toEqual(session);
  });
});
