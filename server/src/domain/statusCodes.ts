// Единый источник статусов и справочников причин.
// Коды здесь и их дословные тексты нельзя менять — они входят в критерии
// приёмки №7 и №8 (docs/ACCEPTANCE.md) и должны совпадать в БД, API и интерфейсе.
// Идентичный по смыслу словарь на фронтенде: client/src/lib/statusDictionary.ts —
// если меняете коды здесь, обязательно синхронизируйте там.

// --- Типы задач в общем задачнике ---
export type TaskType = "cancellation" | "warm_lead";

// --- Статусы модуля 1 «Отмены» (docs/SPEC.md, раздел 4.1) ---
export const CANCELLATION_STATUSES = [
  "NEW",
  "WIP",
  "NO_ANSWER",
  "CANCEL_OK",
  "CANCEL_BAD",
  "REPASS",
  "DONE_KC",
  "WON",
] as const;
export type CancellationStatus = (typeof CANCELLATION_STATUSES)[number];

// Финальные статусы отмены — задача больше не в очереди на обзвон.
export const CANCELLATION_FINAL_STATUSES: CancellationStatus[] = [
  "CANCEL_OK",
  "DONE_KC",
  "WON",
];

// Переходы модуля 1: ключ — текущий статус, значение — разрешённые следующие.
export const CANCELLATION_TRANSITIONS: Record<CancellationStatus, CancellationStatus[]> = {
  NEW: ["WIP", "NO_ANSWER"],
  NO_ANSWER: ["WIP", "CANCEL_OK", "DONE_KC"],
  // По mermaid-диаграмме docs/SPEC.md (раздел 4.1) из WIP нет обратного перехода в NO_ANSWER.
  WIP: ["CANCEL_OK", "CANCEL_BAD", "REPASS", "DONE_KC"],
  CANCEL_BAD: ["REPASS"],
  REPASS: ["WON"],
  CANCEL_OK: [],
  DONE_KC: [],
  WON: [],
};

// Статусы, для перехода в которые обязателен минимум 1 зафиксированный touch (критерий приёмки №7).
export const CANCELLATION_REQUIRES_TOUCH: CancellationStatus[] = ["REPASS", "WON"];

// --- Статусы модуля 2 «Тёплые лиды» (docs/SPEC.md, раздел 4.2) ---
export const WARM_LEAD_STATUSES = ["NEW", "WIP", "PASSED_TT", "NO_RESULT", "WON"] as const;
export type WarmLeadStatus = (typeof WARM_LEAD_STATUSES)[number];

export const WARM_LEAD_FINAL_STATUSES: WarmLeadStatus[] = ["PASSED_TT", "NO_RESULT", "WON"];

export const WARM_LEAD_TRANSITIONS: Record<WarmLeadStatus, WarmLeadStatus[]> = {
  NEW: ["WIP"],
  WIP: ["PASSED_TT", "NO_RESULT", "WON"],
  PASSED_TT: [],
  NO_RESULT: [],
  WON: [],
};

// --- Справочник причин отмены сделки на ТТ (R01–R10), docs/SPEC.md, приложение «Справочники» ---
export type CancelReasonCode =
  | "R01"
  | "R02"
  | "R03"
  | "R04"
  | "R05"
  | "R06"
  | "R07"
  | "R08"
  | "R09"
  | "R10";

export const CANCEL_REASONS: Record<CancelReasonCode, { text: string; class: string }> = {
  R01: { text: "Клиент отказался от покупки", class: "Корректная" },
  R02: { text: "Клиент купил в другом месте", class: "Корректная" },
  R03: { text: "Нет нужного товара в наличии", class: "Условно корректная" },
  R04: { text: "Клиент не выходит на связь со стороны ТТ", class: "Некорректная до подтверждения" },
  R05: { text: "Сделка-дубль", class: "Техническая" },
  R06: { text: "Отменена без связи с клиентом", class: "Некорректная" },
  R07: { text: "Отменена вместо переноса срока", class: "Некорректная" },
  R08: { text: "Ошибочная классификация при передаче", class: "Техническая" },
  R09: { text: "Клиент перенёс покупку на неопределённый срок", class: "Условно корректная" },
  R10: { text: "Причина не указана", class: "Некорректная по умолчанию" },
};

// Коды причин, повышающие приоритет задачи (docs/SPEC.md, раздел 5 — вес 20%).
export const PRIORITY_BOOSTING_REASONS: CancelReasonCode[] = ["R04", "R06", "R07", "R10"];

// --- Справочник причин закрытия тёплого лида без результата (W01–W08) ---
export type WarmLeadReasonCode =
  | "W01"
  | "W02"
  | "W03"
  | "W04"
  | "W05"
  | "W06"
  | "W07"
  | "W08";

export const WARM_LEAD_REASONS: Record<WarmLeadReasonCode, string> = {
  W01: "Ушёл думать, повторный контакт не состоялся",
  W02: "Не устроила цена",
  W03: "Не устроили сроки поставки",
  W04: "Подбирает у нескольких поставщиков",
  W05: "Покупка отложена",
  W06: "Отказ от записи в салон",
  W07: "Отказ от передачи на ТТ",
  W08: "Клиент вне зоны обслуживания",
};

// --- Классификация сделки из выгрузки Б24 ---
export type DealClassification = "обычная" | "тёплый_лид";

// --- Роли пользователей (docs/PASSPORT.md, блок 6) ---
export const USER_ROLES = ["operator", "kc_head", "tt_head", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  operator: "Оператор КЦ",
  kc_head: "Руководитель КЦ",
  tt_head: "Руководитель ТТ",
  admin: "Администратор",
};

// --- Исход попытки звонка для промежуточного touch (не закрывающего задачу) ---
// В SPEC отдельного словаря для этого нет (см. docs/CHANGELOG.md, решение по touches.result_code).
export const CALL_OUTCOMES = ["ANSWERED", "NO_ANSWER", "CALLBACK"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  ANSWERED: "Дозвонились",
  NO_ANSWER: "Недозвон",
  CALLBACK: "Договорились перезвонить",
};

export function isCancellationStatus(value: string): value is CancellationStatus {
  return (CANCELLATION_STATUSES as readonly string[]).includes(value);
}

export function isWarmLeadStatus(value: string): value is WarmLeadStatus {
  return (WARM_LEAD_STATUSES as readonly string[]).includes(value);
}
