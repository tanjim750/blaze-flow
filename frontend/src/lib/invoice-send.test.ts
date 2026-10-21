import { describe, expect, it } from "vitest";
import { sentMessage } from "./invoice-send";

describe("sentMessage", () => {
  it("names who got the invoice", () => {
    expect(sentMessage("INV-1", [])).toBe("INV-1 marked as sent");
    expect(sentMessage("INV-1", ["a@x.com"])).toBe("INV-1 sent to a@x.com");
    expect(sentMessage("INV-1", ["a@x.com", "b@x.com", "c@x.com"])).toBe("INV-1 sent to a@x.com and 2 more");
  });
});
