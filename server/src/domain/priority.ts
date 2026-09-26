// Формула приоритета задачи. Источник: docs/SPEC.md, раздел 5.
// Компоненты (сумма даёт число от 0 до 100, сортировка по убыванию):
//   - сумма сделки            — вес 50%
//   - давность события        — вес 30%
//   - признак некорректной причины (R04, R06, R07, R10) — вес 20%
// Задачи старше 14 дней с момента события не удаляются, но уходят в конец очереди —
// это обеспечивается отдельным флагом isStale, а не самим числом priority_score
// (иначе большая сумма могла бы «перебить» устаревшую задачу и вернуть её наверх списка).

import { CancelReasonCode, PRIORITY_BOOSTING_REASONS } from "./statusCodes";

// Порог «крупной сделки» для нормализации суммы в долю от 0 до 1.
// В компании нет ещё фактических данных о распределении сумм (см. RISKS.md, пункт 8),
// поэтому это рабочее допущение, а не измеренная величина. Уточняется на пилоте.
export const PRIORITY_REFERENCE_MAX_AMOUNT = 150_000;

// Задачи старше этого числа дней с момента события уходят в конец очереди.
export const PRIORITY_STALE_AFTER_DAYS = 14;

export interface PriorityInput {
  amount: number | null;
  eventDate: Date;
  cancelReasonCode: CancelReasonCode | null;
  now?: Date;
}

export interface PriorityResult {
  priorityScore: number;
  isStale: boolean;
  daysSinceEvent: number;
}

function daysBetween(from: Date, to: Date): number {
  const msInDay = 24 * 60 * 60 * 1000;
  return Math.floor((to.getTime() - from.getTime()) / msInDay);
}

export function calculatePriority(input: PriorityInput): PriorityResult {
  const now = input.now ?? new Date();
  const daysSinceEvent = Math.max(0, daysBetween(input.eventDate, now));

  // Сумма сделки — 50%. Сделка без суммы (см. функцию 1) не может влиять на приоритет по деньгам.
  const amountShare = input.amount == null ? 0 : Math.min(1, input.amount / PRIORITY_REFERENCE_MAX_AMOUNT);
  const amountComponent = amountShare * 50;

  // Давность события — 30%. Чем свежее, тем выше; линейно убывает до нуля к 14-му дню.
  const recencyShare = Math.max(0, 1 - daysSinceEvent / PRIORITY_STALE_AFTER_DAYS);
  const recencyComponent = recencyShare * 30;

  // Признак некорректной причины — 20%.
  const isBoostingReason = input.cancelReasonCode != null && PRIORITY_BOOSTING_REASONS.includes(input.cancelReasonCode);
  const reasonComponent = isBoostingReason ? 20 : 0;

  const priorityScore = Math.round((amountComponent + recencyComponent + reasonComponent) * 100) / 100;
  const isStale = daysSinceEvent > PRIORITY_STALE_AFTER_DAYS;

  return { priorityScore, isStale, daysSinceEvent };
}
