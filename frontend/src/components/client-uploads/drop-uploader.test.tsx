import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendFile = vi.fn();
vi.mock("@/lib/client-uploads", async (original) => ({ ...(await original<typeof import("@/lib/client-uploads")>()), sendFile: (...args: unknown[]) => sendFile(...args) }));

import { DropUploader, queueSummary } from "./drop-uploader";

afterEach(cleanup);
beforeEach(() => { sendFile.mockReset(); });

const MB = 1024 * 1024;
const file = (name: string, type: string, size: number) => {
  const value = new File(["x"], name, { type });
  Object.defineProperty(value, "size", { value: size });
  return value;
};
const drop = (files: File[]) => fireEvent.drop(screen.getByText("Drop files here").closest(".cu-drop")!, { dataTransfer: { files } });

describe("queueSummary", () => {
  it("counts sent files and ignores refused ones", () => {
    expect(queueSummary([])).toBe("");
    expect(queueSummary([{ status: "done" }, { status: "uploading" }, { status: "rejected" }])).toBe("1 of 2 sent");
    expect(queueSummary([{ status: "done" }, { status: "done" }])).toBe("All 2 files sent");
    expect(queueSummary([{ status: "done" }])).toBe("File sent");
  });
});

describe("DropUploader", () => {
  it("refuses an oversized file in place and sends the rest with progress, in one batch", async () => {
    let finish: (value: unknown) => void = () => {};
    sendFile.mockImplementation((_url: string, _file: File, _fields: Record<string, string>, onProgress: (value: number) => void) => {
      onProgress(0.4);
      return new Promise((resolve) => { finish = resolve; });
    });
    const onSent = vi.fn();
    render(<DropUploader url="/api/x/" fields={{ name: "Rachel" }} accept={["video/*"]} maxBytes={10 * MB} allowedKinds={[]} onSent={onSent} />);
    drop([file("huge.mov", "video/quicktime", 20 * MB), file("take1.mov", "video/quicktime", 2 * MB)]);
    expect(screen.getByText("Too large: 20 MB, the limit is 10 MB.")).toBeInTheDocument();
    await waitFor(() => expect(sendFile).toHaveBeenCalledTimes(1));
    const [url, sent, fields] = sendFile.mock.calls[0];
    expect(url).toBe("/api/x/");
    expect((sent as File).name).toBe("take1.mov");
    expect(fields).toMatchObject({ name: "Rachel" });
    expect((fields as Record<string, string>).batch_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByRole("progressbar", { name: "Uploading take1.mov" })).toHaveAttribute("aria-valuenow", "40");
    await act(async () => finish({ ok: true, data: {} }));
    expect(screen.getByLabelText("Sent")).toBeInTheDocument();
    expect(onSent).toHaveBeenCalledWith(1);
    expect(screen.getByText("File sent")).toBeInTheDocument();
  });

  it("holds files until the sender is ready, and shows why", async () => {
    sendFile.mockResolvedValue({ ok: true, data: {} });
    const { rerender } = render(<DropUploader url="/api/x/" fields={{}} accept={[]} maxBytes={MB} allowedKinds={[]} blockedReason="Add your name above." />);
    drop([file("logo.png", "image/png", 1000)]);
    expect(screen.getByRole("status")).toHaveTextContent("Add your name above.");
    expect(sendFile).not.toHaveBeenCalled();
    rerender(<DropUploader url="/api/x/" fields={{ name: "R" }} accept={[]} maxBytes={MB} allowedKinds={[]} blockedReason={null} />);
    await waitFor(() => expect(sendFile).toHaveBeenCalledTimes(1));
  });

  it("retries a server error once on its own", async () => {
    sendFile.mockResolvedValueOnce({ ok: false, status: 500, error: "The upload failed (500)." }).mockResolvedValueOnce({ ok: true, data: {} });
    render(<DropUploader url="/api/x/" fields={{}} accept={[]} maxBytes={MB} allowedKinds={[]} />);
    drop([file("brief.pdf", "application/pdf", 1000)]);
    expect(await screen.findByLabelText("Sent", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(sendFile).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("The upload failed (500).")).not.toBeInTheDocument();
  });

  it("shows the server's refusal and offers a retry", async () => {
    sendFile.mockResolvedValueOnce({ ok: false, status: 410, error: "This upload link has expired." }).mockResolvedValueOnce({ ok: true, data: {} });
    render(<DropUploader url="/api/x/" fields={{}} accept={[]} maxBytes={MB} allowedKinds={[]} />);
    drop([file("brief.pdf", "application/pdf", 1000)]);
    expect(await screen.findByText("This upload link has expired.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry brief.pdf" }));
    await waitFor(() => expect(sendFile).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText("Sent")).toBeInTheDocument();
  });
});
