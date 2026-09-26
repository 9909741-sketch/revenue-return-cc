// График повторных касаний для тёплых лидов. Источник: docs/SPEC.md, раздел 5.
// «график на 3, 7, 14 и 30 день от обращения; после 4-го касания без результата —
// автозакрытие в NO_RESULT с обязательной причиной W01–W08».
//
// baseDate — дата обращения клиента (используется deals.created_at, см. docs/CHANGELOG.md).
// touchesCountAfter — сколько касаний зафиксировано ПОСЛЕ текущего действия (1..4).

export const WARM_LEAD_TOUCH_SCHEDULE_DAYS = [3, 7, 14, 30] as const;
export const WARM_LEAD_MAX_TOUCHES_BEFORE_AUTOCLOSE = 4;

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Возвращает дату следующего планового касания или null, если график исчерпан
 * (это сигнал для автозакрытия в NO_RESULT).
 *
 * touchesCountAfter = 0 (ещё ни одного касания) → день 3 (индекс 0 в графике);
 * touchesCountAfter = 1 (одно касание позади) → день 7 (индекс 1); и так далее.
 */
export function computeNextTouchDate(baseDate: Date, touchesCountAfter: number): Date | null {
  const nextScheduleDay = WARM_LEAD_TOUCH_SCHEDULE_DAYS[touchesCountAfter];
  if (touchesCountAfter >= WARM_LEAD_MAX_TOUCHES_BEFORE_AUTOCLOSE || nextScheduleDay === undefined) {
    return null;
  }
  return addDays(baseDate, nextScheduleDay);
}

/** true, если это касание — четвёртое (значит, при отсутствии результата — автозакрытие). */
export function isAutocloseTouch(touchesCountAfter: number): boolean {
  return touchesCountAfter >= WARM_LEAD_MAX_TOUCHES_BEFORE_AUTOCLOSE;
}
