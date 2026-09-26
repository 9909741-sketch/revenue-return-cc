import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Pool } from "pg";
import { runMigrations } from "../src/db/migrate";

test("migration and rollback failures are both available for diagnosis", async () => {
  const migrationDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "migration-double-failure-"),
  );
  const migrationFailure = new Error("migration SQL failed");
  const rollbackFailure = new Error("rollback failed");
  const statements: string[] = [];

  try {
    fs.writeFileSync(
      path.join(migrationDirectory, "001_failing.sql"),
      "BROKEN MIGRATION",
    );

    const client = {
      async query(sql: string) {
        const normalizedSql = sql.trim().toLowerCase();
        statements.push(normalizedSql);

        if (normalizedSql === "broken migration") {
          throw migrationFailure;
        }
        if (normalizedSql === "rollback") {
          throw rollbackFailure;
        }
        return { rows: [] };
      },
      release() {},
    };
    const database = {
      async connect() {
        return client;
      },
    } as unknown as Pick<Pool, "connect">;

    let thrown: unknown;
    try {
      await runMigrations(database, migrationDirectory);
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown instanceof AggregateError);
    assert.deepEqual(thrown.errors, [migrationFailure, rollbackFailure]);
    assert.match(thrown.message, /migration SQL failed/);
    assert.match(thrown.message, /rollback failed/);
    assert.ok(statements.includes("rollback"));
  } finally {
    fs.rmSync(migrationDirectory, { recursive: true, force: true });
  }
});