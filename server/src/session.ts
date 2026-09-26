import session, { type SessionData } from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { Pool, PoolClient } from "pg";

const PgSessionStore = connectPgSimple(session);

export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const SESSION_COOKIE_MAX_AGE_MS = SESSION_TTL_SECONDS * 1000;
export const SESSION_PRUNE_INTERVAL_SECONDS = 15 * 60;
export const SESSION_COOKIE_NAME = "revenue_return_cc_session";

export interface SessionStoreOptions {
  tableName?: string;
  pruneSessionIntervalSeconds?: number | false;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function createSession(
  pool: Pool,
  secret: string,
  secureCookie: boolean,
  options: SessionStoreOptions = {},
) {
  const tableName = options.tableName ?? "sessions";
  const sessionTable = quoteIdentifier(tableName);
  const revocationTableName = `${tableName.slice(0, 63 - "_revocations".length)}_revocations`;
  const revocationTable = quoteIdentifier(revocationTableName);
  let revocationTableSetup: Promise<void> | undefined;
  let lastRevocationPruneAt = 0;

  const ensureRevocationTable = (): Promise<void> => {
    if (!revocationTableSetup) {
      revocationTableSetup = pool
        .query(
          `CREATE TABLE IF NOT EXISTS ${revocationTable} (
            sid varchar NOT NULL PRIMARY KEY,
            expire timestamp(6) NOT NULL
          )`,
        )
        .then(async () => {
          await pool.query(
            `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${revocationTableName}_expire_idx`)}
             ON ${revocationTable} (expire)`,
          );
        })
        .catch((error: unknown) => {
          revocationTableSetup = undefined;
          throw error;
        });
    }
    return revocationTableSetup;
  };

  const pruneExpiredRevocations = async (): Promise<void> => {
    await ensureRevocationTable();
    await pool.query(
      `DELETE FROM ${revocationTable} WHERE expire <= clock_timestamp()`,
    );
  };

  const runStoreWrite = (
    sid: string,
    callback: ((error?: Error | null) => void) | undefined,
    write: (client: PoolClient) => Promise<void>,
  ): void => {
    void (async () => {
      await ensureRevocationTable();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          JSON.stringify([tableName, sid]),
        ]);

        const now = Date.now();
        if (now - lastRevocationPruneAt >= SESSION_PRUNE_INTERVAL_SECONDS * 1000) {
          await client.query(
            `DELETE FROM ${revocationTable} WHERE expire <= clock_timestamp()`,
          );
          lastRevocationPruneAt = now;
        }

        await write(client);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    })().then(
      () => callback && process.nextTick(callback, null),
      (error: unknown) => {
        const storeError =
          error instanceof Error ? error : new Error(String(error));
        if (callback) {
          process.nextTick(callback, storeError);
        } else {
          console.error("Failed to update PostgreSQL session:", storeError);
        }
      },
    );
  };

  class RevocablePgSessionStore extends PgSessionStore {
    override pruneSessions(callback?: (error: Error) => void): void {
      // Preserve connect-pg-simple's timer rescheduling while also cleaning
      // revocations when no session writes occur.
      super.pruneSessions(callback);
      void pruneExpiredRevocations().catch((error: unknown) => {
        console.error("Failed to prune PostgreSQL session revocations:", error);
      });
    }

    set(
      sid: string,
      sessionData: SessionData,
      callback?: (error?: Error | null) => void,
    ): void {
      const cookieExpiry = sessionData.cookie.expires;
      const expiresAt = cookieExpiry
        ? Math.ceil(cookieExpiry.valueOf() / 1000)
        : Math.ceil(Date.now() / 1000 + SESSION_TTL_SECONDS);

      runStoreWrite(sid, callback, async (client) => {
        const activeRevocation = await client.query(
          `SELECT 1 FROM ${revocationTable}
           WHERE sid = $1 AND expire > clock_timestamp()`,
          [sid],
        );
        if (activeRevocation.rowCount) return;

        await client.query(
          `INSERT INTO ${sessionTable} (sess, expire, sid)
           VALUES ($1, to_timestamp($2), $3)
           ON CONFLICT (sid)
           DO UPDATE SET sess = $1, expire = to_timestamp($2)`,
          [sessionData, expiresAt, sid],
        );
      });
    }

    destroy(
      sid: string,
      callback?: (error?: Error | null) => void,
    ): void {
      runStoreWrite(sid, callback, async (client) => {
        await client.query(`DELETE FROM ${sessionTable} WHERE sid = $1`, [sid]);
        await client.query(
          `INSERT INTO ${revocationTable} (sid, expire)
           VALUES ($1, clock_timestamp() + ($2 * interval '1 second'))
           ON CONFLICT (sid)
           DO UPDATE SET expire = GREATEST(${revocationTable}.expire, EXCLUDED.expire)`,
          [sid, SESSION_TTL_SECONDS],
        );
      });
    }
  }

  const store = new RevocablePgSessionStore({
    pool,
    tableName,
    ttl: SESSION_TTL_SECONDS,
    pruneSessionInterval:
      options.pruneSessionIntervalSeconds ?? SESSION_PRUNE_INTERVAL_SECONDS,
  });

  const middleware = session({
    store,
    secret,
    resave: false,
    saveUninitialized: false,
    name: SESSION_COOKIE_NAME,
    cookie: {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "lax",
      maxAge: SESSION_COOKIE_MAX_AGE_MS,
    },
  });

  return { middleware, store };
}