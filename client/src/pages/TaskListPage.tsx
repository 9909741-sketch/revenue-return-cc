// Задачники «Отмены» и «Тёплые лиды» — docs/SPEC.md, раздел 6.
// Общий компонент для обоих модулей: колонки и фильтры почти зеркальны,
// различается только колонка «причина/график касаний» и набор статусов.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Task, TaskType } from "../lib/types";
import { formatDate, formatMoney, daysAgoIso, todayIso } from "../lib/format";
import {
  CANCELLATION_STATUS_COLOR,
  CANCELLATION_STATUS_LABELS,
  CANCEL_REASONS,
  WARM_LEAD_STATUS_COLOR,
  WARM_LEAD_STATUS_LABELS,
} from "../lib/statusDictionary";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Select } from "../components/ui/Select";
import { Input } from "../components/ui/Input";

const CANCELLATION_STATUSES = ["NEW", "WIP", "NO_ANSWER", "CANCEL_OK", "CANCEL_BAD", "REPASS", "DONE_KC", "WON"];
const WARM_LEAD_STATUSES = ["NEW", "WIP", "PASSED_TT", "NO_RESULT", "WON"];

export function TaskListPage({ type }: { type: TaskType }) {
  const { user } = useAuth();
  const isCancellation = type === "cancellation";
  const statusOptions = isCancellation ? CANCELLATION_STATUSES : WARM_LEAD_STATUSES;
  const statusLabels = isCancellation ? CANCELLATION_STATUS_LABELS : WARM_LEAD_STATUS_LABELS;
  const statusColors = isCancellation ? CANCELLATION_STATUS_COLOR : WARM_LEAD_STATUS_COLOR;

  const [statuses, setStatuses] = useState<string[]>(isCancellation ? ["NEW", "WIP", "NO_ANSWER"] : ["NEW", "WIP"]);
  const [dateFrom, setDateFrom] = useState(daysAgoIso(30));
  const [dateTo, setDateTo] = useState(todayIso());
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ type, dateFrom, dateTo });
    if (statuses.length > 0) params.set("statuses", statuses.join(","));

    api
      .get<{ tasks: Task[] }>(`/tasks?${params.toString()}`)
      .then((data) => setTasks(data.tasks))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить задачи."))
      .finally(() => setLoading(false));
  }, [type, statuses, dateFrom, dateTo]);

  const tradePoints = useMemo(
    () => Array.from(new Set((tasks ?? []).map((t) => t.deal.trade_point))).sort(),
    [tasks],
  );
  const [tradePointFilter, setTradePointFilter] = useState<string>("");

  const visibleTasks = useMemo(() => {
    if (!tasks) return [];
    if (!tradePointFilter) return tasks;
    return tasks.filter((t) => t.deal.trade_point === tradePointFilter);
  }, [tasks, tradePointFilter]);

  function toggleStatus(status: string) {
    setStatuses((prev) => (prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]));
  }

  const title = isCancellation ? "Задачник «Отмены»" : "Задачник «Тёплые лиды»";
  const emptyText = isCancellation ? "Нет активных отмен" : "Нет активных тёплых лидов";
  const dateColumnLabel = isCancellation ? "Дата отмены" : "Дата обращения";
  const reasonColumnLabel = isCancellation ? "Причина отмены" : "График касаний";
  const detailBasePath = isCancellation ? "/cancellations" : "/warm-leads";

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">{title}</h1>

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="mb-1 text-xs font-medium text-[var(--muted-fg)]">Статус</div>
            <div className="flex flex-wrap gap-2">
              {statusOptions.map((status) => (
                <label key={status} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={statuses.includes(status)}
                    onChange={() => toggleStatus(status)}
                  />
                  {statusLabels[status]}
                </label>
              ))}
            </div>
          </div>

          {(user?.role === "kc_head" || user?.role === "admin") && tradePoints.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-[var(--muted-fg)]">Торговая точка</div>
              <Select value={tradePointFilter} onChange={(e) => setTradePointFilter(e.target.value)}>
                <option value="">Все</option>
                {tradePoints.map((tp) => (
                  <option key={tp} value={tp}>
                    {tp}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <div className="mb-1 text-xs font-medium text-[var(--muted-fg)]">Давность с</div>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-[var(--muted-fg)]">по</div>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      </Card>

      {error && <p className="mb-4 text-sm text-brand-error">{error}</p>}
      {loading && <p className="text-sm text-[var(--muted-fg)]">Загрузка…</p>}

      {!loading && !error && visibleTasks.length === 0 && (
        <Card>
          <p className="text-sm text-[var(--muted-fg)]">{emptyText}</p>
        </Card>
      )}

      {!loading && visibleTasks.length > 0 && (
        <Card className="overflow-x-auto" noPadding>
          <table className="table-compact w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-[var(--surface-border)] text-xs text-[var(--muted-fg)]">
              <tr>
                <th className="px-3">Приоритет</th>
                <th className="px-3">Клиент, телефон</th>
                <th className="px-3">Сумма</th>
                <th className="px-3">ТТ / сотрудник ТТ</th>
                <th className="px-3">{dateColumnLabel}</th>
                <th className="px-3">{reasonColumnLabel}</th>
                <th className="px-3">Статус</th>
                <th className="px-3">Оператор</th>
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map((task) => (
                <tr
                  key={task.task_id}
                  className={`border-b border-[var(--surface-border)] last:border-0 ${task.is_stale ? "opacity-60" : ""}`}
                >
                  <td className="px-3 font-mono">{Number(task.priority_score).toFixed(0)}</td>
                  <td className="px-3">
                    <Link to={`${detailBasePath}/${task.task_id}`} className="text-brand-primary underline">
                      {task.deal.client_name}
                    </Link>
                    <div className="text-xs text-[var(--muted-fg)]">{task.deal.client_phone}</div>
                  </td>
                  <td className="px-3">{formatMoney(task.deal.amount)}</td>
                  <td className="px-3">
                    {task.deal.trade_point}
                    <div className="text-xs text-[var(--muted-fg)]">{task.deal.tt_employee}</div>
                  </td>
                  <td className="px-3">
                    {formatDate(isCancellation ? task.deal.status_changed_at : task.deal.created_at)}
                  </td>
                  <td className="px-3">
                    {isCancellation
                      ? task.deal.cancel_reason_code
                        ? `${task.deal.cancel_reason_code} — ${CANCEL_REASONS[task.deal.cancel_reason_code] ?? ""}`
                        : "—"
                      : task.next_touch_date
                        ? `Следующее: ${formatDate(task.next_touch_date)} (${task.touches_count}/4)`
                        : "—"}
                  </td>
                  <td className="px-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[task.status]}`}>
                      {statusLabels[task.status] ?? task.status}
                    </span>
                  </td>
                  <td className="px-3">{task.operator_full_name ?? task.assigned_operator_email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="mt-3">
        <Button variant="ghost" onClick={() => window.location.reload()}>
          Обновить список
        </Button>
      </div>
    </div>
  );
}
