// Небольшие ручные проверки входных данных. Отдельная библиотека валидации не подключена
// намеренно (см. docs/CHANGELOG.md) — меньше версионных рисков без возможности прогнать тесты.

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// Отдельный тип ошибки «не найдено» — используется, когда пользователь не должен даже
// узнать, что запись существует (изоляция данных, критерий приёмки №5): и «нет такой
// задачи», и «есть, но это чужая задача» должны выглядеть для клиента одинаково.
export class NotFoundError extends Error {
  constructor(message = "Запись не найдена.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export function requireString(value: unknown, fieldLabel: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`Поле «${fieldLabel}» обязательно для заполнения.`);
  }
  return value.trim();
}

export function requireOneOf<T extends string>(value: unknown, options: readonly T[], fieldLabel: string): T {
  if (typeof value !== "string" || !(options as readonly string[]).includes(value)) {
    throw new ValidationError(`Поле «${fieldLabel}» должно быть одним из: ${options.join(", ")}.`);
  }
  return value as T;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function requireEmail(value: unknown, fieldLabel = "Email"): string {
  const email = requireString(value, fieldLabel);
  if (!EMAIL_PATTERN.test(email)) {
    throw new ValidationError(`Поле «${fieldLabel}» должно быть корректным email-адресом.`);
  }
  return email.toLowerCase();
}
