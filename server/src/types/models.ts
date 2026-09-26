// Формы строк БД в виде TypeScript-типов. Поля названы как колонки (snake_case) —
// сервер отдаёт их на фронтенд в том же виде без лишнего маппинга.
//
// Важно про типы дат: поля ниже типизированы как `string`, что верно, когда колонка
// проходит через row_to_json() (используется в join-запросах задачника, taskService.ts) —
// там Postgres сериализует date/timestamptz в ISO-строку. Но там, где date/timestamptz
// выбираются НАПРЯМУЮ (например, reportService.ts, touches.happened_at в
// getTaskWithTouches), драйвер pg отдаёт нативный JS Date, а не строку. Разницы для
// внешнего поведения нет: любой Date автоматически превращается в ISO-строку при
// res.json()/JSON.stringify, а `new Date(x)` — no-op-клон, если x уже Date. Но если
// где-то понадобится вызвать строковый метод (например, .slice(0, 10)) напрямую на таком
// поле до сериализации — сначала оберните его в `new Date(...)`.
import { CancelReasonCode, DealClassification, TaskType, UserRole } from "../domain/statusCodes";

export interface UserRow {
  email: string;
  full_name: string;
  role: UserRole;
  trade_point: string | null;
  password_hash: string;
  active: boolean;
  created_at: string;
}

export interface DealRow {
  deal_id: string;
  created_at: string;
  status_changed_at: string;
  source_stage: string;
  classification: DealClassification;
  // pg возвращает numeric как строку при прямом SELECT, но как число, когда колонка
  // проходит через row_to_json() (например, в join'ах задачника) — учитываем оба случая.
  amount: number | string | null;
  kc_operator_email: string;
  trade_point: string;
  tt_employee: string;
  transferred_at: string | null;
  cancel_reason_code: CancelReasonCode | null;
  cancel_comment: string | null;
  client_phone: string;
  client_name: string;
  product_group: string | null;
  channel: string | null;
  deleted_at: string | null;
  updated_at: string;
}

export interface TaskRow {
  task_id: string;
  deal_id: string;
  type: TaskType;
  status: string;
  assigned_operator_email: string;
  priority_score: string;
  next_touch_date: string | null;
  touches_count: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface TouchRow {
  touch_id: string;
  task_id: string;
  happened_at: string;
  operator_email: string;
  result_code: string;
  comment: string;
}

export interface ImportBatchRow {
  batch_id: string;
  uploaded_at: string;
  uploaded_by: string;
  original_filename: string;
  rows_total: number;
  rows_new: number;
  rows_updated: number;
  rows_errors: number;
  errors_detail: ImportRowError[];
}

export interface ImportRowError {
  row_number: number;
  reason: string;
}

export interface AuditLogRow {
  log_id: string;
  timestamp: string;
  user_email: string;
  action: string;
}

// Задача вместе с данными сделки — форма, которую видит фронтенд в списках и карточке.
export interface TaskWithDeal extends TaskRow {
  deal: DealRow;
  operator_full_name: string | null;
}
