// Единый пул подключений к PostgreSQL.
import { Pool } from "pg";
import { env } from "../env";

export const pool = new Pool({
  connectionString: env.databaseUrl,
  // Небольшой пул достаточен для внутреннего инструмента КЦ (не публичный высоконагруженный сервис).
  max: 10,
});

pool.on("error", (err) => {
  // Ошибка в фоновом (простаивающем) соединении пула — не должна ронять процесс молча.
  // eslint-disable-next-line no-console
  console.error("Неожиданная ошибка соединения с PostgreSQL:", err);
});
