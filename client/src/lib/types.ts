// Формы данных, приходящих с сервера — соответствуют server/src/types/models.ts.
export type TaskType = "cancellation" | "warm_lead";

export interface Deal {
  deal_id: string;
  created_at: string;
  status_changed_at: string;
  source_stage: string;
  classification: string;
  amount: number | string | null;
  kc_operator_email: string;
  trade_point: string;
  tt_employee: string;
  transferred_at: string | null;
  cancel_reason_code: string | null;
  cancel_comment: string | null;
  client_phone: string;
  client_name: string;
  product_group: string | null;
  channel: string | null;
}

export interface Task {
  task_id: string;
  deal_id: string;
  type: TaskType;
  status: string;
  assigned_operator_email: string;
  priority_score: string;
  next_touch_date: string | null;
  touches_count: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  deal: Deal;
  operator_full_name: string | null;
  is_stale?: boolean;
}

export interface Touch {
  touch_id: string;
  task_id: string;
  happened_at: string;
  operator_email: string;
  result_code: string;
  comment: string;
}

export interface PublicUser {
  email: string;
  full_name: string;
  role: "operator" | "kc_head" | "tt_head" | "admin";
  trade_point: string | null;
  active: boolean;
  created_at: string;
}

export interface ImportBatch {
  batch_id: string;
  uploaded_at: string;
  uploaded_by: string;
  original_filename: string;
  rows_total: number;
  rows_new: number;
  rows_updated: number;
  rows_errors: number;
  errors_detail: { row_number: number; reason: string }[];
}
