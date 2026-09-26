// Простой раннер SQL-миграций без внешних библиотек.
// Применяет все .sql-файлы из папки migrations по возрастанию имени,
// запоминает применённые версии в таблице schema_migrations.
import fs from "node:fs";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { pool } from "./pool";

// Файлы миграций лежат в server/migrations — вне src/dist, чтобы быть на месте
// и в режиме разработки (tsx, __dirname = server/src/db), и после сборки
// (tsc, __dirname = server/dist/db): в обоих случаях "../../migrations" ведёт в server/migrations.
const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "migrations");
type MigrationDatabase = Pick<Pool, "connect">;
type MigrationClient = Pick<PoolClient, "query">;

async function ensureMigrationsTable(database: MigrationClient): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedVersions(database: MigrationClient): Promise<Set<string>> {
  const result = await database.query<{ version: string }>(
    "SELECT version FROM schema_migrations",
  );
  return new Set(result.rows.map((row) => row.version));
}

export async function runMigrations(
  database: MigrationDatabase = pool,
  migrationsDirectory: string = MIGRATIONS_DIR,
): Promise<void> {
  const files = fs
    .readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const client = await database.connect();
  let migrationLockAcquired = false;
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtextextended('server-migrations:' || current_schema(), 0))",
    );
    migrationLockAcquired = true;

    await ensureMigrationsTable(client);
    const applied = await getAppliedVersions(client);

    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }
      const sql = fs.readFileSync(path.join(migrationsDirectory, file), "utf-8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
        // eslint-disable-next-line no-console
        console.log(`Миграция применена: ${file}`);
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          const migrationMessage =
            error instanceof Error ? error.message : String(error);
          const rollbackMessage =
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError);
          throw new AggregateError(
            [error, rollbackError],
            `Не удалось применить миграцию ${file}: ${migrationMessage}; также не удалось выполнить откат: ${rollbackMessage}`,
          );
        }
        throw new Error(
          `Не удалось применить миграцию ${file}: ${(error as Error).message}`,
        );
      }
    }
  } finally {
    if (migrationLockAcquired) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended('server-migrations:' || current_schema(), 0))",
        );
      } catch (error) {
        client.release(error as Error);
        throw error;
      }
    }
    client.release();
  }
}
