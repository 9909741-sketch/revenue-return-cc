// Общий каркас экранов: боковое меню (по ролям), верхняя панель, дисклеймер в подвале
// (docs/PASSPORT.md, блок 6 и раздел «Оформление» в docs/BUILD_PROMPT.md).
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { useTheme } from "../../lib/theme";
import { USER_ROLE_LABELS } from "../../lib/statusDictionary";
import { Button } from "../ui/Button";

interface NavItem {
  to: string;
  label: string;
  roles: Array<"operator" | "kc_head" | "tt_head" | "admin">;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Сводка", roles: ["kc_head", "tt_head", "admin"] },
  { to: "/cancellations", label: "Отмены", roles: ["operator", "kc_head", "tt_head", "admin"] },
  { to: "/warm-leads", label: "Тёплые лиды", roles: ["operator", "kc_head", "tt_head", "admin"] },
  { to: "/reports", label: "Отчётность", roles: ["kc_head", "tt_head", "admin"] },
  { to: "/import", label: "Импорт выгрузки", roles: ["admin", "kc_head"] },
  { to: "/users", label: "Пользователи", roles: ["admin"] },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  if (!user) return null;

  const handleLogout = async () => {
    setLogoutError(null);
    setIsLoggingOut(true);
    try {
      await logout();
    } catch {
      setLogoutError("Не удалось завершить выход. Ваша сессия может оставаться активной. Попробуйте ещё раз.");
    } finally {
      setIsLoggingOut(false);
    }
  };

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  return (
    <div className="flex min-h-screen flex-col bg-brand-bg text-brand-fg">
      <div className="flex flex-1">
        <aside className="w-56 shrink-0 border-r border-[var(--surface-border)] bg-[var(--surface-bg)] p-4">
          {/* Готового файла логотипа нет (брендбук — только PDF-страницы, без чистого
              векторного знака) — текстовая метка вместо картинки/нарисованной иконки,
              см. docs/CHANGELOG.md. */}
          <div className="mb-6">
            <div className="text-lg font-bold uppercase tracking-wide text-brand-primary">Laparet</div>
            <div className="text-xs text-[var(--muted-fg)]">Возврат выручки КЦ</div>
          </div>
          <nav className="flex flex-col gap-1">
            {visibleItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 text-sm ${
                    isActive
                      ? "bg-brand-primary text-white"
                      : "text-brand-fg hover:bg-brand-accent/15 dark:hover:bg-brand-accent/20"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="flex flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-[var(--surface-border)] bg-[var(--surface-bg)] px-4 py-3">
            <div className="text-sm">
              <div className="font-medium">{user.full_name}</div>
              <div className="text-[var(--muted-fg)]">
                {USER_ROLE_LABELS[user.role]}
                {user.trade_point ? ` · ${user.trade_point}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={toggleTheme} aria-label="Переключить тему">
                {theme === "light" ? "🌙 Тёмная тема" : "☀️ Светлая тема"}
              </Button>
              <Button variant="secondary" onClick={handleLogout} disabled={isLoggingOut}>
                {isLoggingOut ? "Выходим…" : "Выйти"}
              </Button>
            </div>
          </header>

          {logoutError && (
            <div className="border-b border-[var(--surface-border)] px-4 py-3" role="alert">
              <p className="text-sm text-brand-error">{logoutError}</p>
            </div>
          )}

          <main className="flex-1 p-6">
            <Outlet />
          </main>

          <footer className="border-t border-[var(--surface-border)] px-6 py-3 text-xs text-[var(--muted-fg)]">
            Внутренний инструмент компании, доступ только для сотрудников. Обработка персональных данных клиентов
            ведётся в соответствии с политикой компании.
          </footer>
        </div>
      </div>
    </div>
  );
}
