// Задачники «Отмены» и «Тёплые лиды» — общая логика (функции MVP №2 и №3).
// Источник правил — docs/SPEC.md, разделы 4 и 5; docs/PASSPORT.md, блок 6 (матрица прав).
import { pool } from "../db/pool";
import { AccessDeniedError, AuthenticatedUser } from "../middleware/auth";
import {
  CANCELLATION_FINAL_STATUSES,
  CANCELLATION_REQUIRES_TOUCH,
  CANCELLATION_STATUSES,
  CANCELLATION_TRANSITIONS,
  CancellationStatus,
  TaskType,
  WARM_LEAD_FINAL_STATUSES,
  WARM_LEAD_REASONS,
  WARM_LEAD_STATUSES,
  WARM_LEAD_TRANSITIONS,
  WarmLeadStatus,
} from "../domain/statusCodes";
import { calculatePriority } from "../domain/priority";
import { computeNextTouchDate, isAutocloseTouch } from "../domain/touchSchedule";
import { DealRow, TaskRow, TaskWithDeal, TouchRow } from "../types/models";
import { NotFoundError, ValidationError } from "../utils/validation";
import { writeAudit } from "./auditLog";

// --- Доступ к данным по ролям (docs/PASSPORT.md, блок 6) ---

function assertCanEdit(actor: AuthenticatedUser, task: TaskRow): void {
  if (actor.role === "tt_head") {
    throw new AccessDeniedError("Руководителю ТТ доступен только просмотр задач своей точки.");
  }
  if (actor.role === "operator" && task.assigned_operator_email !== actor.email) {
    // Не 403, а «не найдено» — оператор не должен даже узнать, что чужая задача существует
    // (критерий приёмки №5).
    throw new NotFoundError("Задача не найдена.");
  }
}

function statusSetFor(type: TaskType): readonly string[] {
  return type === "cancellation" ? CANCELLATION_STATUSES : WARM_LEAD_STATUSES;
}

function finalStatusesFor(type: TaskType): string[] {
  return type === "cancellation" ? CANCELLATION_FINAL_STATUSES : WARM_LEAD_FINAL_STATUSES;
}

function transitionsFor(type: TaskType): Record<string, string[]> {
  return type === "cancellation" ? CANCELLATION_TRANSITIONS : WARM_LEAD_TRANSITIONS;
}

// --- Список задач ---

export interface TaskListFilters {
  type: TaskType;
  statuses?: string[];
  tradePoints?: string[];
  operatorEmail?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface TaskListItem extends TaskWithDeal {
  is_stale: boolean;
}

export async function listTasks(actor: AuthenticatedUser, filters: TaskListFilters): Promise<TaskListItem[]> {
  const conditions: string[] = ["t.type = $1", "t.deleted_at IS NULL", "d.deleted_at IS NULL"];
  const params: unknown[] = [filters.type];

  if (filters.statuses && filters.statuses.length > 0) {
    params.push(filters.statuses);
    conditions.push(`t.status = ANY($${params.length})`);
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`d.status_changed_at >= $${params.length}`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`d.status_changed_at <= $${params.length}`);
  }

  // Изоляция данных по ролям — применяется на сервере независимо от того, что прислал клиент.
  if (actor.role === "operator") {
    params.push(actor.email);
    conditions.push(`t.assigned_operator_email = $${params.length}`);
  } else if (actor.role === "tt_head") {
    params.push(actor.trade_point);
    conditions.push(`d.trade_point = $${params.length}`);
  } else {
    // kc_head/admin видят всё, но могут сами сузить выборку по точке или оператору.
    if (filters.tradePoints && filters.tradePoints.length > 0) {
      params.push(filters.tradePoints);
      conditions.push(`d.trade_point = ANY($${params.length})`);
    }
    if (filters.operatorEmail) {
      params.push(filters.operatorEmail);
      conditions.push(`t.assigned_operator_email = $${params.length}`);
    }
  }

  const sql = `
    SELECT t.*, row_to_json(d.*) AS deal, u.full_name AS operator_full_name
    FROM tasks t
    JOIN deals d ON d.deal_id = t.deal_id
    LEFT JOIN users u ON u.email = t.assigned_operator_email
    WHERE ${conditions.join(" AND ")}
  `;
  const result = await pool.query<TaskRow & { deal: DealRow; operator_full_name: string | null }>(sql, params);

  const now = new Date();
  const items: TaskListItem[] = result.rows.map((row) => {
    const amount = row.deal.amount == null ? null : Number(row.deal.amount);
    const priority = calculatePriority({
      amount,
      eventDate: new Date(row.deal.status_changed_at),
      cancelReasonCode: row.deal.cancel_reason_code,
      now,
    });
    return {
      ...row,
      priority_score: String(priority.priorityScore),
      is_stale: priority.isStale,
    };
  });

  // Сортировка: сначала «свежие» задачи по убыванию приоритета, устаревшие (>14 дней) — в конец.
  items.sort((a, b) => {
    if (a.is_stale !== b.is_stale) return a.is_stale ? 1 : -1;
    return Number(b.priority_score) - Number(a.priority_score);
  });

  return items;
}

// --- Карточка задачи ---

export async function getTaskWithTouches(
  actor: AuthenticatedUser,
  taskId: string,
): Promise<{ task: TaskWithDeal; touches: TouchRow[] }> {
  const result = await pool.query<TaskRow & { deal: DealRow; operator_full_name: string | null }>(
    `SELECT t.*, row_to_json(d.*) AS deal, u.full_name AS operator_full_name
     FROM tasks t
     JOIN deals d ON d.deal_id = t.deal_id
     LEFT JOIN users u ON u.email = t.assigned_operator_email
     WHERE t.task_id = $1 AND t.deleted_at IS NULL`,
    [taskId],
  );
  const task = result.rows[0];
  if (!task) {
    throw new NotFoundError("Задача не найдена.");
  }

  // Изоляция данных: чужая задача выглядит так же, как отсутствующая (критерий приёмки №5).
  if (actor.role === "operator" && task.assigned_operator_email !== actor.email) {
    throw new NotFoundError("Задача не найдена.");
  }
  if (actor.role === "tt_head" && task.deal.trade_point !== actor.trade_point) {
    throw new NotFoundError("Задача не найдена.");
  }

  const touchesResult = await pool.query<TouchRow>(
    "SELECT * FROM touches WHERE task_id = $1 ORDER BY happened_at ASC",
    [taskId],
  );

  return { task, touches: touchesResult.rows };
}

// --- Взять в работу ---

export async function takeTask(actor: AuthenticatedUser, taskId: string): Promise<TaskRow> {
  const { task } = await getTaskWithTouches(actor, taskId);
  assertCanEdit(actor, task);

  const transitions = transitionsFor(task.type);
  if (!transitions[task.status]?.includes("WIP")) {
    throw new ValidationError(`Нельзя взять задачу в работу из статуса ${task.status}.`);
  }

  const result = await pool.query<TaskRow>(
    "UPDATE tasks SET status = 'WIP', updated_at = now() WHERE task_id = $1 RETURNING *",
    [taskId],
  );
  await writeAudit(actor.email, `Взял(а) в работу задачу ${task.type === "cancellation" ? "«Отмена»" : "«Тёплый лид»"} по сделке ${task.deal_id}`);
  return result.rows[0];
}

// --- Зафиксировать звонок / закрыть (единое действие, см. docs/CHANGELOG.md) ---

export interface RecordTouchInput {
  resultCode: string;
  comment: string;
  nextStatus?: string;
}

function isValidWarmLeadReasonInput(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(WARM_LEAD_REASONS, code);
}

export async function recordTouch(
  actor: AuthenticatedUser,
  taskId: string,
  input: RecordTouchInput,
): Promise<{ task: TaskRow; touch: TouchRow }> {
  const { task } = await getTaskWithTouches(actor, taskId);
  assertCanEdit(actor, task);

  if (finalStatusesFor(task.type).includes(task.status)) {
    throw new ValidationError("Задача уже закрыта, действия недоступны.");
  }
  if (!input.resultCode || !input.resultCode.trim()) {
    throw new ValidationError("Укажите результат звонка.");
  }
  if (!input.comment || !input.comment.trim()) {
    throw new ValidationError("Комментарий обязателен.");
  }

  const touchesAfter = task.touches_count + 1;
  let nextStatus = input.nextStatus?.trim() || undefined;

  // Тёплый лид: если оператор логирует звонок прямо из NEW (не нажав отдельно «Взять в
  // работу»), считаем, что задача тем самым уже взята в работу — иначе переходы из WIP
  // (PASSED_TT/NO_RESULT/WON, в т.ч. автозакрытие после 4-го касания) были бы недостижимы.
  const effectiveStatus = task.type === "warm_lead" && task.status === "NEW" ? "WIP" : task.status;

  if (task.type === "warm_lead") {
    const goingToFinal = nextStatus === "PASSED_TT" || nextStatus === "WON";
    if (isAutocloseTouch(touchesAfter) && !goingToFinal) {
      // Правило: после 4-го касания без результата — автозакрытие в NO_RESULT
      // с обязательной причиной W01–W08 (критерий приёмки №8).
      if (!isValidWarmLeadReasonInput(input.resultCode)) {
        throw new ValidationError(
          "После 4-го касания без результата задача закрывается автоматически — укажите причину закрытия (W01–W08) в поле результата звонка.",
        );
      }
      nextStatus = "NO_RESULT";
    }
  }

  if (nextStatus) {
    const statusSet = statusSetFor(task.type);
    if (!statusSet.includes(nextStatus)) {
      throw new ValidationError(`Неизвестный статус: ${nextStatus}.`);
    }
    const transitions = transitionsFor(task.type);
    if (!transitions[effectiveStatus]?.includes(nextStatus)) {
      throw new ValidationError(`Недопустимый переход статуса: из ${effectiveStatus} в ${nextStatus}.`);
    }
    if (task.type === "cancellation" && CANCELLATION_REQUIRES_TOUCH.includes(nextStatus as CancellationStatus)) {
      // Защитная проверка: переход возможен только вместе минимум с одним зафиксированным
      // касанием — конструктивно обеспечено тем, что этот вызов сам создаёт touch.
      if (touchesAfter < 1) {
        throw new ValidationError("Переход в этот статус доступен только после зафиксированного звонка.");
      }
    }
    if (task.type === "warm_lead" && (nextStatus as WarmLeadStatus) === "NO_RESULT") {
      if (!isValidWarmLeadReasonInput(input.resultCode)) {
        throw new ValidationError("Для закрытия без результата обязательна причина W01–W08.");
      }
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const touchResult = await client.query<TouchRow>(
      `INSERT INTO touches (task_id, operator_email, result_code, comment)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [taskId, actor.email, input.resultCode.trim(), input.comment.trim()],
    );

    let nextTouchDate: string | null = null;
    const finalStatuses = finalStatusesFor(task.type);
    const closing = nextStatus ? finalStatuses.includes(nextStatus) : false;

    if (!closing) {
      if (task.type === "warm_lead") {
        const baseDate = new Date(task.deal.created_at ?? task.created_at);
        const scheduled = computeNextTouchDate(baseDate, touchesAfter);
        nextTouchDate = scheduled ? scheduled.toISOString().slice(0, 10) : null;
      } else {
        // Отмены: простое правило — следующий контакт на следующий день (docs/CHANGELOG.md).
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        nextTouchDate = tomorrow.toISOString().slice(0, 10);
      }
    }

    const updateResult = await client.query<TaskRow>(
      `UPDATE tasks SET
         status = $2,
         touches_count = $3,
         next_touch_date = $4,
         closed_at = CASE WHEN $5 THEN now() ELSE closed_at END,
         updated_at = now()
       WHERE task_id = $1
       RETURNING *`,
      [taskId, nextStatus ?? effectiveStatus, touchesAfter, nextTouchDate, closing],
    );

    await client.query("INSERT INTO audit_log (user_email, action) VALUES ($1, $2)", [
      actor.email,
      `Зафиксирован звонок по задаче ${taskId} (сделка ${task.deal_id})${nextStatus ? `, новый статус ${nextStatus}` : ""}`,
    ]);

    await client.query("COMMIT");
    return { task: updateResult.rows[0], touch: touchResult.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
