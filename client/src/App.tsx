import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/Layout/ErrorBoundary";
import { AppLayout } from "./components/Layout/AppLayout";
import { RequireAuth } from "./components/Layout/RequireAuth";
import { AuthProvider, useAuth } from "./lib/auth";
import { ThemeProvider } from "./lib/theme";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { TaskListPage } from "./pages/TaskListPage";
import { TaskDetailPage } from "./pages/TaskDetailPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ImportPage } from "./pages/ImportPage";
import { UsersPage } from "./pages/UsersPage";
import { NotFoundPage } from "./pages/NotFoundPage";

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const target = user.role === "operator" ? "/cancellations" : "/dashboard";
  return <Navigate to={target} replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<AppLayout />}>
                <Route path="/" element={<HomeRedirect />} />
                <Route
                  path="/dashboard"
                  element={
                    <RequireAuth roles={["kc_head", "tt_head", "admin"]}>
                      <DashboardPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/cancellations"
                  element={
                    <RequireAuth roles={["operator", "kc_head", "tt_head", "admin"]}>
                      <TaskListPage type="cancellation" />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/cancellations/:id"
                  element={
                    <RequireAuth roles={["operator", "kc_head", "tt_head", "admin"]}>
                      <TaskDetailPage type="cancellation" />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/warm-leads"
                  element={
                    <RequireAuth roles={["operator", "kc_head", "tt_head", "admin"]}>
                      <TaskListPage type="warm_lead" />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/warm-leads/:id"
                  element={
                    <RequireAuth roles={["operator", "kc_head", "tt_head", "admin"]}>
                      <TaskDetailPage type="warm_lead" />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/reports"
                  element={
                    <RequireAuth roles={["kc_head", "tt_head", "admin"]}>
                      <ReportsPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/import"
                  element={
                    <RequireAuth roles={["admin", "kc_head"]}>
                      <ImportPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/users"
                  element={
                    <RequireAuth roles={["admin"]}>
                      <UsersPage />
                    </RequireAuth>
                  }
                />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
