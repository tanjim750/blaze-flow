import { describe, expect, it } from "vitest";
import { choosePartSize, MIN_PART_SIZE, partRanges, sendParts, type SendPart } from "./upload-parts";

describe("upload parts", () => {
  it("splits into ranges and keeps part count under the S3 limit", () => {
    expect(partRanges(25, 10)).toEqual([{ partNumber: 1, start: 0, end: 10 }, { partNumber: 2, start: 10, end: 20 }, { partNumber: 3, start: 20, end: 25 }]);
    expect(choosePartSize(1)).toBeGreaterThanOrEqual(MIN_PART_SIZE);
    expect(Math.ceil(200 * 1024 ** 3 / choosePartSize(200 * 1024 ** 3))).toBeLessThanOrEqual(10_000);
  });

  it("respects the parallel limit, aggregates progress and skips finished parts", async () => {
    let running = 0, peak = 0;
    const sent: number[] = [];
    const progress: number[] = [];
    const sendPart: SendPart = async (part, onLoaded) => {
      running += 1; peak = Math.max(peak, running); sent.push(part.partNumber);
      await new Promise((resolve) => setTimeout(resolve, 1));
      onLoaded((part.end - part.start) / 2);
      running -= 1;
      return `etag-${part.partNumber}`;
    };
    const parts = await sendParts({
      size: 100, partSize: 10, concurrency: 3, completed: [{ partNumber: 1, etag: "etag-1" }],
      sendPart, onProgress: (loaded) => progress.push(loaded), onPartDone: () => {}, signal: new AbortController().signal,
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(sent).not.toContain(1);
    expect(parts).toHaveLength(10);
    expect(progress[0]).toBe(10);
    expect(progress.at(-1)).toBe(100);
  });

  it("rejects when a part fails", async () => {
    await expect(sendParts({
      size: 30, partSize: 10, sendPart: async (part) => { if (part.partNumber === 2) throw new Error("part 2 failed"); return "e"; },
      onProgress: () => {}, onPartDone: () => {}, signal: new AbortController().signal,
    })).rejects.toThrow("part 2 failed");
  });
});
