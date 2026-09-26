import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import { runMigrations } from "../src/db/migrate";
import { setupProductionAdminIfNeeded } from "../src/db/seed";

// This integration test never falls back to DATABASE_URL. Its only database writes
// are inside a uniquely named schema that is dropped in the finally block.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const bootstrap = {
  initialAdminEmail: "  OWNER@example.com ",
  initialAdminPassword: "A-long-unique-bootstrap-password-26!",
  initialAdminName: "  First Admin  ",
};

const DEMO_USER_EMAIL = "admin@demo.laparet.local";
const DEMO_DEAL_ID = "DEMO-C-001";
const REAL_USER_EMAIL = "operator@example.com";
const REAL_DEAL_ID = "REAL-DEAL-001";

test(
  "concurrent PostgreSQL migration attempts apply each migration once",
  { skip: !testDatabaseUrl, timeout: 30_000 },
  async () => {
    assert.ok(testDatabaseUrl);
    const adminPool = new Pool({ connectionString: testDatabaseUrl, max: 2 });
    const schema = `migration_concurrent_${randomUUID().replaceAll("-", "")}`;
    const migrationDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "migration-concurrent-"),
    );
    let schemaCreated = false;
    let schemaPool: Pool | undefined;

    try {
      await adminPool.query(`CREATE SCHEMA "${schema}"`);
      schemaCreated = true;
      schemaPool = new Pool({
        connectionString: testDatabaseUrl,
        options: `-c search_path=${schema}`,
        max: 2,
      });
      fs.writeFileSync(
        path.join(migrationDirectory, "001_concurrent.sql"),
        `SELECT pg_sleep(1);
         CREATE TABLE concurrent_migration_probe (id integer PRIMARY KEY);
         INSERT INTO concurrent_migration_probe (id) VALUES (1);`,
      );

      const outcomes = await Promise.allSettled([
        runMigrations(schemaPool, migrationDirectory),
        runMigrations(schemaPool, migrationDirectory),
      ]);
      assert.deepEqual(
        outcomes.filter((outcome) => outcome.status === "rejected"),
        [],
        "both migration attempts should complete successfully",
      );

      const versions = await schemaPool.query<{ version: string }>(
        "SELECT version FROM schema_migrations ORDER BY version",
      );
      assert.deepEqual(versions.rows, [{ version: "001_concurrent.sql" }]);

      const probeRows = await schemaPool.query<{ id: number }>(
        "SELECT id FROM concurrent_migration_probe ORDER BY id",
      );
      assert.deepEqual(probeRows.rows, [{ id: 1 }]);

      const tables = await schemaPool.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
      );
      assert.deepEqual(tables.rows, [
        { table_name: "concurrent_migration_probe" },
        { table_name: "schema_migrations" },
      ]);
    } finally {
      try {
        await schemaPool?.end();
      } finally {
        try {
          if (schemaCreated) {
            await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
            const remainingSchema = await adminPool.query<{ exists: boolean }>(
              "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS exists",
              [schema],
            );
            assert.equal(remainingSchema.rows[0].exists, false);
          }
        } finally {
          try {
            fs.rmSync(migrationDirectory, { recursive: true, force: true });
          } finally {
            await adminPool.end();
          }
        }
      }
    }
  },
);

test(
  "failed PostgreSQL migrations roll back schema changes and leave no version record",
  { skip: !testDatabaseUrl, timeout: 30_000 },
  async () => {
    assert.ok(testDatabaseUrl);
    const adminPool = new Pool({ connectionString: testDatabaseUrl, max: 2 });
    const schema = `migration_failure_${randomUUID().replaceAll("-", "")}`;
    const migrationDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "migration-failure-"),
    );
    let schemaCreated = false;
    let schemaPool: Pool | undefined;

    try {
      await adminPool.query(`CREATE SCHEMA "${schema}"`);
      schemaCreated = true;
      schemaPool = new Pool({
        connectionString: testDatabaseUrl,
        options: `-c search_path=${schema}`,
        max: 1,
      });
      fs.writeFileSync(
        path.join(migrationDirectory, "001_failing.sql"),
        `CREATE TABLE migration_rollback_probe (id integer PRIMARY KEY);
         INSERT INTO migration_rollback_probe (id) VALUES (1);
         INSERT INTO migration_rollback_probe (id) VALUES (1);`,
      );

      await assert.rejects(
        runMigrations(schemaPool, migrationDirectory),
        /Не удалось применить миграцию 001_failing\.sql/,
      );

      const probe = await schemaPool.query<{ table_name: string | null }>(
        "SELECT to_regclass('migration_rollback_probe')::text AS table_name",
      );
      assert.equal(probe.rows[0].table_name, null);
      const migrations = await schemaPool.query<{ version: string }>(
        "SELECT version FROM schema_migrations",
      );
      assert.deepEqual(migrations.rows, []);
    } finally {
      try {
        await schemaPool?.end();
      } finally {
        try {
          if (schemaCreated) {
            await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
            const remainingSchema = await adminPool.query<{ exists: boolean }>(
              "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS exists",
              [schema],
            );
            assert.equal(remainingSchema.rows[0].exists, false);
          }
        } finally {
          try {
            fs.rmSync(migrationDirectory, { recursive: true, force: true });
          } finally {
            await adminPool.end();
          }
        }
      }
    }
  },
);

test(
  "production bootstrap works against migrated PostgreSQL schema and rolls back invalid settings",
  { skip: !testDatabaseUrl, timeout: 30_000 },
  async (t) => {
    assert.ok(testDatabaseUrl);
    const adminPool = new Pool({ connectionString: testDatabaseUrl, max: 2 });
    const schema = `seed_integration_${randomUUID().replaceAll("-", "")}`;
    let schemaCreated = false;
    let schemaPool: Pool | undefined;

    try {
      await adminPool.query(`CREATE SCHEMA "${schema}"`);
      schemaCreated = true;
      schemaPool = new Pool({
        connectionString: testDatabaseUrl,
        options: `-c search_path=${schema}`,
        max: 3,
      });

      const activeSchema = await schemaPool.query<{ schema: string }>(
        "SELECT current_schema() AS schema",
      );
      assert.equal(activeSchema.rows[0].schema, schema);

      await runMigrations(schemaPool);
      const migrations = await schemaPool.query<{ version: string }>(
        "SELECT version FROM schema_migrations ORDER BY version",
      );
      assert.deepEqual(
        migrations.rows.map(({ version }) => version),
        ["001_init.sql", "002_sessions.sql"],
      );

      await t.test("creates the configured first administrator without demo data", async () => {
        await setupProductionAdminIfNeeded(
          schemaPool!,
          bootstrap,
          async (password) => `test-hash:${password}`,
        );

        const users = await schemaPool!.query(
          `SELECT email, full_name, role, trade_point, password_hash FROM users`,
        );
        assert.deepEqual(users.rows, [
          {
            email: "owner@example.com",
            full_name: "First Admin",
            role: "admin",
            trade_point: null,
            password_hash: `test-hash:${bootstrap.initialAdminPassword}`,
          },
        ]);
        const auditEntries = await schemaPool!.query(
          "SELECT user_email FROM audit_log",
        );
        assert.deepEqual(auditEntries.rows, [{ user_email: "owner@example.com" }]);
        const sampleRecords = await schemaPool!.query(
          "SELECT (SELECT count(*) FROM deals) AS deals, (SELECT count(*) FROM tasks) AS tasks",
        );
        assert.deepEqual(sampleRecords.rows, [{ deals: "0", tasks: "0" }]);
      });

      await t.test("preserves unrelated users and records while removing legacy demo data", async () => {
        await clearSchemaData(schemaPool!);
        await insertUser(schemaPool!, REAL_USER_EMAIL, "operator");
        await insertUser(schemaPool!, DEMO_USER_EMAIL, "admin");
        await insertSession(schemaPool!, "real-session", REAL_USER_EMAIL);
        await insertSession(schemaPool!, "demo-session", DEMO_USER_EMAIL);

        const realTaskId = await insertDealWithTask(
          schemaPool!,
          REAL_DEAL_ID,
          REAL_USER_EMAIL,
        );
        const demoTaskId = await insertDealWithTask(
          schemaPool!,
          DEMO_DEAL_ID,
          DEMO_USER_EMAIL,
        );
        await insertTouch(schemaPool!, realTaskId, REAL_USER_EMAIL);
        await insertTouch(schemaPool!, demoTaskId, DEMO_USER_EMAIL);
        await schemaPool!.query(
          "INSERT INTO audit_log (user_email, action) VALUES ($1, $2)",
          [REAL_USER_EMAIL, "Existing audit record"],
        );

        await setupProductionAdminIfNeeded(
          schemaPool!,
          bootstrap,
          async (password) => `test-hash:${password}`,
        );

        const users = await schemaPool!.query<{ email: string }>(
          "SELECT email FROM users ORDER BY email",
        );
        assert.deepEqual(users.rows, [{ email: REAL_USER_EMAIL }]);
        const sessions = await schemaPool!.query<{ sid: string }>(
          "SELECT sid FROM sessions ORDER BY sid",
        );
        assert.deepEqual(sessions.rows, [{ sid: "real-session" }]);
        const deals = await schemaPool!.query<{ deal_id: string }>(
          "SELECT deal_id FROM deals ORDER BY deal_id",
        );
        assert.deepEqual(deals.rows, [{ deal_id: REAL_DEAL_ID }]);
        const tasks = await schemaPool!.query<{ deal_id: string }>(
          "SELECT deal_id FROM tasks ORDER BY deal_id",
        );
        assert.deepEqual(tasks.rows, [{ deal_id: REAL_DEAL_ID }]);
        const touches = await schemaPool!.query<{ task_id: string }>(
          "SELECT task_id FROM touches",
        );
        assert.deepEqual(touches.rows, [{ task_id: realTaskId }]);
        const auditEntries = await schemaPool!.query(
          "SELECT user_email, action FROM audit_log",
        );
        assert.deepEqual(auditEntries.rows, [
          { user_email: REAL_USER_EMAIL, action: "Existing audit record" },
        ]);
      });

      await t.test("rolls back legacy cleanup when first-admin settings are invalid", async (t) => {
        const invalidSettings = [
          {
            name: "invalid email",
            settings: {
              initialAdminEmail: "not-an-email",
              initialAdminPassword: bootstrap.initialAdminPassword,
              initialAdminName: bootstrap.initialAdminName,
            },
            error: /INITIAL_ADMIN_EMAIL must be a valid email address/,
          },
          {
            name: "short password",
            settings: {
              initialAdminEmail: "owner@example.com",
              initialAdminPassword: "short",
              initialAdminName: bootstrap.initialAdminName,
            },
            error: /INITIAL_ADMIN_PASSWORD must contain at least 16/,
          },
        ] as const;

        for (const { name, settings, error } of invalidSettings) {
          await t.test(name, async () => {
            await clearSchemaData(schemaPool!);
            await insertUser(schemaPool!, DEMO_USER_EMAIL, "admin");
            await insertSession(schemaPool!, "demo-session", DEMO_USER_EMAIL);
            const taskId = await insertDealWithTask(
              schemaPool!,
              DEMO_DEAL_ID,
              DEMO_USER_EMAIL,
            );
            await insertTouch(schemaPool!, taskId, DEMO_USER_EMAIL);
            await schemaPool!.query(
              "INSERT INTO audit_log (user_email, action) VALUES ($1, $2)",
              [DEMO_USER_EMAIL, "Existing audit record"],
            );

            await assert.rejects(
              setupProductionAdminIfNeeded(schemaPool!, settings),
              error,
            );

            assert.deepEqual(
              (await schemaPool!.query("SELECT email FROM users")).rows,
              [{ email: DEMO_USER_EMAIL }],
            );
            assert.equal(
              (await schemaPool!.query("SELECT count(*) FROM sessions")).rows[0].count,
              "1",
            );
            assert.equal(
              (await schemaPool!.query("SELECT count(*) FROM deals")).rows[0].count,
              "1",
            );
            assert.equal(
              (await schemaPool!.query("SELECT count(*) FROM tasks")).rows[0].count,
              "1",
            );
            assert.equal(
              (await schemaPool!.query("SELECT count(*) FROM touches")).rows[0].count,
              "1",
            );
            assert.deepEqual(
              (await schemaPool!.query("SELECT user_email, action FROM audit_log")).rows,
              [{ user_email: DEMO_USER_EMAIL, action: "Existing audit record" }],
            );
          });
        }
      });
    } finally {
      try {
        await schemaPool?.end();
        if (schemaCreated) {
          await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
        }
      } finally {
        await adminPool.end();
      }
    }
  },
);

async function clearSchemaData(database: Pool): Promise<void> {
  await database.query(
    "TRUNCATE TABLE sessions, touches, tasks, deals, users, audit_log RESTART IDENTITY CASCADE",
  );
}

async function insertUser(database: Pool, email: string, role: string): Promise<void> {
  await database.query(
    `INSERT INTO users (email, full_name, role, trade_point, password_hash)
     VALUES ($1, $2, $3, NULL, $4)`,
    [email, "Test User", role, "test-hash"],
  );
}

async function insertSession(database: Pool, sid: string, email: string): Promise<void> {
  await database.query(
    "INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, now() + interval '1 day')",
    [sid, JSON.stringify({ user: { email } })],
  );
}

async function insertDealWithTask(
  database: Pool,
  dealId: string,
  email: string,
): Promise<string> {
  await database.query(
    `INSERT INTO deals (
       deal_id, created_at, status_changed_at, source_stage, classification, amount,
       kc_operator_email, trade_point, tt_employee, client_phone, client_name
     ) VALUES ($1, CURRENT_DATE, CURRENT_DATE, 'Test stage', 'обычная', 1000,
       $2, 'Test point', 'Test employee', '+1 555 0100', 'Test Client')`,
    [dealId, email],
  );
  const result = await database.query<{ task_id: string }>(
    `INSERT INTO tasks (
       deal_id, type, status, assigned_operator_email, priority_score, touches_count
     ) VALUES ($1, 'cancellation', 'NEW', $2, 1, 0)
     RETURNING task_id`,
    [dealId, email],
  );
  return result.rows[0].task_id;
}

async function insertTouch(database: Pool, taskId: string, email: string): Promise<void> {
  await database.query(
    `INSERT INTO touches (task_id, operator_email, result_code, comment)
     VALUES ($1, $2, 'ANSWERED', 'Existing test touch')`,
    [taskId, email],
  );
}