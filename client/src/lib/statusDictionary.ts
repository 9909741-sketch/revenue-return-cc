// Словарь статусов и причин — должен дословно совпадать с сервером
// (server/src/domain/statusCodes.ts) и с docs/SPEC.md. Если меняете один файл —
// обязательно синхронизируйте второй (см. docs/CHANGELOG.md).

export const CANCELLATION_STATUS_LABELS: Record<string, string> = {
  NEW: "Новая отмена",
  WIP: "В работе",
  NO_ANSWER: "Недозвон",
  CANCEL_OK: "Отмена корректная",
  CANCEL_BAD: "Отмена некорректная",
  REPASS: "Передано повторно",
  DONE_KC: "Отработано КЦ",
  WON: "Реализовано",
};

export const CANCELLATION_STATUS_COLOR: Record<string, string> = {
  NEW: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
  WIP: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
  NO_ANSWER: "bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-50",
  CANCEL_OK: "bg-brand-error/15 text-brand-error dark:bg-brand-error/25",
  CANCEL_BAD: "bg-brand-error/25 text-brand-error dark:bg-brand-error/35",
  REPASS: "bg-brand-success/15 text-brand-success dark:bg-brand-success/25",
  DONE_KC: "bg-brand-error/15 text-brand-error dark:bg-brand-error/25",
  WON: "bg-brand-success/25 text-brand-success dark:bg-brand-success/35",
};

export const WARM_LEAD_STATUS_LABELS: Record<string, string> = {
  NEW: "Новое обращение",
  WIP: "В работе",
  PASSED_TT: "Передан на ТТ",
  NO_RESULT: "Закрыт без результата",
  WON: "Реализовано",
};

export const WARM_LEAD_STATUS_COLOR: Record<string, string> = {
  NEW: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
  WIP: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
  PASSED_TT: "bg-brand-success/15 text-brand-success dark:bg-brand-success/25",
  NO_RESULT: "bg-brand-error/15 text-brand-error dark:bg-brand-error/25",
  WON: "bg-brand-success/25 text-brand-success dark:bg-brand-success/35",
};

export const CANCEL_REASONS: Record<string, string> = {
  R01: "Клиент отказался от покупки",
  R02: "Клиент купил в другом месте",
  R03: "Нет нужного товара в наличии",
  R04: "Клиент не выходит на связь со стороны ТТ",
  R05: "Сделка-дубль",
  R06: "Отменена без связи с клиентом",
  R07: "Отменена вместо переноса срока",
  R08: "Ошибочная классификация при передаче",
  R09: "Клиент перенёс покупку на неопределённый срок",
  R10: "Причина не указана",
};

export const WARM_LEAD_REASONS: Record<string, string> = {
  W01: "Ушёл думать, повторный контакт не состоялся",
  W02: "Не устроила цена",
  W03: "Не устроили сроки поставки",
  W04: "Подбирает у нескольких поставщиков",
  W05: "Покупка отложена",
  W06: "Отказ от записи в салон",
  W07: "Отказ от передачи на ТТ",
  W08: "Клиент вне зоны обслуживания",
};

export const CALL_OUTCOME_LABELS: Record<string, string> = {
  ANSWERED: "Дозвонились",
  NO_ANSWER: "Недозвон",
  CALLBACK: "Договорились перезвонить",
};

export const USER_ROLE_LABELS: Record<string, string> = {
  operator: "Оператор КЦ",
  kc_head: "Руководитель КЦ",
  tt_head: "Руководитель ТТ",
  admin: "Администратор",
};

// Разрешённые переходы — используются, чтобы показать оператору только осмысленные
// варианты закрытия (сервер всё равно проверяет ещё раз — docs/PASSPORT.md, блок 6).
export const CANCELLATION_TRANSITIONS: Record<string, string[]> = {
  NEW: ["WIP", "NO_ANSWER"],
  NO_ANSWER: ["WIP", "CANCEL_OK", "DONE_KC"],
  WIP: ["CANCEL_OK", "CANCEL_BAD", "REPASS", "DONE_KC"],
  CANCEL_BAD: ["REPASS"],
  REPASS: ["WON"],
  CANCEL_OK: [],
  DONE_KC: [],
  WON: [],
};

export const WARM_LEAD_TRANSITIONS: Record<string, string[]> = {
  NEW: ["WIP"],
  WIP: ["PASSED_TT", "NO_RESULT", "WON"],
  PASSED_TT: [],
  NO_RESULT: [],
  WON: [],
};
