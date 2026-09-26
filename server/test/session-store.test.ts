import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import express, { Router, type RequestHandler } from "express";
import type { Server } from "node:http";
import { Pool } from "pg";
import { test } from "node:test";
import { authRoutes } from "../src/routes/authRoutes";
import { createApp } from "../src/app";
import { diagnosticIdMiddleware } from "../src/middleware/diagnosticId";
import { env } from "../src/env";
import { pool as appPool } from "../src/db/pool";
import {
  createSession,
  SESSION_COOKIE_MAX_AGE_MS,
  SESSION_COOKIE_NAME,
  SESSION_PRUNE_INTERVAL_SECONDS,
  SESSION_TTL_SECONDS,
} from "../src/session";
import { hashPassword } from "../src/utils/password";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Session-store tests require TEST_DATABASE_URL or DATABASE_URL.");
}
if (process.env.NODE_ENV === "production" && !process.env.TEST_DATABASE_URL) {
  throw new Error(
    "Refusing to run session-store tests against DATABASE_URL in production; set TEST_DATABASE_URL.",
  );
}

const TEST_SECRET = "session-store-regression-test-secret";
const TEST_USER = {
  email: "session-regression@example.invalid",
  full_name: "Session Regression Test",
  role: "staff",
  trade_point: "test-only",
};

assert.equal(SESSION_TTL_SECONDS, 12 * 60 * 60);
assert.equal(SESSION_COOKIE_MAX_AGE_MS, 12 * 60 * 60 * 1000);
assert.equal(SESSION_PRUNE_INTERVAL_SECONDS, 15 * 60);

async function withIsolatedSessionTable(
  run: (pool: Pool, tableName: string) => Promise<void>,
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const tableName = `session_test_${randomUUID().replaceAll("-", "")}`;
  let tableCreated = false;

  try {
    await pool.query(`
      CREATE TABLE "${tableName}" (
        sid varchar NOT NULL PRIMARY KEY,
        sess json NOT NULL,
        expire timestamp(6) NOT NULL
      )
    `);
    tableCreated = true;
    await run(pool, tableName);
  } finally {
    try {
      if (tableCreated) {
        await pool.query(`DROP TABLE IF EXISTS "${tableName}"`);
        await pool.query(`DROP TABLE IF EXISTS "${tableName}_revocations"`);
      }
    } finally {
      await pool.end();
    }
  }
}

function createTestApp(
  middleware: RequestHandler,
  inFlightSessionChange?: {
    started: () => void;
    waitUntilReleased: Promise<void>;
  },
): express.Express {
  const app = express();
  app.use(diagnosticIdMiddleware);
  app.use(middleware);
  app.post("/test-session", (req, res) => {
    req.session.user = TEST_USER;
    sendTestJson(res, 201, { user: req.session.user });
  });
  if (inFlightSessionChange) {
    app.post("/test-session-change", (req, res) => {
      req.session.user = {
        ...TEST_USER,
        full_name: "Changed while logout was in progress",
      };
      inFlightSessionChange.started();
      void inFlightSessionChange.waitUntilReleased.then(() => {
        sendTestJson(res, 200, { user: req.session.user });
      });
    });
  }
  app.get("/me", (req, res) => {
    res.json({ user: req.session.user ?? null });
  });
  app.use("/api/auth", authRoutes);
  return app;
}

test("session cookies retain secure attributes in production and development", async () => {
  await withIsolatedSessionTable(async (pool, tableName) => {
    const testRoutes = Router();
    testRoutes.post("/test-session", (req, res) => {
      req.session.user = TEST_USER;
      sendTestJson(res, 201, { user: req.session.user });
    });

    for (const mode of [
      { name: "production", secure: true },
      { name: "development", secure: false },
    ]) {
      const configuredSession = createSession(pool, TEST_SECRET, mode.secure, {
        tableName,
        pruneSessionIntervalSeconds: false,
      });
      const server = await startServer(
        createApp(configuredSession.middleware, testRoutes),
      );
      try {
        const response = await fetch(`${server.url}/api/test-session`, {
          method: "POST",
          headers: mode.secure ? { "x-forwarded-proto": "https" } : {},
        });
        assert.equal(response.status, 201);
        const cookie = response.headers.get("set-cookie");
        assert.ok(cookie, `${mode.name} should issue a session cookie`);
        assert.match(cookie, /(?:^|;)\s*HttpOnly(?:;|$)/i);
        assert.match(cookie, /(?:^|;)\s*SameSite=Lax(?:;|$)/i);
        assert.equal(
          /(?:^|;)\s*Secure(?:;|$)/i.test(cookie),
          mode.secure,
          `${mode.name} should ${mode.secure ? "" : "not "}set Secure`,
        );
        assert.deepEqual(await response.json(), { user: TEST_USER });
      } finally {
        await stopServer(server.server);
        await configuredSession.store.close();
      }
    }
  });
});

test("successful production logout expires the secure browser session cookie", async () => {
  await withIsolatedSessionTable(async (pool, tableName) => {
    const routes = Router();
    routes.post("/test-session", (req, res) => {
      req.session.user = TEST_USER;
      sendTestJson(res, 201, { user: req.session.user });
    });
    routes.use("/auth", authRoutes);

    const configuredSession = createSession(pool, TEST_SECRET, true, {
      tableName,
      pruneSessionIntervalSeconds: false,
    });
    const server = await startServer(
      createApp(configuredSession.middleware, routes),
    );

    try {
      const createResponse = await fetch(`${server.url}/api/test-session`, {
        method: "POST",
        headers: { "x-forwarded-proto": "https" },
      });
      assert.equal(createResponse.status, 201);
      const sessionCookie = getCookie(createResponse);
      assert.deepEqual(await createResponse.json(), { user: TEST_USER });

      const logoutResponse = await fetch(
        `${server.url}/api/auth/logout`,
        {
          method: "POST",
          headers: {
            cookie: sessionCookie,
            "x-forwarded-proto": "https",
          },
        },
      );
      assert.equal(logoutResponse.status, 200);
      assert.deepEqual(await logoutResponse.json(), { ok: true });

      const clearedCookie = logoutResponse.headers.get("set-cookie");
      assert.ok(clearedCookie, "successful logout should expire the session cookie");
      assert.match(clearedCookie, new RegExp(`^${SESSION_COOKIE_NAME}=`));
      assert.match(clearedCookie, /(?:^|;)\s*Expires=/i);
      const expiry = clearedCookie.match(/;\s*Expires=([^;]+)/i);
      assert.ok(expiry, "the cleared session cookie should have an expiry");
      assert.ok(
        Date.parse(expiry[1]) < Date.now(),
        "the cleared session cookie should already be expired",
      );
      assert.match(clearedCookie, /(?:^|;)\s*Secure(?:;|$)/i);
      assert.match(clearedCookie, /(?:^|;)\s*HttpOnly(?:;|$)/i);
      assert.match(clearedCookie, /(?:^|;)\s*SameSite=Lax(?:;|$)/i);
    } finally {
      await stopServer(server.server);
      await configuredSession.store.close();
    }
  });
});

test("successful development logout expires the non-secure browser session cookie", async () => {
  await withIsolatedSessionTable(async (pool, tableName) => {
    const routes = Router();
    routes.post("/test-session", (req, res) => {
      req.session.user = TEST_USER;
      sendTestJson(res, 201, { user: req.session.user });
    });
    routes.use("/auth", authRoutes);

    const configuredSession = createSession(pool, TEST_SECRET, false, {
      tableName,
      pruneSessionIntervalSeconds: false,
    });
    const server = await startServer(
      createApp(configuredSession.middleware, routes),
    );

    try {
      const createResponse = await fetch(`${server.url}/api/test-session`, {
        method: "POST",
      });
      assert.equal(createResponse.status, 201);
      const sessionCookie = getCookie(createResponse);
      assert.deepEqual(await createResponse.json(), { user: TEST_USER });

      const logoutResponse = await fetch(
        `${server.url}/api/auth/logout`,
        {
          method: "POST",
          headers: { cookie: sessionCookie },
        },
      );
      assert.equal(logoutResponse.status, 200);
      assert.deepEqual(await logoutResponse.json(), { ok: true });

      const clearedCookie = logoutResponse.headers.get("set-cookie");
      assert.ok(clearedCookie, "successful logout should expire the session cookie");
      assert.match(clearedCookie, new RegExp(`^${SESSION_COOKIE_NAME}=`));
      assert.match(clearedCookie, /(?:^|;)\s*Expires=/i);
      const expiry = clearedCookie.match(/;\s*Expires=([^;]+)/i);
      assert.ok(expiry, "the cleared session cookie should have an expiry");
      assert.ok(
        Date.parse(expiry[1]) < Date.now(),
        "the cleared session cookie should already be expired",
      );
      assert.doesNotMatch(clearedCookie, /(?:^|;)\s*Secure(?:;|$)/i);
      assert.match(clearedCookie, /(?:^|;)\s*HttpOnly(?:;|$)/i);
      assert.match(clearedCookie, /(?:^|;)\s*SameSite=Lax(?:;|$)/i);
    } finally {
      await stopServer(server.server);
      await configuredSession.store.close();
    }
  });
});

test(
  "credential login succeeds through the production app with a secure session cookie",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL!;
    assert.equal(
      env.databaseUrl,
      testDatabaseUrl,
      "credential login integration tests must use TEST_DATABASE_URL for application services",
    );

    await withIsolatedSessionTable(async (sessionPool, tableName) => {
      const email = `login-regression-${randomUUID()}@example.invalid`;
      const password = `test-${randomUUID()}`;
      const fullName = "Login Regression Test";
      const passwordHash = await hashPassword(password);
      let userCreated = false;
      let configuredSession: ReturnType<typeof createSession> | undefined;
      let server: Awaited<ReturnType<typeof startServer>> | undefined;

      try {
        await appPool.query(
          `INSERT INTO users (email, full_name, role, trade_point, password_hash)
           VALUES ($1, $2, 'operator', 'test-only', $3)`,
          [email, fullName, passwordHash],
        );
        userCreated = true;

        configuredSession = createSession(
          sessionPool,
          TEST_SECRET,
          true,
          { tableName, pruneSessionIntervalSeconds: false },
        );
        server = await startServer(createApp(configuredSession.middleware));

        const response = await fetch(`${server.url}/api/auth/login`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-proto": "https",
          },
          body: JSON.stringify({ email, password }),
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          user: {
            email,
            full_name: fullName,
            role: "operator",
            trade_point: "test-only",
          },
        });

        const cookie = response.headers.get("set-cookie");
        assert.ok(cookie, "successful login should issue a session cookie");
        assert.match(cookie, /(?:^|;)\s*HttpOnly(?:;|$)/i);
        assert.match(cookie, /(?:^|;)\s*SameSite=Lax(?:;|$)/i);
        assert.match(cookie, /(?:^|;)\s*Secure(?:;|$)/i);

        const savedSession = await sessionPool.query(
          `SELECT count(*)::int AS count FROM "${tableName}"`,
        );
        assert.equal(savedSession.rows[0].count, 1);

        const auditEntry = await appPool.query(
          `SELECT count(*)::int AS count FROM audit_log
           WHERE user_email = $1 AND action = $2`,
          [email, "Вход в систему"],
        );
        assert.equal(auditEntry.rows[0].count, 1);
      } finally {
        try {
          if (server) await stopServer(server.server);
        } finally {
          try {
            await configuredSession?.store.close();
          } finally {
            if (userCreated) {
              try {
                await appPool.query("DELETE FROM audit_log WHERE user_email = $1", [
                  email,
                ]);
              } finally {
                await appPool.query("DELETE FROM users WHERE email = $1", [email]);
              }
            }
          }
        }
      }
    });
  },
);

test(
  "disabled users with valid passwords cannot create login sessions",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL!;
    assert.equal(
      env.databaseUrl,
      testDatabaseUrl,
      "credential login integration tests must use TEST_DATABASE_URL for application services",
    );

    await withIsolatedSessionTable(async (sessionPool, tableName) => {
      const email = `disabled-login-${randomUUID()}@example.invalid`;
      const password = `test-${randomUUID()}`;
      const passwordHash = await hashPassword(password);
      let userCreated = false;
      let configuredSession: ReturnType<typeof createSession> | undefined;
      let server: Awaited<ReturnType<typeof startServer>> | undefined;

      try {
        await appPool.query(
          `INSERT INTO users (email, full_name, role, trade_point, password_hash, active)
           VALUES ($1, 'Disabled Login Test', 'operator', 'test-only', $2, false)`,
          [email, passwordHash],
        );
        userCreated = true;

        configuredSession = createSession(
          sessionPool,
          TEST_SECRET,
          true,
          { tableName, pruneSessionIntervalSeconds: false },
        );
        server = await startServer(createApp(configuredSession.middleware));

        const response = await fetch(`${server.url}/api/auth/login`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-proto": "https",
          },
          body: JSON.stringify({ email, password }),
        });
        const responseBody = await response.json();

        assert.equal(response.status, 403);
        assert.deepEqual(responseBody, {
          error: "Учётная запись отключена. Обратитесь к администратору.",
        });
        assert.equal(
          response.headers.get("set-cookie"),
          null,
          "disabled-account rejection should not issue a session cookie",
        );

        const savedSessions = await sessionPool.query(
          `SELECT count(*)::int AS count FROM "${tableName}"`,
        );
        assert.equal(savedSessions.rows[0].count, 0);

        const loginAuditEntries = await appPool.query(
          `SELECT count(*)::int AS count FROM audit_log
           WHERE user_email = $1 AND action = $2`,
          [email, "Вход в систему"],
        );
        assert.equal(loginAuditEntries.rows[0].count, 0);
      } finally {
        try {
          if (server) await stopServer(server.server);
        } finally {
          try {
            await configuredSession?.store.close();
          } finally {
            if (userCreated) {
              try {
                await appPool.query("DELETE FROM audit_log WHERE user_email = $1", [
                  email,
                ]);
              } finally {
                await appPool.query("DELETE FROM users WHERE email = $1", [email]);
              }
            }
          }
        }
      }
    });
  },
);

test(
  "wrong passwords and unknown emails receive identical login rejections without side effects",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL!;
    assert.equal(
      env.databaseUrl,
      testDatabaseUrl,
      "credential login integration tests must use TEST_DATABASE_URL for application services",
    );

    await withIsolatedSessionTable(async (sessionPool, tableName) => {
      const email = `login-rejection-${randomUUID()}@example.invalid`;
      const unknownEmail = `unknown-login-${randomUUID()}@example.invalid`;
      const passwordHash = await hashPassword(`test-${randomUUID()}`);
      let userCreated = false;
      let configuredSession: ReturnType<typeof createSession> | undefined;
      let server: Awaited<ReturnType<typeof startServer>> | undefined;

      try {
        await appPool.query(
          `INSERT INTO users (email, full_name, role, trade_point, password_hash)
           VALUES ($1, 'Login Rejection Test', 'operator', 'test-only', $2)`,
          [email, passwordHash],
        );
        userCreated = true;

        configuredSession = createSession(
          sessionPool,
          TEST_SECRET,
          true,
          { tableName, pruneSessionIntervalSeconds: false },
        );
        server = await startServer(createApp(configuredSession.middleware));

        const wrongPasswordResponse = await fetch(
          `${server.url}/api/auth/login`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-forwarded-proto": "https",
            },
            body: JSON.stringify({ email, password: "definitely-wrong-password" }),
          },
        );
        const wrongPasswordBody = await wrongPasswordResponse.json();

        const unknownEmailResponse = await fetch(
          `${server.url}/api/auth/login`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-forwarded-proto": "https",
            },
            body: JSON.stringify({
              email: unknownEmail,
              password: "definitely-wrong-password",
            }),
          },
        );
        const unknownEmailBody = await unknownEmailResponse.json();

        assert.equal(wrongPasswordResponse.status, 401);
        assert.equal(unknownEmailResponse.status, wrongPasswordResponse.status);
        assert.deepEqual(wrongPasswordBody, {
          error: "Неверный email или пароль.",
        });
        assert.deepEqual(unknownEmailBody, wrongPasswordBody);
        assert.equal(
          wrongPasswordResponse.headers.get("set-cookie"),
          null,
          "wrong-password rejection should not issue a session cookie",
        );
        assert.equal(
          unknownEmailResponse.headers.get("set-cookie"),
          null,
          "unknown-email rejection should not issue a session cookie",
        );

        const savedSessions = await sessionPool.query(
          `SELECT count(*)::int AS count FROM "${tableName}"`,
        );
        assert.equal(savedSessions.rows[0].count, 0);

        const loginAuditEntries = await appPool.query(
          `SELECT count(*)::int AS count FROM audit_log
           WHERE user_email = ANY($1::text[]) AND action = $2`,
          [[email, unknownEmail], "Вход в систему"],
        );
        assert.equal(loginAuditEntries.rows[0].count, 0);
      } finally {
        try {
          if (server) await stopServer(server.server);
        } finally {
          try {
            await configuredSession?.store.close();
          } finally {
            if (userCreated) {
              try {
                await appPool.query(
                  "DELETE FROM audit_log WHERE user_email = ANY($1::text[])",
                  [[email, unknownEmail]],
                );
              } finally {
                await appPool.query("DELETE FROM users WHERE email = $1", [email]);
              }
            }
          }
        }
      }
    });
  },
);

async function startServer(app: express.Express): Promise<{
  server: Server;
  url: string;
}> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The test server did not bind to a TCP port.");
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function stopServer(server: Server): Promise<void> {
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  server.closeAllConnections();
  await closed;
}

function sendTestJson(
  res: express.Response,
  statusCode: number,
  value: unknown,
): void {
  res.status(statusCode).type("json");
  res.write(JSON.stringify(value));
  res.end();
}

function getCookie(response: Response): string {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie, "the session response should set a cookie");
  return cookie.split(";", 1)[0];
}

async function waitForExpiredRowsToBeRemoved(
  pool: Pool,
  tableName: string,
): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT count(*)::int AS count FROM "${tableName}"`,
    );
    if (result.rows[0].count === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("the configured PostgreSQL cleanup did not remove the expired rows");
}

async function waitForRowToBeRemoved(
  pool: Pool,
  tableName: string,
  sid: string,
): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT count(*)::int AS count FROM "${tableName}" WHERE sid = $1`,
      [sid],
    );
    if (result.rows[0].count === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("the configured PostgreSQL cleanup did not remove the expired row");
}

test("a session survives a server/store restart and keeps its 12-hour lifetime", async () => {
  await withIsolatedSessionTable(async (pool, tableName) => {
    const firstSession = createSession(pool, TEST_SECRET, false, { tableName });
    const firstServer = await startServer(createTestApp(firstSession.middleware));
    let cookie: string;
    try {
      const cookieResponse = await fetch(`${firstServer.url}/test-session`, {
        method: "POST",
      });
      assert.equal(cookieResponse.status, 201);
      cookie = getCookie(cookieResponse);
      assert.deepEqual(await cookieResponse.json(), { user: TEST_USER });
      const cookieExpiry = cookieResponse
        .headers.get("set-cookie")
        ?.match(/;\s*Expires=([^;]+)/i);
      assert.ok(cookieExpiry, "the session cookie should expire");
      const cookieLifetimeMs = Date.parse(cookieExpiry[1]) - Date.now();
      assert.ok(
        cookieLifetimeMs <= SESSION_COOKIE_MAX_AGE_MS &&
          cookieLifetimeMs > SESSION_COOKIE_MAX_AGE_MS - 5_000,
        `expected cookie expiry close to ${SESSION_COOKIE_MAX_AGE_MS}ms, received ${cookieLifetimeMs}ms`,
      );

      const expiry = await pool.query(
        `SELECT EXTRACT(EPOCH FROM (expire - clock_timestamp())) AS seconds_remaining FROM "${tableName}"`,
      );
      const secondsRemaining = Number(expiry.rows[0].seconds_remaining);
      // connect-pg-simple rounds stored expiry timestamps up to a whole second.
      assert.ok(
        secondsRemaining <= SESSION_TTL_SECONDS + 1 &&
          secondsRemaining > SESSION_TTL_SECONDS - 5,
        `expected database session expiry close to ${SESSION_TTL_SECONDS} seconds, received ${secondsRemaining}`,
      );
    } finally {
      await stopServer(firstServer.server);
      await firstSession.store.close();
    }

    const secondSession = createSession(pool, TEST_SECRET, false, { tableName });
    const secondServer = await startServer(createTestApp(secondSession.middleware));
    try {
      const response = await fetch(`${secondServer.url}/me`, {
        headers: { cookie },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { user: TEST_USER });
    } finally {
      await stopServer(secondServer.server);
      await secondSession.store.close();
    }
  });
});

test("logout removes a persisted session so another server cannot restore it", async () => {
  await withIsolatedSessionTable(async (pool, tableName) => {
    const initialSession = createSession(pool, TEST_SECRET, false, { tableName });
    const initialServer = await startServer(
      createTestApp(initialSession.middleware),
    );
    let cookie: string;
    try {
      // Create a synthetic session directly; this does not require a staff account or login.
      const createResponse = await fetch(`${initialServer.url}/test-session`, {
        method: "POST",
      });
      assert.equal(createResponse.status, 201);
      cookie = getCookie(createResponse);
      assert.deepEqual(await createResponse.json(), { user: TEST_USER });

      const savedSession = await pool.query(
        `SELECT count(*)::int AS count FROM "${tableName}"`,
      );
      assert.equal(savedSession.rows[0].count, 1);

      const logoutResponse = await fetch(
        `${initialServer.url}/api/auth/logout`,
        {
          method: "POST",
          headers: { cookie },
        },
      );
      assert.equal(logoutResponse.status, 200);
      assert.deepEqual(await logoutResponse.json(), { ok: true });

      const revokedSession = await pool.query(
        `SELECT count(*)::int AS count FROM "${tableName}"`,
      );
      assert.equal(revokedSession.rows[0].count, 0);
    } finally {
      await stopServer(initialServer.server);
      await initialSession.store.close();
    }

    const secondSession = createSession(pool, TEST_SECRET, false, { tableName });
    const secondServer = await startServer(
      createTestApp(secondSession.middleware),
    );
    try {
      const response = await fetch(`${secondServer.url}/api/auth/me`, {
        headers: { cookie },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { user: null });

      const revokedSession = await pool.query(
        `SELECT count(*)::int AS count FROM "${tableName}"`,
      );
      assert.equal(revokedSession.rows[0].count, 0);
    } finally {
      await stopServer(secondServer.server);
      await secondSession.store.close();
    }
  });
});

test("logout on another server prevents an in-flight session change from restoring the session", async () => {
  await withIsolatedSessionTable(async (pool, tableName) => {
    let signalRequestStarted!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      signalRequestStarted = resolve;
    });
    let releaseRequest!: () => void;
    const requestCanFinish = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });

    const changingRequestPool = new Pool({
      connectionString: databaseUrl,
      max: 2,
    });
    const logoutPool = new Pool({ connectionString: databaseUrl, max: 2 });
    let changingRequestSession: ReturnType<typeof createSession> | undefined;
    let logoutSession: ReturnType<typeof createSession> | undefined;
    let changingRequestServer: Awaited<ReturnType<typeof startServer>> | undefined;
    let logoutServer: Awaited<ReturnType<typeof startServer>> | undefined;
    let cookie: string;

    try {
      changingRequestSession = createSession(
        changingRequestPool,
        TEST_SECRET,
        false,
        { tableName },
      );
      logoutSession = createSession(logoutPool, TEST_SECRET, false, {
        tableName,
      });
      changingRequestServer = await startServer(
        createTestApp(changingRequestSession.middleware, {
          started: signalRequestStarted,
          waitUntilReleased: requestCanFinish,
        }),
      );
      logoutServer = await startServer(createTestApp(logoutSession.middleware));

      const createResponse = await fetch(
        `${changingRequestServer.url}/test-session`,
        {
          method: "POST",
        },
      );
      assert.equal(createResponse.status, 201);
      cookie = getCookie(createResponse);
      assert.deepEqual(await createResponse.json(), { user: TEST_USER });

      const inFlightResponse = fetch(
        `${changingRequestServer.url}/test-session-change`,
        {
          method: "POST",
          headers: { cookie },
        },
      );
      await requestStarted;

      const logoutResponse = await fetch(
        `${logoutServer.url}/api/auth/logout`,
        {
          method: "POST",
          headers: { cookie },
        },
      );
      assert.equal(logoutResponse.status, 200);
      assert.deepEqual(await logoutResponse.json(), { ok: true });

      const afterLogout = await pool.query(
        `SELECT count(*)::int AS count FROM "${tableName}"`,
      );
      assert.equal(afterLogout.rows[0].count, 0);

      releaseRequest();
      const changeResponse = await inFlightResponse;
      assert.equal(changeResponse.status, 200);
      assert.deepEqual((await changeResponse.json()).user, {
        ...TEST_USER,
        full_name: "Changed while logout was in progress",
      });

      const afterBothResponses = await pool.query(
        `SELECT count(*)::int AS count FROM "${tableName}"`,
      );
      assert.equal(afterBothResponses.rows[0].count, 0);
    } finally {
      releaseRequest();
      if (changingRequestServer) {
        await stopServer(changingRequestServer.server);
      }
      if (logoutServer) {
        await stopServer(logoutServer.server);
      }
      await changingRequestSession?.store.close();
      await logoutSession?.store.close();
      await Promise.all([changingRequestPool.end(), logoutPool.end()]);
    }

    const freshPool = new Pool({ connectionString: databaseUrl, max: 2 });
    const freshSession = createSession(freshPool, TEST_SECRET, false, {
      tableName,
    });
    const freshServer = await startServer(createTestApp(freshSession.middleware));
    try {
      const response = await fetch(`${freshServer.url}/api/auth/me`, {
        headers: { cookie },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { user: null });

      const sessionRow = await pool.query(
        `SELECT count(*)::int AS count FROM "${tableName}"`,
      );
      assert.equal(sessionRow.rows[0].count, 0);
    } finally {
      await stopServer(freshServer.server);
      await freshSession.store.close();
      await freshPool.end();
    }
  });
});

test("logout reports an error when session destruction fails", async () => {
  const destructionError = new Error("test session-store failure");
  const failingDestroyMiddleware: RequestHandler = (req, _res, next) => {
    Object.defineProperty(req, "session", {
      configurable: true,
      value: {
        destroy: (callback: (error?: Error) => void) =>
          callback(destructionError),
      },
    });
    next();
  };
  const server = await startServer(createTestApp(failingDestroyMiddleware));
  const originalConsoleError = console.error;
  const loggedErrors: Parameters<typeof console.error>[] = [];
  console.error = (...args) => {
    loggedErrors.push(args);
  };

  try {
    const responses = await Promise.all([
      fetch(`${server.url}/api/auth/logout`, { method: "POST" }),
      fetch(`${server.url}/api/auth/logout`, { method: "POST" }),
    ]);
    const requestIds = responses.map((response) =>
      response.headers.get("x-request-id"),
    );

    assert.ok(requestIds.every((requestId) => requestId));
    assert.equal(new Set(requestIds).size, responses.length);
    for (const response of responses) {
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        error: "Не удалось завершить сеанс. Попробуйте ещё раз.",
      });
    }

    assert.equal(loggedErrors.length, responses.length);
    const loggedRequestIds = loggedErrors.map((args) => {
      assert.equal(args[0], "Session destruction failed during logout.");
      const details = args[1] as {
        method: string;
        route: string;
        requestId: string;
        error: Error;
      };
      assert.equal(details.method, "POST");
      assert.equal(details.route, "/api/auth/logout");
      assert.equal(details.error, destructionError);
      return details.requestId;
    });
    assert.deepEqual(new Set(loggedRequestIds), new Set(requestIds));
  } finally {
    console.error = originalConsoleError;
    await stopServer(server.server);
  }
});

test("session-store read failures return a server error instead of a signed-out user", async () => {
  await withIsolatedSessionTable(async (pool, tableName) => {
    const configuredSession = createSession(pool, TEST_SECRET, false, {
      tableName,
      pruneSessionIntervalSeconds: false,
    });
    const routes = Router();
    routes.post("/test-session", (req, res) => {
      req.session.user = TEST_USER;
      sendTestJson(res, 201, { user: req.session.user });
    });
    routes.use("/auth", authRoutes);
    const server = await startServer(
      createApp(configuredSession.middleware, routes),
    );

    try {
      const anonymousResponse = await fetch(`${server.url}/api/auth/me`);
      assert.equal(anonymousResponse.status, 200);
      assert.deepEqual(await anonymousResponse.json(), { user: null });

      const createResponse = await fetch(`${server.url}/api/test-session`, {
        method: "POST",
      });
      assert.equal(createResponse.status, 201);
      const cookie = getCookie(createResponse);
      assert.deepEqual(await createResponse.json(), { user: TEST_USER });

      configuredSession.store.get = (_sid, callback) => {
        process.nextTick(callback, new Error("test session-store read failure"));
      };

      const originalConsoleError = console.error;
      console.error = () => undefined;
      try {
        const response = await fetch(`${server.url}/api/auth/me`, {
          headers: { cookie },
        });
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), {
          error:
            "Внутренняя ошибка сервера. Попробуйте ещё раз или обратитесь к администратору.",
        });
      } finally {
        console.error = originalConsoleError;
      }
    } finally {
      await stopServer(server.server);
      await configuredSession.store.close();
    }
  });
});

test("expired sessions are rejected and automatically removed by PostgreSQL cleanup", async () => {
  await withIsolatedSessionTable(async (pool, tableName) => {
    const initialSession = createSession(pool, TEST_SECRET, false, { tableName });
    const initialServer = await startServer(
      createTestApp(initialSession.middleware),
    );
    let cookie: string;
    try {
      const cookieResponse = await fetch(`${initialServer.url}/test-session`, {
        method: "POST",
      });
      assert.equal(cookieResponse.status, 201);
      cookie = getCookie(cookieResponse);
      assert.deepEqual(await cookieResponse.json(), { user: TEST_USER });
    } finally {
      await stopServer(initialServer.server);
      await initialSession.store.close();
    }
    await pool.query(
      `UPDATE "${tableName}" SET expire = clock_timestamp() - interval '1 second'`,
    );

    const cleanupSession = createSession(pool, TEST_SECRET, false, {
      tableName,
      pruneSessionIntervalSeconds: 0.01,
    });
    const cleanupServer = await startServer(
      createTestApp(cleanupSession.middleware),
    );
    try {
      const response = await fetch(`${cleanupServer.url}/api/auth/me`, {
        headers: { cookie },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { user: null });

      await waitForExpiredRowsToBeRemoved(pool, tableName);
    } finally {
      await stopServer(cleanupServer.server);
      await cleanupSession.store.close();
    }
  });
});

test("expired logout revocations are removed by periodic cleanup without session writes", async () => {
  await withIsolatedSessionTable(async (pool, tableName) => {
    const initialSession = createSession(pool, TEST_SECRET, false, { tableName });
    const initialServer = await startServer(
      createTestApp(initialSession.middleware),
    );
    let cookie: string;
    try {
      const createResponse = await fetch(`${initialServer.url}/test-session`, {
        method: "POST",
      });
      assert.equal(createResponse.status, 201);
      cookie = getCookie(createResponse);
      assert.deepEqual(await createResponse.json(), { user: TEST_USER });

      const logoutResponse = await fetch(
        `${initialServer.url}/api/auth/logout`,
        {
          method: "POST",
          headers: { cookie },
        },
      );
      assert.equal(logoutResponse.status, 200);
      assert.deepEqual(await logoutResponse.json(), { ok: true });
    } finally {
      await stopServer(initialServer.server);
      await initialSession.store.close();
    }

    const revocationTable = `${tableName}_revocations`;
    await pool.query(
      `UPDATE "${revocationTable}"
       SET expire = clock_timestamp() - interval '1 second'`,
    );

    const cleanupSession = createSession(pool, TEST_SECRET, false, {
      tableName,
      pruneSessionIntervalSeconds: 0.01,
    });
    const cleanupServer = await startServer(
      createTestApp(cleanupSession.middleware),
    );
    try {
      const response = await fetch(`${cleanupServer.url}/me`, {
        headers: { cookie },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { user: null });

      await waitForExpiredRowsToBeRemoved(pool, revocationTable);
      const sessionRows = await pool.query(
        `SELECT count(*)::int AS count FROM "${tableName}"`,
      );
      assert.equal(sessionRows.rows[0].count, 0);
    } finally {
      await stopServer(cleanupServer.server);
      await cleanupSession.store.close();
    }
  });
});

test("active logout revocations remain during periodic cleanup without session writes", async () => {
  await withIsolatedSessionTable(async (pool, tableName) => {
    const initialSession = createSession(pool, TEST_SECRET, false, { tableName });
    const initialServer = await startServer(
      createTestApp(initialSession.middleware),
    );
    let cookie: string;
    try {
      const createResponse = await fetch(`${initialServer.url}/test-session`, {
        method: "POST",
      });
      assert.equal(createResponse.status, 201);
      cookie = getCookie(createResponse);
      assert.deepEqual(await createResponse.json(), { user: TEST_USER });

      const logoutResponse = await fetch(
        `${initialServer.url}/api/auth/logout`,
        {
          method: "POST",
          headers: { cookie },
        },
      );
      assert.equal(logoutResponse.status, 200);
      assert.deepEqual(await logoutResponse.json(), { ok: true });
    } finally {
      await stopServer(initialServer.server);
      await initialSession.store.close();
    }

    const revocationTable = `${tableName}_revocations`;
    const activeRevocationResult = await pool.query(
      `SELECT sid, expire > clock_timestamp() AS is_active
       FROM "${revocationTable}"`,
    );
    assert.equal(activeRevocationResult.rowCount, 1);
    assert.equal(activeRevocationResult.rows[0].is_active, true);
    const activeSid = activeRevocationResult.rows[0].sid as string;

    const expiredSid = `expired-${randomUUID()}`;
    await pool.query(
      `INSERT INTO "${revocationTable}" (sid, expire)
       VALUES ($1, clock_timestamp() - interval '1 second')`,
      [expiredSid],
    );

    const cleanupSession = createSession(pool, TEST_SECRET, false, {
      tableName,
      pruneSessionIntervalSeconds: 0.2,
    });
    const cleanupServer = await startServer(
      createTestApp(cleanupSession.middleware),
    );
    try {
      const response = await fetch(`${cleanupServer.url}/me`, {
        headers: { cookie },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { user: null });

      await waitForRowToBeRemoved(pool, revocationTable, expiredSid);
      const remainingRevocation = await pool.query(
        `SELECT expire > clock_timestamp() AS is_active
         FROM "${revocationTable}" WHERE sid = $1`,
        [activeSid],
      );
      assert.equal(remainingRevocation.rowCount, 1);
      assert.equal(
        remainingRevocation.rows[0].is_active,
        true,
        "periodic cleanup must retain logout revocations that have not expired",
      );
    } finally {
      await stopServer(cleanupServer.server);
      await cleanupSession.store.close();
    }
  });
});