// Защита маршрута на фронтенде — только удобство интерфейса (скрыть недоступные разделы),
// реальная проверка прав всегда выполняется на сервере (docs/PASSPORT.md, блок 6).
import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { UserRole, useAuth } from "../../lib/auth";

export function RequireAuth({ roles, children }: { roles?: UserRole[]; children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="p-6 text-sm text-[var(--muted-fg)]">Загрузка…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="p-6">
        <p className="text-sm text-brand-error">
          Недостаточно прав для просмотра этого раздела. Обратитесь к администратору, если считаете это ошибкой.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
