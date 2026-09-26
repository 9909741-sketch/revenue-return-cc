// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { AuthProvider, useAuth, type CurrentUser } from "../lib/auth";
import type { Task } from "../lib/types";
import { LoginPage } from "./LoginPage";
import { TaskDetailPage } from "./TaskDetailPage";
import { TaskListPage } from "./TaskListPage";

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    postForm: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const signedInUser: CurrentUser = {
  email: "operator@example.com",
  full_name: "Test Operator",
  role: "operator",
  trade_point: null,
};

function AuthDestination() {
  const { user } = useAuth();
  return <p>{user ? `Signed in as ${user.role}` : "Home"}</p>;
}

function renderTaskDetail(task: Task) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[`/warm-leads/${task.task_id}`]}>
        <Routes>
          <Route path="/warm-leads/:id" element={<TaskDetailPage type="warm_lead" />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

function makeWarmLeadTask(): Task {
  return {
    task_id: "task-1",
    deal_id: "deal-1",
    type: "warm_lead",
    status: "WIP",
    assigned_operator_email: signedInUser.email,
    priority_score: "90",
    next_touch_date: null,
    touches_count: 3,
    created_at: "2026-09-20T10:00:00.000Z",
    updated_at: "2026-09-20T10:00:00.000Z",
    closed_at: null,
    deal: {
      deal_id: "deal-1",
      created_at: "2026-09-20T10:00:00.000Z",
      status_changed_at: "2026-09-20T10:00:00.000Z",
      source_stage: "NEW",
      classification: "warm_lead",
      amount: 25000,
      kc_operator_email: signedInUser.email,
      trade_point: "Лапарет — Центр",
      tt_employee: "Test Employee",
      transferred_at: null,
      cancel_reason_code: null,
      cancel_comment: null,
      client_phone: "+7 900 000-00-00",
      client_name: "Иван Иванов",
      product_group: "Плитка",
      channel: "phone",
    },
    operator_full_name: signedInUser.full_name,
  };
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("sign-in flow", () => {
  it("shows a rejected sign-in and then routes to the signed-in destination on retry", async () => {
    vi.mocked(api.get).mockResolvedValue({ user: null } as never);
    vi.mocked(api.post)
      .mockRejectedValueOnce(new ApiError("Неверный email или пароль"))
      .mockResolvedValueOnce({ user: signedInUser } as never);
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/login"]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<AuthDestination />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    await user.type(screen.getByLabelText("Email"), signedInUser.email);
    await user.type(screen.getByLabelText("Пароль"), "incorrect");
    await user.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByText("Неверный email или пароль")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Войти" }));

    expect(await screen.findByText("Signed in as operator")).toBeTruthy();
    expect(api.post).toHaveBeenNthCalledWith(1, "/auth/login", {
      email: signedInUser.email,
      password: "incorrect",
    });
    expect(api.post).toHaveBeenNthCalledWith(2, "/auth/login", {
      email: signedInUser.email,
      password: "incorrect",
    });
  });
});

describe("cancellation task list", () => {
  it("filters loaded tasks by trade point", async () => {
    const tasks = [
      { ...makeWarmLeadTask(), type: "cancellation", status: "NEW" },
      {
        ...makeWarmLeadTask(),
        task_id: "task-2",
        deal_id: "deal-2",
        type: "cancellation",
        status: "NEW",
        deal: {
          ...makeWarmLeadTask().deal,
          deal_id: "deal-2",
          client_name: "Мария Петрова",
          trade_point: "Лапарет — Север",
        },
      },
    ] satisfies Task[];

    vi.mocked(api.get).mockImplementation((path) =>
      Promise.resolve(
        (path === "/auth/me"
          ? { user: { ...signedInUser, role: "admin" } }
          : { tasks }) as never,
      ),
    );
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <MemoryRouter>
          <TaskListPage type="cancellation" />
        </MemoryRouter>
      </AuthProvider>,
    );

    expect(await screen.findByText("Иван Иванов")).toBeTruthy();
    expect(screen.getByText("Мария Петрова")).toBeTruthy();

    await user.selectOptions(screen.getAllByRole("combobox")[0], "Лапарет — Север");

    expect(screen.getByText("Мария Петрова")).toBeTruthy();
    expect(screen.queryByText("Иван Иванов")).toBeNull();
  });
});

describe("warm-lead fourth-touch flow", () => {
  it("requires a closure reason and submits the chosen reason with the call comment", async () => {
    const task = makeWarmLeadTask();
    const response = { task, touches: [] };
    vi.mocked(api.get).mockImplementation((path) =>
      Promise.resolve((path === "/auth/me" ? { user: signedInUser } : response) as never),
    );
    vi.mocked(api.post).mockResolvedValue(undefined as never);
    const user = userEvent.setup();

    renderTaskDetail(task);

    expect(await screen.findByText(/Это 4-е касание без результата/)).toBeTruthy();
    expect(screen.getByText("Причина закрытия (обязательно)")).toBeTruthy();
    const resultCodeSelect = screen.getAllByRole("combobox")[0];
    expect((resultCodeSelect as HTMLSelectElement).value).toBe("W01");

    await user.selectOptions(resultCodeSelect, "W02");
    await user.type(screen.getByRole("textbox"), "Клиенту не подошла цена");
    await user.click(screen.getByRole("button", { name: "Сохранить результат звонка" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/tasks/task-1/touch", {
        resultCode: "W02",
        comment: "Клиенту не подошла цена",
        nextStatus: undefined,
      });
    });
  });
});