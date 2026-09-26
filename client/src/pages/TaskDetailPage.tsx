// Карточка отмены / карточка тёплого лида — docs/SPEC.md, раздел 6.
import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { Task, TaskType, Touch } from "../lib/types";
import { formatDateTime, formatMoney } from "../lib/format";
import {
  CALL_OUTCOME_LABELS,
  CANCELLATION_STATUS_LABELS,
  CANCELLATION_TRANSITIONS,
  CANCEL_REASONS,
  WARM_LEAD_REASONS,
  WARM_LEAD_STATUS_LABELS,
  WARM_LEAD_TRANSITIONS,
} from "../lib/statusDictionary";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Select } from "../components/ui/Select";
import { Textarea } from "../components/ui/Textarea";

export function TaskDetailPage({ type }: { type: TaskType }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isCancellation = type === "cancellation";
  const statusLabels = isCancellation ? CANCELLATION_STATUS_LABELS : WARM_LEAD_STATUS_LABELS;
  const transitions = isCancellation ? CANCELLATION_TRANSITIONS : WARM_LEAD_TRANSITIONS;
  const listPath = isCancellation ? "/cancellations" : "/warm-leads";

  const [task, setTask] = useState<Task | null>(null);
  const [touches, setTouches] = useState<Touch[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [resultCode, setResultCode] = useState("ANSWERED");
  const [comment, setComment] = useState("");
  const [nextStatus, setNextStatus] = useState("");

  function reload() {
    if (!id) return;
    setLoading(true);
    api
      .get<{ task: Task; touches: Touch[] }>(`/tasks/${id}`)
      .then((data) => {
        setTask(data.task);
        setTouches(data.touches);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }

  useEffect(reload, [id]);

  // Тёплый лид: 4-е касание без явного перевода в PASSED_TT/WON сервер закрывает
  // автоматически в NO_RESULT и требует причину W01–W08 (server/src/services/taskService.ts,
  // isAutocloseTouch). Заранее показываем список причин и явно предупреждаем, чтобы
  // оператор не наткнулся на ошибку валидации без понятного пути её исправить.
  const willAutoCloseOnThisTouch =
    !isCancellation &&
    task != null &&
    task.touches_count + 1 >= 4 &&
    nextStatus !== "PASSED_TT" &&
    nextStatus !== "WON";
  const reasonRequired = nextStatus === "NO_RESULT" || willAutoCloseOnThisTouch;

  // Сбрасываем выбранный код результата при переключении между списком «исход звонка»
  // и списком «причина W01–W08» — иначе в контролируемом <select> могло остаться
  // значение, которого нет среди отображаемых option (см. отчёт ревью).
  useEffect(() => {
    setResultCode(reasonRequired ? "W01" : "ANSWERED");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reasonRequired]);

  async function handleTake() {
    if (!task) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/tasks/${task.task_id}/take`);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось выполнить действие.");
    } finally {
      setBusy(false);
    }
  }

  async function handleTouchSubmit(event: FormEvent) {
    event.preventDefault();
    if (!task) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/tasks/${task.task_id}/touch`, {
        resultCode,
        comment,
        nextStatus: nextStatus || undefined,
      });
      setComment("");
      setNextStatus("");
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось сохранить результат звонка.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-[var(--muted-fg)]">Загрузка…</p>;
  if (notFound || !task) {
    return (
      <div>
        <p className="mb-2 text-sm text-brand-error">Задача не найдена.</p>
        <Link to={listPath} className="text-sm text-brand-primary underline">
          Вернуться к списку
        </Link>
      </div>
    );
  }

  const canTake = transitions[task.status]?.includes("WIP");
  const isClosed = transitions[task.status]?.length === 0;
  const availableNextStatuses = transitions[task.status] ?? [];
  const resultCodeOptions = reasonRequired
    ? Object.entries(WARM_LEAD_REASONS)
    : Object.entries(CALL_OUTCOME_LABELS);

  return (
    <div className="max-w-3xl">
      <Link to={listPath} className="mb-3 inline-block text-sm text-brand-primary underline">
        ← К списку
      </Link>
      <h1 className="mb-4 text-lg font-semibold">
        {isCancellation ? "Карточка отмены" : "Карточка тёплого лида"}: {task.deal.client_name}
      </h1>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Данные сделки</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-[var(--muted-fg)]">Сделка</dt>
            <dd>{task.deal.deal_id}</dd>
            <dt className="text-[var(--muted-fg)]">Клиент</dt>
            <dd>{task.deal.client_name}</dd>
            <dt className="text-[var(--muted-fg)]">Телефон</dt>
            <dd>{task.deal.client_phone}</dd>
            <dt className="text-[var(--muted-fg)]">Сумма</dt>
            <dd>{formatMoney(task.deal.amount)}</dd>
            <dt className="text-[var(--muted-fg)]">Точка</dt>
            <dd>{task.deal.trade_point}</dd>
            <dt className="text-[var(--muted-fg)]">Сотрудник ТТ</dt>
            <dd>{task.deal.tt_employee}</dd>
            {isCancellation && (
              <>
                <dt className="text-[var(--muted-fg)]">Причина отмены</dt>
                <dd>
                  {task.deal.cancel_reason_code
                    ? `${task.deal.cancel_reason_code} — ${CANCEL_REASONS[task.deal.cancel_reason_code] ?? ""}`
                    : "—"}
                </dd>
                <dt className="text-[var(--muted-fg)]">Комментарий Б24</dt>
                <dd>{task.deal.cancel_comment ?? "—"}</dd>
              </>
            )}
            <dt className="text-[var(--muted-fg)]">Оператор</dt>
            <dd>{task.operator_full_name ?? task.assigned_operator_email}</dd>
            <dt className="text-[var(--muted-fg)]">Статус</dt>
            <dd className="font-medium">{statusLabels[task.status] ?? task.status}</dd>
            <dt className="text-[var(--muted-fg)]">Касаний</dt>
            <dd>{task.touches_count}</dd>
          </dl>
        </Card>

        <Card>
          <h2 className="mb-2 text-sm font-semibold">Действие</h2>
          {actionError && <p className="mb-2 text-sm text-brand-error">{actionError}</p>}

          {isClosed && <p className="text-sm text-[var(--muted-fg)]">Задача закрыта, действия недоступны.</p>}

          {!isClosed && (
            <div className="flex flex-col gap-4">
              {canTake && (
                <Button variant="secondary" onClick={handleTake} disabled={busy}>
                  Взять в работу
                </Button>
              )}

              <form onSubmit={handleTouchSubmit} className="flex flex-col gap-3 border-t border-[var(--surface-border)] pt-3">
                {willAutoCloseOnThisTouch && (
                  <p className="rounded-md bg-brand-error/10 p-2 text-xs text-brand-error">
                    Это 4-е касание без результата — после сохранения лид автоматически закроется в статусе
                    «Закрыт без результата». Укажите причину W01–W08.
                  </p>
                )}
                <div>
                  <div className="mb-1 text-xs font-medium text-[var(--muted-fg)]">
                    {reasonRequired ? "Причина закрытия (обязательно)" : "Результат звонка"}
                  </div>
                  <Select value={resultCode} onChange={(e) => setResultCode(e.target.value)} required>
                    {resultCodeOptions.map(([code, label]) => (
                      <option key={code} value={code}>
                        {code} — {label}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <div className="mb-1 text-xs font-medium text-[var(--muted-fg)]">Изменить статус на</div>
                  <Select value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
                    <option value="">— не менять статус —</option>
                    {availableNextStatuses.map((status) => (
                      <option key={status} value={status}>
                        {statusLabels[status] ?? status}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <div className="mb-1 text-xs font-medium text-[var(--muted-fg)]">Комментарий (обязательно)</div>
                  <Textarea rows={3} required value={comment} onChange={(e) => setComment(e.target.value)} />
                </div>

                <Button type="submit" disabled={busy}>
                  Сохранить результат звонка
                </Button>
              </form>
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <h2 className="mb-2 text-sm font-semibold">История звонков</h2>
        {touches.length === 0 && <p className="text-sm text-[var(--muted-fg)]">Звонков ещё не было.</p>}
        <ul className="flex flex-col gap-2 text-sm">
          {touches.map((touch) => (
            <li key={touch.touch_id} className="border-b border-[var(--surface-border)] pb-2 last:border-0">
              <div className="text-xs text-[var(--muted-fg)]">
                {formatDateTime(touch.happened_at)} · {touch.operator_email} · код {touch.result_code}
              </div>
              <div>{touch.comment}</div>
            </li>
          ))}
        </ul>
      </Card>

      <Button variant="ghost" className="mt-4" onClick={() => navigate(listPath)}>
        ← Вернуться к списку
      </Button>
    </div>
  );
}
