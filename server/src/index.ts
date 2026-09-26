// Точка входа сервера. Применяет миграции, инициализирует демо-данные в разработке
// или первого администратора в production, затем слушает 0.0.0.0:PORT.
import { env } from "./env";
import { runMigrations } from "./db/migrate";
import { pool } from "./db/pool";
import { initializeUserData } from "./db/seed";
import { createSession } from "./session";
import { createApp } from "./app";

async function main(): Promise<void> {
  await runMigrations();
  await initializeUserData(env.nodeEnv);

  const sessionMiddleware = createSession(
    pool,
    env.sessionSecret,
    env.nodeEnv === "production",
  ).middleware;
  const app = createApp(sessionMiddleware);

  app.listen(env.port, "0.0.0.0", () => {
    // eslint-disable-next-line no-console
    console.log(`Сервер «Возврат выручки контакт-центра» слушает http://0.0.0.0:${env.port}`);
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Не удалось запустить сервер:", error);
  process.exit(1);
});
