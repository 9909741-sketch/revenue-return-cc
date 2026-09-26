// Экран /login — docs/SPEC.md, раздел 6: вход по email и паролю, ошибка при неверных данных.
import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card } from "../components/ui/Card";

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось войти. Попробуйте ещё раз.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand-bg px-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-lg font-semibold text-brand-primary">Возврат выручки контакт-центра</h1>
        <p className="mb-6 text-sm text-[var(--muted-fg)]">Войдите со своей учётной записью.</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="text-sm">
            Email
            <Input
              className="mt-1"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Пароль
            <Input
              className="mt-1"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error && <p className="text-sm text-brand-error">{error}</p>}

          <Button type="submit" disabled={submitting} className="mt-2 w-full">
            {submitting ? "Входим…" : "Войти"}
          </Button>
        </form>
      </Card>

      <p className="mt-4 max-w-sm text-center text-xs text-[var(--muted-fg)]">
        Внутренний инструмент компании, доступ только для сотрудников. Обработка персональных данных клиентов
        ведётся в соответствии с политикой компании.
      </p>
    </div>
  );
}
