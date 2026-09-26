// Демо-данные для разработки: 5 демо-отмен, 5 демо-тёплых лидов и 3 тестовых пользователя.
// В production вместо этого настраивается первый администратор из Secrets.
import { pool } from "./pool";
import { env } from "../env";
import { hashPassword } from "../utils/password";
import { calculatePriority } from "../domain/priority";
import { computeNextTouchDate } from "../domain/touchSchedule";
import { CancelReasonCode } from "../domain/statusCodes";
import type { Pool } from "pg";

// Пароль используется только для локальных тестовых учёток и не используется в production.
const DEMO_PASSWORD = "Demo12345!";

interface DemoUser {
  email: string;
  full_name: string;
  role: "operator" | "kc_head" | "tt_head" | "admin";
  trade_point: string | null;
}

const DEMO_USERS: DemoUser[] = [
  { email: "operator@demo.laparet.local", full_name: "Иванова Мария Сергеевна", role: "operator", trade_point: null },
  { email: "kc-head@demo.laparet.local", full_name: "Петров Алексей Викторович", role: "kc_head", trade_point: null },
  { email: "admin@demo.laparet.local", full_name: "Сидорова Анна Игоревна", role: "admin", trade_point: null },
];

const DEMO_USER_EMAILS = DEMO_USERS.map((user) => user.email);
const DEMO_DEAL_IDS = [
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

type SeedDatabase = Pick<Pool, "query" | "connect">;
type ProductionBootstrapSettings = Pick<
  typeof env,
  "initialAdminEmail" | "initialAdminPassword" | "initialAdminName"
>;

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function setupProductionAdminIfNeeded(
  database: SeedDatabase = pool,
  bootstrap: ProductionBootstrapSettings = env,
  passwordHasher: typeof hashPassword = hashPassword,
): Promise<void> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    // Serialize simultaneous starts so only one instance performs first-admin setup.
    await client.query("SELECT pg_advisory_xact_lock(620314, 1)");

    // Remove the well-known demo accounts/data created by older releases, including any
    // still-valid sessions for those accounts. Keep all imported/customer records untouched.
    await client.query(
      `DELETE FROM sessions
       WHERE sess->'user'->>'email' = ANY($1::text[])`,
      [DEMO_USER_EMAILS],
    );
    await client.query(
      `DELETE FROM touches
       WHERE task_id IN (SELECT task_id FROM tasks WHERE deal_id = ANY($1::text[]))`,
      [DEMO_DEAL_IDS],
    );
    await client.query("DELETE FROM tasks WHERE deal_id = ANY($1::text[])", [DEMO_DEAL_IDS]);
    await client.query("DELETE FROM deals WHERE deal_id = ANY($1::text[])", [DEMO_DEAL_IDS]);
    await client.query("DELETE FROM users WHERE email = ANY($1::text[])", [DEMO_USER_EMAILS]);

    const usersCount = await client.query<{ count: string }>("SELECT count(*) FROM users");
    if (Number(usersCount.rows[0].count) === 0) {
      const email = bootstrap.initialAdminEmail?.trim().toLowerCase();
      const password = bootstrap.initialAdminPassword;
      if (!email || !password) {
        throw new Error(
          "Production database has no users. Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD to create the first administrator.",
        );
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("INITIAL_ADMIN_EMAIL must be a valid email address.");
      }
      if (password.trim().length < 16) {
        throw new Error(
          "INITIAL_ADMIN_PASSWORD must contain at least 16 non-whitespace characters.",
        );
      }

      const fullName = bootstrap.initialAdminName?.trim() || "Администратор";
      const passwordHash = await passwordHasher(password);
      await client.query(
        `INSERT INTO users (email, full_name, role, trade_point, password_hash)
         VALUES ($1, $2, 'admin', NULL, $3)`,
        [email, fullName, passwordHash],
      );
      await client.query("INSERT INTO audit_log (user_email, action) VALUES ($1, $2)", [
        email,
        "Создан первый администратор при production-настройке",
      ]);
      // eslint-disable-next-line no-console
      console.log(`Создан первый production-администратор: ${email}. Удалите INITIAL_ADMIN_* из Secrets.`);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function seedDemoDataIfEmpty(
  database: Pick<Pool, "query"> = pool,
  passwordHasher: typeof hashPassword = hashPassword,
): Promise<void> {
  const usersCount = await database.query<{ count: string }>("SELECT count(*) FROM users");
  if (Number(usersCount.rows[0].count) > 0) {
    return; // Уже есть данные — демо-сидирование делается только один раз, на пустой базе.
  }

  const passwordHash = await passwordHasher(DEMO_PASSWORD);
  for (const user of DEMO_USERS) {
    await database.query(
      "INSERT INTO users (email, full_name, role, trade_point, password_hash) VALUES ($1,$2,$3,$4,$5)",
      [user.email, user.full_name, user.role, user.trade_point, passwordHash],
    );
  }

  const operatorEmail = DEMO_USERS[0].email;

  // --- 5 демо-отмен (вымышленные клиенты и телефоны) ---
  const cancellations = [
    { id: "DEMO-C-001", client: "Тестов Тест Тестович", phone: "+7 900 000-00-01", amount: 45000, reason: "R01", daysAgo: 1, status: "NEW" },
    { id: "DEMO-C-002", client: "Образцов Олег Николаевич", phone: "+7 900 000-00-02", amount: 128500, reason: "R04", daysAgo: 3, status: "NEW" },
    { id: "DEMO-C-003", client: "Демидова Дарья Павловна", phone: "+7 900 000-00-03", amount: null, reason: "R10", daysAgo: 5, status: "NEW" },
    { id: "DEMO-C-004", client: "Примерова Полина Андреевна", phone: "+7 900 000-00-04", amount: 76000, reason: "R06", daysAgo: 6, status: "WIP" },
    { id: "DEMO-C-005", client: "Макетов Максим Игоревич", phone: "+7 900 000-00-05", amount: 32000, reason: "R02", daysAgo: 20, status: "CANCEL_OK" },
  ];

  for (const c of cancellations) {
    await database.query(
      `INSERT INTO deals (
         deal_id, created_at, status_changed_at, source_stage, classification, amount,
         kc_operator_email, trade_point, tt_employee, transferred_at, cancel_reason_code,
         cancel_comment, client_phone, client_name, product_group, channel
       ) VALUES ($1,$2,$3,'Сделка отменена (демо)','обычная',$4,$5,'ТТ Демо-Центральная','Кузнецов Иван (ТТ)',$2,$6,'Демо-комментарий отмены',$7,$8,'Напольные покрытия','Звонок')`,
      [c.id, daysAgo(c.daysAgo), daysAgo(c.daysAgo), c.amount, operatorEmail, c.reason, c.phone, c.client],
    );

    const priority = calculatePriority({
      amount: c.amount,
      eventDate: new Date(daysAgo(c.daysAgo)),
      cancelReasonCode: c.reason as CancelReasonCode,
    });

    const taskResult = await database.query<{ task_id: string }>(
      `INSERT INTO tasks (deal_id, type, status, assigned_operator_email, priority_score, next_touch_date, touches_count)
       VALUES ($1, 'cancellation', $2, $3, $4, $5, $6) RETURNING task_id`,
      [
        c.id,
        c.status,
        operatorEmail,
        priority.priorityScore,
        c.status === "CANCEL_OK" ? null : daysAgo(-1),
        c.status === "NEW" ? 0 : 1,
      ],
    );

    if (c.status !== "NEW") {
      await database.query(
        `INSERT INTO touches (task_id, operator_email, result_code, comment) VALUES ($1,$2,$3,$4)`,
        [
          taskResult.rows[0].task_id,
          operatorEmail,
          c.status === "CANCEL_OK" ? "R02" : "ANSWERED",
          c.status === "CANCEL_OK" ? "Демо: клиент подтвердил отказ, отмена корректная." : "Демо: дозвонились, уточняем детали.",
        ],
      );
    }
  }

  // --- 5 демо-тёплых лидов ---
  const warmLeads = [
    { id: "DEMO-W-001", client: "Кандидатов Кирилл Романович", phone: "+7 900 000-00-11", amount: 54000, daysAgo: 2, status: "NEW" },
    { id: "DEMO-W-002", client: "Заготовкина Зоя Викторовна", phone: "+7 900 000-00-12", amount: 21000, daysAgo: 4, status: "NEW" },
    { id: "DEMO-W-003", client: "Пробников Пётр Сергеевич", phone: "+7 900 000-00-13", amount: null, daysAgo: 7, status: "NEW" },
    { id: "DEMO-W-004", client: "Черновикова Чеслава Олеговна", phone: "+7 900 000-00-14", amount: 39000, daysAgo: 8, status: "WIP" },
    { id: "DEMO-W-005", client: "Финалистов Фёдор Дмитриевич", phone: "+7 900 000-00-15", amount: 61000, daysAgo: 25, status: "WON" },
  ];

  for (const w of warmLeads) {
    await database.query(
      `INSERT INTO deals (
         deal_id, created_at, status_changed_at, source_stage, classification, amount,
         kc_operator_email, trade_point, tt_employee, client_phone, client_name, product_group, channel
       ) VALUES ($1,$2,$2,'Тёплое обращение (демо)','тёплый_лид',$3,$4,'ТТ Демо-Центральная','Кузнецов Иван (ТТ)',$5,$6,'Сантехника','Сайт')`,
      [w.id, daysAgo(w.daysAgo), w.amount, operatorEmail, w.phone, w.client],
    );

    const priority = calculatePriority({
      amount: w.amount,
      eventDate: new Date(daysAgo(w.daysAgo)),
      cancelReasonCode: null,
    });
    const touchesCount = w.status === "NEW" ? 0 : 1;
    const nextTouch = computeNextTouchDate(new Date(daysAgo(w.daysAgo)), touchesCount);

    const taskResult = await database.query<{ task_id: string }>(
      `INSERT INTO tasks (deal_id, type, status, assigned_operator_email, priority_score, next_touch_date, touches_count)
       VALUES ($1, 'warm_lead', $2, $3, $4, $5, $6) RETURNING task_id`,
      [
        w.id,
        w.status,
        operatorEmail,
        priority.priorityScore,
        w.status === "WON" ? null : (nextTouch ? nextTouch.toISOString().slice(0, 10) : null),
        touchesCount,
      ],
    );

    if (w.status !== "NEW") {
      await database.query(
        `INSERT INTO touches (task_id, operator_email, result_code, comment) VALUES ($1,$2,$3,$4)`,
        [
          taskResult.rows[0].task_id,
          operatorEmail,
          w.status === "WON" ? "ANSWERED" : "ANSWERED",
          w.status === "WON" ? "Демо: клиент подтвердил покупку, сделка реализована." : "Демо: клиент на связи, думает.",
        ],
      );
    }
  }

  await database.query("INSERT INTO audit_log (user_email, action) VALUES ($1, $2)", [
    "system",
    "Загружены демо-данные при первом запуске (5 отмен, 5 тёплых лидов, 3 пользователя)",
  ]);

  // eslint-disable-next-line no-console
  console.log(
    `Демо-данные созданы. Демо-пользователи (пароль для всех: ${DEMO_PASSWORD}): ` +
      DEMO_USERS.map((u) => `${u.email} (${u.role})`).join(", "),
  );
}

export async function initializeUserData(
  nodeEnv: string,
  setupProductionAdmin: () => Promise<void> = setupProductionAdminIfNeeded,
  seedDevelopmentData: () => Promise<void> = seedDemoDataIfEmpty,
): Promise<void> {
  if (nodeEnv === "production") {
    await setupProductionAdmin();
  } else {
    await seedDevelopmentData();
  }
}
