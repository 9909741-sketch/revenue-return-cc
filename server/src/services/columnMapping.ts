// Конфигурируемый маппинг «столбец выгрузки → поле модели данных».
// Требование чёрного списка: реальные названия полей/стадий Битрикс24 не известны и не
// зашиваются в код — администратор может переопределить, какому заголовку столбца в файле
// соответствует какое поле модели, через экран /import (см. docs/BUILD_PROMPT.md, чёрный список).
import { pool } from "../db/pool";

// Поля модели deals, которые заполняются из выгрузки (без служебных deleted_at/updated_at).
export const IMPORT_FIELD_KEYS = [
  "deal_id",
  "created_at",
  "status_changed_at",
  "source_stage",
  "classification",
  "amount",
  "kc_operator_email",
  "trade_point",
  "tt_employee",
  "transferred_at",
  "cancel_reason_code",
  "cancel_comment",
  "client_phone",
  "client_name",
  "product_group",
  "channel",
] as const;
export type ImportFieldKey = (typeof IMPORT_FIELD_KEYS)[number];

// Обязательные поля по docs/PASSPORT.md, блок 5 (столбец «Обязательное»).
// Примечание: docs/SPEC.md, раздел 3 отдельно помечает «Дата передачи на ТТ» как обязательную
// для выгрузки, но PASSPORT.md как источник истины по модели данных помечает это поле
// необязательным (нет транзита — например, тёплый лид ещё не передан на точку) — при
// расхождении документов используется PASSPORT.md (см. docs/CHANGELOG.md).
export const REQUIRED_IMPORT_FIELDS: ImportFieldKey[] = [
  "deal_id",
  "created_at",
  "status_changed_at",
  "source_stage",
  "classification",
  "kc_operator_email",
  "trade_point",
  "tt_employee",
  "client_phone",
  "client_name",
];

// Заголовки столбцов по умолчанию — рабочее допущение (реальные названия колонок
// конкретной выгрузки Б24 не подтверждены, см. RISKS.md, пункт 1). Администратор
// меняет их на экране «Импорт выгрузки» под фактические заголовки своего файла.
export const DEFAULT_COLUMN_MAPPING: Record<ImportFieldKey, string> = {
  deal_id: "Идентификатор сделки",
  created_at: "Дата создания сделки",
  status_changed_at: "Дата изменения статуса",
  source_stage: "Текущий статус",
  classification: "Классификация сделки",
  amount: "Сумма сделки",
  kc_operator_email: "Оператор КЦ",
  trade_point: "Торговая точка",
  tt_employee: "Ответственный на ТТ",
  transferred_at: "Дата передачи на ТТ",
  cancel_reason_code: "Причина отмены",
  cancel_comment: "Комментарий к отмене",
  client_phone: "Телефон клиента",
  client_name: "Имя клиента",
  product_group: "Товарная группа",
  channel: "Канал обращения",
};

const SETTINGS_KEY = "import_column_mapping";

export async function getColumnMapping(): Promise<Record<ImportFieldKey, string>> {
  const result = await pool.query<{ value: Record<ImportFieldKey, string> }>(
    "SELECT value FROM app_settings WHERE key = $1",
    [SETTINGS_KEY],
  );
  if (result.rows.length === 0) {
    return DEFAULT_COLUMN_MAPPING;
  }
  // Подстраховка: если в будущем добавится новое поле модели, а в сохранённом маппинге
  // его ещё нет, — используем значение по умолчанию для этого конкретного поля.
  return { ...DEFAULT_COLUMN_MAPPING, ...result.rows[0].value };
}

export async function setColumnMapping(mapping: Record<ImportFieldKey, string>): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTINGS_KEY, JSON.stringify(mapping)],
  );
}
