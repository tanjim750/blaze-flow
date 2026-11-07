import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PublicUploader, senderProblem } from "./uploader";

afterEach(cleanup);

const link = {
  studio_name: "Northlight Studio", project_name: "Spring Launch Campaign", label: "Send us your footage",
  instructions: "Raw camera files, please.", due_at: "2026-10-14T16:00:00Z", expires_at: null,
  max_file_bytes: 2 * 1024 ** 3, allowed_kinds: ["video" as const, "document" as const], accept: ["video/*", ".pdf"],
};

describe("senderProblem", () => {
  it("asks for a name, then a valid email", () => {
    expect(senderProblem("", "a@b.co")).toMatch(/name/);
    expect(senderProblem("Rachel", "nope")).toMatch(/valid email/);
    expect(senderProblem("Rachel", "rachel@brand.com")).toBeNull();
  });
});

describe("PublicUploader", () => {
  it("shows the studio, project, label, rules and deadline", () => {
    render(<PublicUploader token="tok" link={link} />);
    expect(screen.getByText("Northlight Studio")).toBeInTheDocument();
    expect(screen.getByText("Spring Launch Campaign")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Send us your footage" })).toBeInTheDocument();
    expect(screen.getByText("Raw camera files, please.")).toBeInTheDocument();
    expect(screen.getByText(/Please send by Oct 14/)).toBeInTheDocument();
    expect(screen.getByText("Video and documents · up to 2 GB each")).toBeInTheDocument();
    expect(screen.getByLabelText("Choose files to send")).toHaveAttribute("accept", "video/*,.pdf");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Rachel" } });
    expect(screen.getByLabelText("Name")).toHaveValue("Rachel");
  });
});
