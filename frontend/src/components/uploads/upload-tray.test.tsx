import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __test, getUploads, startUpload, type Transport, type UploadResult } from "@/lib/upload-store";
import { UploadTray, summaryLine } from "./upload-tray";

let resolvers: ((result: UploadResult) => void)[] = [];
const transport: Transport = (_request, _progress, signal) => new Promise((resolve) => { resolvers.push(resolve); signal.addEventListener("abort", () => resolve({ ok: false, status: 0, error: "Cancelled." })); });

beforeEach(() => { __test.reset(); resolvers = []; __test.setTransport(transport); });
afterEach(() => cleanup());

describe("UploadTray", () => {
  it("is hidden with nothing to show, then lists uploads with a count badge", () => {
    const { container } = render(<UploadTray />);
    expect(container.firstChild).toBeNull();
    act(() => { startUpload({ url: "/u", file: new File(["abc"], "hero.mp4"), source: "files", destination: "Spring · Files" }); });
    expect(screen.getByText("hero.mp4")).toBeInTheDocument();
    expect(screen.getByTestId("upload-tray-count")).toHaveTextContent("1");
    expect(screen.getByText("Uploading 1 file")).toBeInTheDocument();
  });

  it("warns before closing the tab only while something is uploading", async () => {
    render(<UploadTray />);
    act(() => { startUpload({ url: "/u", file: new File(["abc"], "a.mp4"), source: "files" }); });
    const busy = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(busy);
    expect(busy.defaultPrevented).toBe(true);
    await act(async () => { resolvers[0]({ ok: true, data: {} }); });
    const idle = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);
  });

  it("cancels, retries, minimises and clears finished", async () => {
    render(<UploadTray />);
    act(() => { startUpload({ url: "/u", file: new File(["abc"], "a.mp4"), source: "files" }); });
    await act(async () => { resolvers[0]({ ok: false, status: 500, error: "The upload failed (500)." }); });
    expect(screen.getByText("The upload failed (500).")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(getUploads()[0].status).toBe("uploading");
    fireEvent.click(screen.getByRole("button", { name: "Cancel a.mp4" }));
    await act(async () => {});
    expect(getUploads()[0].status).toBe("cancelled");
    fireEvent.click(screen.getByRole("button", { name: /Minimise uploads/ }));
    expect(screen.queryByText("a.mp4")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show uploads/ }));
    fireEvent.click(screen.getByRole("button", { name: /Clear finished/ }));
    expect(getUploads()).toHaveLength(0);
  });
});

describe("UploadTray summary", () => {
  it("shows transferred / remaining MB for the whole tray while sending", () => {
    let report: ((loaded: number, total: number) => void) | null = null;
    __test.setTransport((_request, progress) => { report = progress; return new Promise(() => {}); });
    render(<UploadTray />);
    act(() => { startUpload({ url: "/u", file: new File([new Uint8Array(4 * 1024 * 1024)], "cut.mp4"), source: "files" }); });
    act(() => { report!(1024 * 1024, 4 * 1024 * 1024); });
    expect(screen.getByTestId("upload-tray-summary")).toHaveTextContent("1.0 MB of 4.0 MB · 3.0 MB remaining");
    const stats = screen.getByTestId("upload-row").querySelectorAll(".ut-stat");
    expect([...stats].map((stat) => stat.textContent).slice(0, 2)).toEqual(["25%", "1.0 MB of 4.0 MB"]);
  });
});

describe("UploadTray layout and wording", () => {
  it("words queued items plainly with their place in the queue", async () => {
    const { queuedLine } = await import("./upload-tray");
    expect(queuedLine({ loaded: 0 })).toBe("Waiting to upload");
    expect(queuedLine({ loaded: 145.8 * 1024 * 1024 }, 2)).toBe("Waiting to upload · 145.8 MB already sent · 2 ahead");
  });

  it("splits upload stats into pieces so narrow trays can drop the parts count", async () => {
    const { statusStats } = await import("./upload-tray");
    const stats = statusStats({ ...getUploadsSample(), status: "uploading", loaded: 50, size: 100, parts: { done: 3, total: 8 }, speed: 0 });
    expect(stats.map((stat) => stat.kind)).toEqual([undefined, "size", "parts"]);
    expect(stats[2].text).toBe("3/8 parts");
  });

  it("shows queue positions and keeps long errors whole with Retry and Remove", async () => {
    __test.setTransport(() => new Promise(() => {}));
    render(<UploadTray />);
    act(() => { for (let i = 0; i < 5; i += 1) startUpload({ url: "/u", file: new File(["a"], `f${i}.mp4`), source: "files" }); });
    const rows = screen.getAllByTestId("upload-row");
    expect(rows[3]).toHaveTextContent("Waiting to upload");
    expect(rows[4]).toHaveTextContent("Waiting to upload · 1 ahead");
    cleanup(); __test.reset();
    const long = "This file is larger than the 20 GB limit for your plan. Upgrade or split the archive into smaller parts.";
    __test.setTransport(() => Promise.resolve({ ok: false, status: 502, error: long }));
    render(<UploadTray />);
    await act(async () => { startUpload({ url: "/u", file: new File(["a"], "x.zip"), source: "files" }); });
    const error = screen.getByText(long);
    expect(error).toHaveClass("ut-error");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove x.zip from the list" })).toBeInTheDocument();
  });
});

function getUploadsSample() {
  return { id: "s", name: "s.mp4", size: 100, source: "files" as const, destination: null, status: "queued" as const, loaded: 0, speed: 0, startedAt: null, finishedAt: null, error: null, processing: null, href: null, attempts: 0, transport: null, parts: null };
}

describe("UploadTray after a reload", () => {
  it("warns before closing the tab while uploads are only queued", () => {
    render(<UploadTray />);
    act(() => { for (const name of ["a", "b", "c", "d"]) startUpload({ url: "/u", file: new File(["abc"], `${name}.mp4`), source: "files" }); });
    expect(getUploads()[3].status).toBe("queued");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("shows uploads left by the last page as paused with a Resume that takes the same file", () => {
    act(() => { startUpload({ url: "/u", file: new File(["abc"], "hero.mov", { lastModified: 42 }), source: "files", destination: "Spring · Files" }); });
    __test.reload();
    render(<UploadTray />);
    expect(screen.getByText("Paused · pick file to resume")).toBeInTheDocument();
    expect(screen.getByText("1 upload paused")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    const input = screen.getByTestId("upload-resume-input") as HTMLInputElement;
    act(() => { fireEvent.change(input, { target: { files: [new File(["abcd"], "hero.mov", { lastModified: 42 })] } }); });
    expect(screen.getByRole("alert")).toHaveTextContent("not the same file");
    expect(getUploads()[0].status).toBe("paused");
    act(() => { fireEvent.change(input, { target: { files: [new File(["abc"], "hero.mov", { lastModified: 42 })] } }); });
    expect(getUploads()[0].status).toBe("uploading");
  });

  it("resumes a paused upload from a dropped file", async () => {
    act(() => { startUpload({ url: "/u", file: new File(["abc"], "drop.mov", { lastModified: 7 }), source: "files" }); });
    __test.reload();
    render(<UploadTray />);
    const dropped = new File(["abc"], "drop.mov", { lastModified: 7 });
    await act(async () => { fireEvent.drop(screen.getByTestId("upload-tray"), { dataTransfer: { files: [dropped], items: [] } }); });
    expect(getUploads()[0].status).toBe("uploading");
  });
});


it("asks inline before Cancel all and never starts queued files while cancelling", async () => {
  render(<UploadTray />);
  act(() => { for (let i = 0; i < 7; i++) startUpload({ url: "/u", file: new File(["x"], `file-${i}.mov`), source: "files" }); });
  fireEvent.click(screen.getByRole("button", { name: "Cancel all" }));
  expect(screen.getByTestId("upload-cancel-confirm")).toHaveTextContent("Saved upload parts will be deleted");
  expect(getUploads().filter((item) => item.status === "uploading")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Keep uploading" }));
  expect(screen.queryByTestId("upload-cancel-confirm")).toBeNull();
  expect(getUploads().filter((item) => item.status === "uploading")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Cancel all" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yes, cancel all" })); });
  expect(getUploads().every((item) => item.status === "cancelled")).toBe(true);
  expect(resolvers).toHaveLength(3);
});

it("keeps Cancel all on one line next to the helper text", () => {
  render(<UploadTray />);
  act(() => { startUpload({ url: "/u", file: new File(["x"], "a.mov"), source: "files" }); });
  const button = screen.getByRole("button", { name: "Cancel all" });
  expect(button).toHaveClass("ut-cancel-all");
  expect(button.closest(".ut-transfer-actions")).not.toBeNull();
});

describe("summaryLine", () => {
  const item = (over: object) => ({ status: "uploading", resumed: false, ...over }) as never;
  it("says Starting… only before any bytes are sent", () => {
    expect(summaryLine([item({})], { speed: 0, eta: null, loaded: 0 })).toBe("Starting…");
  });
  it("says Resuming… for a resumed upload with bytes already done", () => {
    expect(summaryLine([item({ resumed: true })], { speed: 0, eta: null, loaded: 72 })).toBe("Resuming…");
  });
  it("never says Starting… once bytes are done", () => {
    expect(summaryLine([item({})], { speed: 0, eta: null, loaded: 72 })).not.toMatch(/Starting/);
  });
  it("shows speed and time left once measured", () => {
    expect(summaryLine([item({})], { speed: 1024 * 1024, eta: 60, loaded: 72 })).toMatch(/·/);
  });
});
