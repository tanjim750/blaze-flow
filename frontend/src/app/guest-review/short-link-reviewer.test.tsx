import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuestReviewer } from "./reviewer";

describe("guest review opened from a short link", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });

  it("redeems the code itself and remembers the shared cut", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/exchange/")) {
        return new Response(JSON.stringify({ project_id: "p1", guest_session_id: "g1", access_key: "k", media_version_id: "m2" }), { status: 201 });
      }
      return new Response(JSON.stringify({ detail: "x" }), { status: 403 });
    });
    render(<GuestReviewer token="Z70ayQFE" cut={null} />);
    fireEvent.change(await screen.findByLabelText(/full name/i), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "ana@example.com" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /open review/i })); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.token).toBe("Z70ayQFE");
    const stored = JSON.parse(localStorage.getItem("blazeflow_guest:Z70ayQFE") ?? "{}");
    expect(stored.cut).toBe("m2");
    expect(window.location.href).not.toContain("token=");
  });

  it("an invalid code shows the incomplete-link message", () => {
    render(<GuestReviewer token="" cut={null} />);
    expect(screen.getByText(/incomplete/i)).toBeTruthy();
  });
});
