// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "./AppLayout";
import { AuthProvider } from "../../lib/auth";
import { api } from "../../lib/api";
import type { CurrentUser } from "../../lib/auth";

vi.mock("../../lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("../../lib/theme", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }),
}));

const signedInUser: CurrentUser = {
  email: "operator@example.com",
  full_name: "Test Operator",
  role: "operator",
  trade_point: null,
};

function renderSignedInLayout() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<p>Dashboard content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("AppLayout logout retry", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({ user: signedInUser } as never);
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("keeps the signed-in layout after a failed logout and allows a successful retry", async () => {
    let resolveRetry!: (value: never) => void;
    const retryResponse = new Promise<never>((resolve) => {
      resolveRetry = resolve;
    });
    vi.mocked(api.post)
      .mockRejectedValueOnce(new Error("Network error"))
      .mockReturnValueOnce(retryResponse);

    const user = userEvent.setup();
    renderSignedInLayout();

    expect(await screen.findByText("Dashboard content")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Выйти" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Не удалось завершить выход");
    expect(screen.getByText("Test Operator")).toBeTruthy();
    expect(screen.getByText("Dashboard content")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Выйти" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Выйти" }));
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.post).toHaveBeenNthCalledWith(1, "/auth/logout");
    expect(api.post).toHaveBeenNthCalledWith(2, "/auth/logout");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Выходим…" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    resolveRetry(undefined as never);
    await waitFor(() => {
      expect(screen.queryByText("Dashboard content")).toBeNull();
    });
  });
});