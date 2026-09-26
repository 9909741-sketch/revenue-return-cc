import { pool } from "../src/db/pool";
import { runMigrations } from "../src/db/migrate";

async function main(): Promise<void> {
  try {
    await runMigrations();
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Не удалось подготовить PostgreSQL для тестов:", error);
  process.exitCode = 1;
});