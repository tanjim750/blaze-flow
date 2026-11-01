/**
 * Helpers for multipart transports (e.g. direct-to-R2): split a file into parts, send them with
 * a parallel limit, aggregate per-part progress into one byte count for the file, and remember
 * finished parts so a retry resumes instead of starting over.
 */

export const MIN_PART_SIZE = 5 * 1024 * 1024; // S3/R2 minimum for every part but the last
export const DEFAULT_PART_SIZE = 16 * 1024 * 1024;
export const DEFAULT_PART_CONCURRENCY = 4;
export const MAX_PARTS = 10_000;

export type CompletedPart = { partNumber: number; etag: string };
export type PartResume = { uploadId: string; key: string; partSize: number; completed: CompletedPart[] };

/** Part size that keeps the count under MAX_PARTS. */
export function choosePartSize(size: number, preferred = DEFAULT_PART_SIZE) {
  let partSize = Math.max(MIN_PART_SIZE, preferred);
  while (Math.ceil(size / partSize) > MAX_PARTS) partSize *= 2;
  return partSize;
}

export function partRanges(size: number, partSize: number) {
  const ranges: { partNumber: number; start: number; end: number }[] = [];
  for (let start = 0, partNumber = 1; start < size || (size === 0 && partNumber === 1); start += partSize, partNumber += 1) {
    ranges.push({ partNumber, start, end: Math.min(size, start + partSize) });
    if (size === 0) break;
  }
  return ranges;
}

export type SendPart = (part: { partNumber: number; start: number; end: number }, onLoaded: (loaded: number) => void, signal: AbortSignal) => Promise<string>;

/**
 * Sends every part not already in `completed`, at most `concurrency` at once. Reports aggregate
 * bytes via `onProgress` and each finished part via `onPartDone` (persist it for resume).
 * Rejects on the first failed part (the others are aborted).
 */
export async function sendParts(options: {
  size: number; partSize: number; concurrency?: number; completed?: CompletedPart[];
  sendPart: SendPart; onProgress: (loaded: number) => void; onPartDone: (part: CompletedPart, done: number, total: number) => void;
  signal: AbortSignal;
}): Promise<CompletedPart[]> {
  const ranges = partRanges(options.size, options.partSize);
  const done = new Map((options.completed ?? []).map((part) => [part.partNumber, part]));
  const inFlight = new Map<number, number>();
  const finishedBytes = () => ranges.filter((range) => done.has(range.partNumber)).reduce((sum, range) => sum + (range.end - range.start), 0);
  const report = () => options.onProgress(finishedBytes() + [...inFlight.values()].reduce((sum, value) => sum + value, 0));
  const queue = ranges.filter((range) => !done.has(range.partNumber));
  const local = new AbortController();
  const abort = () => local.abort();
  options.signal.addEventListener("abort", abort);
  report();
  try {
    const worker = async () => {
      for (;;) {
        const range = queue.shift();
        if (!range || local.signal.aborted) return;
        inFlight.set(range.partNumber, 0);
        const etag = await options.sendPart(range, (loaded) => { inFlight.set(range.partNumber, Math.min(loaded, range.end - range.start)); report(); }, local.signal);
        inFlight.delete(range.partNumber);
        const part = { partNumber: range.partNumber, etag };
        done.set(range.partNumber, part);
        options.onPartDone(part, done.size, ranges.length);
        report();
      }
    };
    const workers = Array.from({ length: Math.max(1, Math.min(options.concurrency ?? DEFAULT_PART_CONCURRENCY, queue.length || 1)) }, worker);
    await Promise.all(workers.map((run) => run.catch((error) => { local.abort(); throw error; })));
  } finally {
    options.signal.removeEventListener("abort", abort);
  }
  if (options.signal.aborted) throw new DOMException("Cancelled.", "AbortError");
  return [...done.values()].sort((a, b) => a.partNumber - b.partNumber);
}
