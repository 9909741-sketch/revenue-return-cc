-- Начальная схема БД. Источник полей — docs/PASSPORT.md, блок 5.
-- Решения по составу колонок сверх блока 5 (только техническая необходимость:
-- временные метки created_at/updated_at, поле для хэша пароля, таблица настроек
-- маппинга импорта) объяснены в docs/CHANGELOG.md.

-- Генерация UUID средствами PostgreSQL.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Пользователи и роли.
CREATE TABLE IF NOT EXISTS users (
  email text PRIMARY KEY,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('operator', 'kc_head', 'tt_head', 'admin')),
  trade_point text,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Сделки из выгрузки Б24 (стабильный ключ — deal_id из Б24, не сгенерированный).
CREATE TABLE IF NOT EXISTS deals (
  deal_id text PRIMARY KEY,
  created_at date NOT NULL,
  status_changed_at date NOT NULL,
  source_stage text NOT NULL,
  classification text NOT NULL CHECK (classification IN ('обычная', 'тёплый_лид')),
  amount numeric(14, 2),
  kc_operator_email text NOT NULL,
  trade_point text NOT NULL,
  tt_employee text NOT NULL,
  transferred_at date,
  cancel_reason_code text,
  cancel_comment text,
  client_phone text NOT NULL,
  client_name text NOT NULL,
  product_group text,
  channel text,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Задачи общего задачника (тип — атрибут, не отдельная таблица, см. docs/SPEC.md, раздел 5).
CREATE TABLE IF NOT EXISTS tasks (
  task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id text NOT NULL REFERENCES deals (deal_id),
  type text NOT NULL CHECK (type IN ('cancellation', 'warm_lead')),
  status text NOT NULL,
  assigned_operator_email text NOT NULL,
  priority_score numeric(6, 2) NOT NULL DEFAULT 0,
  next_touch_date date,
  touches_count integer NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  -- Одна активная задача каждого типа на сделку: не дублируется при повторном импорте,
  -- но допускает и cancellation-, и warm_lead-задачу по одной и той же сделке одновременно
  -- (нужно для связи модулей из docs/SPEC.md, раздел 4.2).
  UNIQUE (deal_id, type)
);

CREATE INDEX IF NOT EXISTS idx_tasks_type_status ON tasks (type, status);
CREATE INDEX IF NOT EXISTS idx_tasks_operator ON tasks (assigned_operator_email);

-- Звонки/касания по задаче — история не удаляется никогда.
CREATE TABLE IF NOT EXISTS touches (
  touch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks (task_id),
  happened_at timestamptz NOT NULL DEFAULT now(),
  operator_email text NOT NULL,
  result_code text NOT NULL,
  comment text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_touches_task ON touches (task_id);

-- Журнал загрузок выгрузки.
CREATE TABLE IF NOT EXISTS import_batches (
  batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by text NOT NULL,
  original_filename text NOT NULL,
  rows_total integer NOT NULL,
  rows_new integer NOT NULL,
  rows_updated integer NOT NULL,
  rows_errors integer NOT NULL,
  errors_detail jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- Журнал действий (вход, импорт, смена статуса, изменение пользователя) — не удаляется никогда.
CREATE TABLE IF NOT EXISTS audit_log (
  log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "timestamp" timestamptz NOT NULL DEFAULT now(),
  user_email text NOT NULL,
  action text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log ("timestamp" DESC);

-- Настройки приложения: сюда пишется конфигурируемый маппинг «столбец выгрузки → поле модели
-- данных» (см. docs/BUILD_PROMPT.md, чёрный список) под ключом 'import_column_mapping'.
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
