// Загрузка и проверка переменных окружения.
// Источник требований — docs/PASSPORT.md, блок 8.
import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // По паспорту: «Приложение не стартует, ошибка в логах» — так и делаем.
    // eslint-disable-next-line no-console
    console.error(`Не задана обязательная переменная окружения ${name}. Смотрите .env.example.`);
    process.exit(1);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT) || 3001,
  databaseUrl: requireEnv("DATABASE_URL"),
  sessionSecret: requireEnv("SESSION_SECRET"),
  // Необязательная переменная: если не задана, функция восстановления недоступна (см. README).
  adminRecoveryCode: process.env.ADMIN_RECOVERY_CODE || null,
  // Одноразовые данные для создания первого администратора на пустой production-базе.
  initialAdminEmail: process.env.INITIAL_ADMIN_EMAIL || null,
  initialAdminPassword: process.env.INITIAL_ADMIN_PASSWORD || null,
  initialAdminName: process.env.INITIAL_ADMIN_NAME || null,
  nodeEnv: process.env.NODE_ENV || "development",
};
