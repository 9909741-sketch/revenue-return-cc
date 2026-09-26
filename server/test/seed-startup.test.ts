import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import {
  initializeUserData,
  seedDemoDataIfEmpty,
  setupProductionAdminIfNeeded,
} from "../src/db/seed";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (process.env.NODE_ENV === "production" && !process.env.TEST_DATABASE_URL) {
  throw new Error(
    "Refusing to run production seed tests against DATABASE_URL; set TEST_DATABASE_URL.",
  );
}

type TestUser = {
  email: string;
  full_name: string;
  role: string;
  trade_point: string | null;
  password_hash: string;
};

type TestSession = {
  sess: { user: { email: string } };
};

type ProductionState = {
  users: TestUser[];
  sessions: TestSession[];
  deals: string[];
  tasks: { task_id: string; deal_id: string }[];
  touches: { task_id: string }[];
  auditLog: { user_email: string; action: string }[];
};

class FakeProductionDatabase {
  state: ProductionState = {
    users: [],
    sessions: [],
    deals: [],
    tasks: [],
    touches: [],
    auditLog: [],
  };
  readonly queries: { sql: string; values: unknown[] }[] = [];
  commits = 0;
  rollbacks = 0;
  releases = 0;
  private transactionSnapshot: ProductionState | null = null;

  readonly query = async (
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: unknown[] }> => {
    const normalizedSql = sql.replace(/\s+/g, " ").trim().toLowerCase();
    this.queries.push({ sql: normalizedSql, values });

    if (normalizedSql === "begin") {
      this.transactionSnapshot = structuredClone(this.state);
    } else if (normalizedSql === "commit") {
      this.commits += 1;
      this.transactionSnapshot = null;
    } else if (normalizedSql === "rollback") {
      this.rollbacks += 1;
      assert.ok(this.transactionSnapshot, "rollback should have an open transaction");
      this.state = this.transactionSnapshot;
      this.transactionSnapshot = null;
    } else if (normalizedSql.startsWith("delete from sessions")) {
      const emails = values[0] as string[];
      this.state.sessions = this.state.sessions.filter(
        (session) => !emails.includes(session.sess.user.email),
      );
    } else if (normalizedSql.startsWith("delete from touches")) {
      const dealIds = values[0] as string[];
      const taskIds = new Set(
        this.state.tasks
          .filter((task) => dealIds.includes(task.deal_id))
          .map((task) => task.task_id),
      );
      this.state.touches = this.state.touches.filter(
        (touch) => !taskIds.has(touch.task_id),
      );
    } else if (normalizedSql.startsWith("delete from tasks")) {
      const dealIds = values[0] as string[];
      this.state.tasks = this.state.tasks.filter(
        (task) => !dealIds.includes(task.deal_id),
      );
    } else if (normalizedSql.startsWith("delete from deals")) {
      const dealIds = values[0] as string[];
      this.state.deals = this.state.deals.filter((dealId) => !dealIds.includes(dealId));
    } else if (normalizedSql.startsWith("delete from users")) {
      const emails = values[0] as string[];
      this.state.users = this.state.users.filter((user) => !emails.includes(user.email));
    } else if (normalizedSql === "select count(*) from users") {
      return { rows: [{ count: String(this.state.users.length) }] };
    } else if (normalizedSql.startsWith("insert into users")) {
      const [email, fullName, passwordHash] = values as [
        string,
        string,
        string,
      ];
      this.state.users.push({
        email,
        full_name: fullName,
        role: "admin",
        trade_point: null,
        password_hash: passwordHash,
      });
    } else if (normalizedSql.startsWith("insert into audit_log")) {
      const [user_email, action] = values as [string, string];
      this.state.auditLog.push({ user_email, action });
    } else if (!normalizedSql.startsWith("select pg_advisory_xact_lock")) {
      assert.fail(`Unexpected production setup query: ${normalizedSql}`);
    }

    return { rows: [] };
  };

  async connect(): Promise<{
    query: typeof this.query;
    release: () => void;
  }> {
    return {
      query: this.query,
      release: () => {
        this.releases += 1;
      },
    };
  }

  asPool(): Parameters<typeof setupProductionAdminIfNeeded>[0] {
    return this as unknown as Pool;
  }
}

class FakeDevelopmentPool {
  readonly users: unknown[][] = [];
  readonly deals: unknown[][] = [];
  readonly tasks: unknown[][] = [];
  readonly touches: unknown[][] = [];
  readonly auditLog: unknown[][] = [];
  private nextTaskId = 1;

  readonly query = async (
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: unknown[] }> => {
    const normalizedSql = sql.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalizedSql === "select count(*) from users") {
      return { rows: [{ count: "0" }] };
    }
    if (normalizedSql.startsWith("insert into users")) {
      this.users.push(values);
    } else if (normalizedSql.startsWith("insert into deals")) {
      this.deals.push(values);
    } else if (normalizedSql.startsWith("insert into tasks")) {
      this.tasks.push(values);
      return { rows: [{ task_id: `task-${this.nextTaskId++}` }] };
    } else if (normalizedSql.startsWith("insert into touches")) {
      this.touches.push(values);
    } else if (normalizedSql.startsWith("insert into audit_log")) {
      this.auditLog.push(values);
    } else {
      assert.fail(`Unexpected development seed query: ${normalizedSql}`);
    }

    return { rows: [] };
  };

  asPool(): Pick<Pool, "query"> {
    return this as unknown as Pick<Pool, "query">;
  }
}

const DEMO_EMAILS = [
  "operator@demo.laparet.local",
  "kc-head@demo.laparet.local",
  "admin@demo.laparet.local",
];
const SAMPLE_DEAL_IDS = [
  "DEMO-C-001",
  "DEMO-C-002",
  "DEMO-C-003",
  "DEMO-C-004",
  "DEMO-C-005",
  "DEMO-W-001",
  "DEMO-W-002",
  "DEMO-W-003",
  "DEMO-W-004",
  "DEMO-W-005",
];

async function waitForTestSignal(
  signal: Promise<void>,
  failureMessage: string,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      signal,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(failureMessage)), 10_000);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function waitForPostgresAdvisoryWait(pool: Pool, backendPid: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{
      wait_event_type: string | null;
      wait_event: string | null;
    }>(
      `SELECT wait_event_type, wait_event
       FROM pg_stat_activity
       WHERE pid = $1`,
      [backendPid],
    );
    if (
      result.rows[0]?.wait_event_type === "Lock" &&
      result.rows[0]?.wait_event === "advisory"
    ) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The second PostgreSQL backend did not wait on the advisory lock.");
}

test("startup selects only production setup in production and only demo seeding in development", async () => {
  const calls: string[] = [];
  await initializeUserData(
    "production",
    async () => {
      calls.push("production");
    },
    async () => {
      calls.push("development");
    },
  );
  assert.deepEqual(calls, ["production"]);

  calls.length = 0;
  await initializeUserData(
    "development",
    async () => {
      calls.push("production");
    },
    async () => {
      calls.push("development");
    },
  );
  assert.deepEqual(calls, ["development"]);
});

test("empty production setup creates one administrator without demo accounts or sample records", async () => {
  const database = new FakeProductionDatabase();
  await setupProductionAdminIfNeeded(
    database.asPool(),
    {
      initialAdminEmail: "  OWNER@example.com ",
      initialAdminPassword: "A-long-unique-bootstrap-password-26!",
      initialAdminName: "  First Admin  ",
    },
    async (password) => `hash:${password}`,
  );

  assert.deepEqual(
    database.state.users.map(({ email, full_name, role, trade_point, password_hash }) => ({
      email,
      full_name,
      role,
      trade_point,
      password_hash,
    })),
    [
      {
        email: "owner@example.com",
        full_name: "First Admin",
        role: "admin",
        trade_point: null,
        password_hash: "hash:A-long-unique-bootstrap-password-26!",
      },
    ],
  );
  assert.deepEqual(database.state.deals, []);
  assert.deepEqual(database.state.tasks, []);
  assert.deepEqual(database.state.touches, []);
  assert.equal(database.state.auditLog.length, 1);
  assert.equal(database.commits, 1);
  assert.equal(database.rollbacks, 0);
  assert.equal(database.releases, 1);
});

test(
  "simultaneous production starts create one administrator using PostgreSQL advisory locking",
  { skip: !databaseUrl, timeout: 30_000 },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 3 });
    const schema = `seed_startup_${randomUUID().replaceAll("-", "")}`;
    let schemaCreated = false;

    try {
      await pool.query(`CREATE SCHEMA "${schema}"`);
      schemaCreated = true;
      await pool.query(`
        CREATE TABLE "${schema}".users (
          email text PRIMARY KEY,
          full_name text NOT NULL,
          role text NOT NULL,
          trade_point text,
          password_hash text NOT NULL
        );
        CREATE TABLE "${schema}".sessions (sess json);
        CREATE TABLE "${schema}".deals (deal_id text PRIMARY KEY);
        CREATE TABLE "${schema}".tasks (task_id uuid, deal_id text);
        CREATE TABLE "${schema}".touches (task_id uuid);
        CREATE TABLE "${schema}".audit_log (user_email text, action text)
      `);

      let signalFirstHashStarted!: () => void;
      const firstHashStarted = new Promise<void>((resolve) => {
        signalFirstHashStarted = resolve;
      });
      let releaseFirstHash!: () => void;
      const firstHashGate = new Promise<void>((resolve) => {
        releaseFirstHash = resolve;
      });
      let signalSecondLockQuery!: () => void;
      const secondLockQueryStarted = new Promise<void>((resolve) => {
        signalSecondLockQuery = resolve;
      });
      let secondBackendPid: number | undefined;
      let advisoryLockCalls = 0;
      let passwordHashCalls = 0;

      const startupDatabase = {
        connect: async () => {
          const client = await pool.connect();
          let backendPid: number;
          try {
            await client.query(`SET search_path TO "${schema}"`);
            const backendPidResult = await client.query<{ pid: number }>(
              "SELECT pg_backend_pid() AS pid",
            );
            backendPid = backendPidResult.rows[0].pid;
          } catch (error) {
            client.release();
            throw error;
          }

          return {
            query: (sql: string, values?: unknown[]) => {
              if (sql.includes("pg_advisory_xact_lock")) {
                advisoryLockCalls += 1;
                if (advisoryLockCalls === 2) {
                  secondBackendPid = backendPid;
                  signalSecondLockQuery();
                }
              }
              return client.query(sql, values as never);
            },
            release: () => client.release(),
          };
        },
      };
      const bootstrap = {
        initialAdminEmail: "first-admin@example.com",
        initialAdminPassword: "A-long-unique-bootstrap-password-26!",
        initialAdminName: "First Admin",
      };
      const hasher = async (password: string) => {
        passwordHashCalls += 1;
        signalFirstHashStarted();
        await firstHashGate;
        return `hash:${password}`;
      };
      const attempts: Promise<void>[] = [];
      let orchestrationError: unknown;

      try {
        const firstAttempt = setupProductionAdminIfNeeded(
          startupDatabase as unknown as Parameters<typeof setupProductionAdminIfNeeded>[0],
          bootstrap,
          hasher,
        );
        attempts.push(firstAttempt);
        await Promise.race([
          firstHashStarted,
          firstAttempt.then(() => {
            throw new Error("The first startup finished before hashing its initial admin.");
          }),
        ]);

        const secondAttempt = setupProductionAdminIfNeeded(
          startupDatabase as unknown as Parameters<typeof setupProductionAdminIfNeeded>[0],
          bootstrap,
          hasher,
        );
        attempts.push(secondAttempt);
        await waitForTestSignal(
          secondLockQueryStarted,
          "The second startup did not reach the PostgreSQL advisory lock.",
        );
        assert.ok(secondBackendPid, "the second startup should have a PostgreSQL backend");
        await waitForPostgresAdvisoryWait(pool, secondBackendPid);
      } catch (error) {
        orchestrationError = error;
      } finally {
        releaseFirstHash();
      }

      const outcomes = await Promise.allSettled(attempts);
      if (orchestrationError) {
        throw orchestrationError;
      }
      assert.equal(attempts.length, 2, "both startup attempts should have started");
      assert.deepEqual(
        outcomes.map((outcome) => outcome.status),
        ["fulfilled", "fulfilled"],
        "both startup attempts should finish successfully",
      );
      assert.equal(advisoryLockCalls, 2, "both starts should request the PostgreSQL lock");
      assert.equal(passwordHashCalls, 1, "only the lock holder should create an admin");

      const administrators = await pool.query(
        `SELECT email, role FROM "${schema}".users`,
      );
      assert.deepEqual(administrators.rows, [
        { email: "first-admin@example.com", role: "admin" },
      ]);
      const auditEntries = await pool.query(
        `SELECT user_email FROM "${schema}".audit_log`,
      );
      assert.deepEqual(auditEntries.rows, [{ user_email: "first-admin@example.com" }]);
    } finally {
      try {
        if (schemaCreated) {
          await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
        }
      } finally {
        await pool.end();
      }
    }
  },
);

test("empty production setup fails safely for missing, invalid, or short bootstrap settings", async (t) => {
  const invalidSettings = [
    {
      name: "missing email",
      settings: {
        initialAdminEmail: null,
        initialAdminPassword: "A-long-unique-bootstrap-password-26!",
        initialAdminName: null,
      },
    },
    {
      name: "missing password",
      settings: {
        initialAdminEmail: "owner@example.com",
        initialAdminPassword: null,
        initialAdminName: null,
      },
    },
    {
      name: "invalid email",
      settings: {
        initialAdminEmail: "not-an-email",
        initialAdminPassword: "A-long-unique-bootstrap-password-26!",
        initialAdminName: null,
      },
    },
    {
      name: "short password",
      settings: {
        initialAdminEmail: "owner@example.com",
        initialAdminPassword: "short",
        initialAdminName: null,
      },
    },
    {
      name: "whitespace-only password",
      settings: {
        initialAdminEmail: "owner@example.com",
        initialAdminPassword: "                ",
        initialAdminName: null,
      },
    },
  ] as const;

  for (const { name, settings } of invalidSettings) {
    await t.test(name, async () => {
      const database = new FakeProductionDatabase();
      await assert.rejects(
        setupProductionAdminIfNeeded(database.asPool(), settings),
        /INITIAL_ADMIN|Production database has no users/,
      );
      assert.deepEqual(database.state.users, []);
      assert.deepEqual(database.state.deals, []);
      assert.deepEqual(database.state.tasks, []);
      assert.deepEqual(database.state.touches, []);
      assert.equal(database.commits, 0);
      assert.equal(database.rollbacks, 1);
      assert.equal(database.releases, 1);
    });
  }
});

test("production preserves real users and records while removing legacy demo sessions and data", async () => {
  const database = new FakeProductionDatabase();
  database.state.users = [
    {
      email: "admin@example.com",
      full_name: "Existing Admin",
      role: "admin",
      trade_point: null,
      password_hash: "existing-hash",
    },
    {
      email: DEMO_EMAILS[2],
      full_name: "Old Demo Admin",
      role: "admin",
      trade_point: null,
      password_hash: "demo-hash",
    },
  ];
  database.state.sessions = [
    { sess: { user: { email: "admin@example.com" } } },
    { sess: { user: { email: DEMO_EMAILS[2] } } },
  ];
  database.state.deals = [...SAMPLE_DEAL_IDS, "REAL-DEAL-001"];
  database.state.tasks = [
    ...SAMPLE_DEAL_IDS.map((deal_id, index) => ({
      task_id: `demo-task-${index}`,
      deal_id,
    })),
    { task_id: "real-task", deal_id: "REAL-DEAL-001" },
  ];
  database.state.touches = [
    ...SAMPLE_DEAL_IDS.map((_, index) => ({ task_id: `demo-task-${index}` })),
    { task_id: "real-task" },
  ];

  await setupProductionAdminIfNeeded(database.asPool(), {
    initialAdminEmail: "new-owner@example.com",
    initialAdminPassword: "A-long-unique-bootstrap-password-26!",
    initialAdminName: "Must Not Be Created",
  });

  assert.deepEqual(database.state.users.map((user) => user.email), ["admin@example.com"]);
  assert.deepEqual(database.state.auditLog, []);
  assert.deepEqual(database.state.sessions, [
    { sess: { user: { email: "admin@example.com" } } },
  ]);
  assert.deepEqual(database.state.deals, ["REAL-DEAL-001"]);
  assert.deepEqual(database.state.tasks, [
    { task_id: "real-task", deal_id: "REAL-DEAL-001" },
  ]);
  assert.deepEqual(database.state.touches, [{ task_id: "real-task" }]);
  assert.equal(database.commits, 1);
  assert.equal(database.rollbacks, 0);
});

test("development seeding keeps the expected demo accounts and sample records", async () => {
  const database = new FakeDevelopmentPool();
  const passwordsHashed: string[] = [];
  await seedDemoDataIfEmpty(database.asPool(), async (password) => {
    passwordsHashed.push(password);
    return `hash:${password}`;
  });

  assert.deepEqual(
    database.users.map(([email, , role, , passwordHash]) => ({
      email,
      role,
      passwordHash,
    })),
    [
      { email: DEMO_EMAILS[0], role: "operator", passwordHash: "hash:Demo12345!" },
      { email: DEMO_EMAILS[1], role: "kc_head", passwordHash: "hash:Demo12345!" },
      { email: DEMO_EMAILS[2], role: "admin", passwordHash: "hash:Demo12345!" },
    ],
  );
  assert.deepEqual(passwordsHashed, ["Demo12345!"]);
  assert.deepEqual(
    database.deals.map(([dealId]) => dealId).sort(),
    [...SAMPLE_DEAL_IDS].sort(),
  );
  assert.equal(database.tasks.length, 10);
  assert.equal(database.touches.length, 4);
  assert.equal(database.auditLog.length, 1);
});