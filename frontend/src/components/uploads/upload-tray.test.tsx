import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __test, getUploads, startUpload, type Transport, type UploadResult } from "@/lib/upload-store";
import { UploadTray } from "./upload-tray";

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
    expect(screen.getByText(/25% · 1.0 MB of 4.0 MB/)).toBeInTheDocument();
  });
});
