// Экран /users — docs/SPEC.md, раздел 6, функция MVP №5. Доступен только администратору.
import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { PublicUser } from "../lib/types";
import { USER_ROLE_LABELS } from "../lib/statusDictionary";
import { formatDate } from "../lib/format";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";

const ROLES: PublicUser["role"][] = ["operator", "kc_head", "tt_head", "admin"];

export function UsersPage() {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<PublicUser["role"]>("operator");
  const [tradePoint, setTradePoint] = useState("");
  const [busy, setBusy] = useState(false);

  function loadUsers() {
    setLoading(true);
    api
      .get<{ users: PublicUser[] }>("/users")
      .then((data) => setUsers(data.users))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить пользователей."))
      .finally(() => setLoading(false));
  }

  useEffect(loadUsers, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<{ user: PublicUser; temporaryPassword: string }>("/users", {
        email,
        full_name: fullName,
        role,
        trade_point: role === "tt_head" ? tradePoint : null,
      });
      setNotice(
        `Пользователь ${result.user.email} создан. Временный пароль (показывается один раз): ${result.temporaryPassword}`,
      );
      setEmail("");
      setFullName("");
      setTradePoint("");
      setRole("operator");
      loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось создать пользователя.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPassword(targetEmail: string) {
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<{ temporaryPassword: string }>(`/users/${encodeURIComponent(targetEmail)}/reset-password`);
      setNotice(`Пароль сброшен для ${targetEmail}. Временный пароль (показывается один раз): ${result.temporaryPassword}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сбросить пароль.");
    }
  }

  async function handleToggleActive(u: PublicUser) {
    setError(null);
    try {
      await api.patch(`/users/${encodeURIComponent(u.email)}`, { active: !u.active });
      loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось изменить пользователя.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Пользователи</h1>

      {error && <p className="text-sm text-brand-error">{error}</p>}
      {notice && <p className="rounded-md bg-brand-success/10 p-3 text-sm">{notice}</p>}

      <Card>
        <h2 className="mb-2 text-sm font-semibold">Новый пользователь</h2>
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Email
            <Input className="mt-1" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="text-sm">
            ФИО
            <Input className="mt-1" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </label>
          <label className="text-sm">
            Роль
            <Select className="mt-1" value={role} onChange={(e) => setRole(e.target.value as PublicUser["role"])}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {USER_ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </label>
          {role === "tt_head" && (
            <label className="text-sm">
              Торговая точка
              <Input className="mt-1" required value={tradePoint} onChange={(e) => setTradePoint(e.target.value)} />
            </label>
          )}
          <Button type="submit" disabled={busy}>
            Создать
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-semibold">Список пользователей</h2>
        {loading && <p className="text-sm text-[var(--muted-fg)]">Загрузка…</p>}
        {!loading && users.length <= 1 && (
          <p className="mb-2 text-sm text-[var(--muted-fg)]">В системе только вы.</p>
        )}
        {!loading && (
          <table className="table-compact w-full text-left text-sm">
            <thead className="border-b border-[var(--surface-border)] text-xs text-[var(--muted-fg)]">
              <tr>
                <th className="px-2">Email</th>
                <th className="px-2">ФИО</th>
                <th className="px-2">Роль</th>
                <th className="px-2">Точка</th>
                <th className="px-2">Активен</th>
                <th className="px-2">Создан</th>
                <th className="px-2">Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.email} className="border-b border-[var(--surface-border)] last:border-0">
                  <td className="px-2">{u.email}</td>
                  <td className="px-2">{u.full_name}</td>
                  <td className="px-2">{USER_ROLE_LABELS[u.role]}</td>
                  <td className="px-2">{u.trade_point ?? "—"}</td>
                  <td className="px-2">{u.active ? "Да" : "Нет"}</td>
                  <td className="px-2">{formatDate(u.created_at)}</td>
                  <td className="px-2 flex gap-2">
                    <Button variant="ghost" onClick={() => handleResetPassword(u.email)}>
                      Сбросить пароль
                    </Button>
                    <Button variant="ghost" onClick={() => handleToggleActive(u)}>
                      {u.active ? "Отключить" : "Включить"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
