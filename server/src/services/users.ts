// Пользователи и роли (функция MVP №5). Источник правил — docs/PASSPORT.md, блок 2, пункт 5.
import { pool } from "../db/pool";
import { UserRole } from "../domain/statusCodes";
import { UserRow } from "../types/models";
import { generateTemporaryPassword, hashPassword } from "../utils/password";
import { ValidationError } from "../utils/validation";

export type PublicUser = Omit<UserRow, "password_hash">;

const PUBLIC_COLUMNS = "email, full_name, role, trade_point, active, created_at";

export async function listUsers(): Promise<PublicUser[]> {
  const result = await pool.query<PublicUser>(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY full_name`);
  return result.rows;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
  return result.rows[0] ?? null;
}

export interface CreateUserInput {
  email: string;
  full_name: string;
  role: UserRole;
  trade_point: string | null;
}

export interface CreateUserResult {
  user: PublicUser;
  temporaryPassword: string;
}

export async function createUser(input: CreateUserInput): Promise<CreateUserResult> {
  const existing = await findUserByEmail(input.email);
  if (existing) {
    // Критерий из паспорта: «дублирующийся email — ошибка с указанием существующей записи».
    throw new ValidationError(
      `Пользователь с email ${input.email} уже существует: ${existing.full_name} (роль: ${existing.role}).`,
    );
  }
  if (input.role === "tt_head" && !input.trade_point) {
    throw new ValidationError("Для роли «Руководитель ТТ» обязательно нужно указать торговую точку.");
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const result = await pool.query<PublicUser>(
    `INSERT INTO users (email, full_name, role, trade_point, password_hash)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${PUBLIC_COLUMNS}`,
    [input.email.toLowerCase(), input.full_name, input.role, input.trade_point, passwordHash],
  );

  return { user: result.rows[0], temporaryPassword };
}

export async function resetUserPassword(email: string): Promise<string> {
  const user = await findUserByEmail(email);
  if (!user) {
    throw new ValidationError(`Пользователь с email ${email} не найден.`);
  }
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await pool.query("UPDATE users SET password_hash = $1 WHERE email = $2", [passwordHash, email.toLowerCase()]);
  return temporaryPassword;
}

export interface UpdateUserInput {
  role?: UserRole;
  trade_point?: string | null;
  active?: boolean;
}

export async function updateUser(email: string, input: UpdateUserInput): Promise<PublicUser> {
  const user = await findUserByEmail(email);
  if (!user) {
    throw new ValidationError(`Пользователь с email ${email} не найден.`);
  }
  const nextRole = input.role ?? user.role;
  const nextTradePoint = input.trade_point !== undefined ? input.trade_point : user.trade_point;
  const nextActive = input.active !== undefined ? input.active : user.active;

  if (nextRole === "tt_head" && !nextTradePoint) {
    throw new ValidationError("Для роли «Руководитель ТТ» обязательно нужно указать торговую точку.");
  }

  const result = await pool.query<PublicUser>(
    `UPDATE users SET role = $1, trade_point = $2, active = $3 WHERE email = $4 RETURNING ${PUBLIC_COLUMNS}`,
    [nextRole, nextTradePoint, nextActive, email.toLowerCase()],
  );
  return result.rows[0];
}

// Аварийное восстановление доступа администратора через ADMIN_RECOVERY_CODE
// (см. docs/PASSPORT.md, блок 6, lockout-сценарий).
export async function recoverAdmin(email: string, fullName: string): Promise<CreateUserResult> {
  const existing = await findUserByEmail(email);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  if (existing) {
    const result = await pool.query<PublicUser>(
      `UPDATE users SET password_hash = $1, role = 'admin', active = true WHERE email = $2 RETURNING ${PUBLIC_COLUMNS}`,
      [passwordHash, email.toLowerCase()],
    );
    return { user: result.rows[0], temporaryPassword };
  }

  const result = await pool.query<PublicUser>(
    `INSERT INTO users (email, full_name, role, trade_point, password_hash)
     VALUES ($1, $2, 'admin', NULL, $3)
     RETURNING ${PUBLIC_COLUMNS}`,
    [email.toLowerCase(), fullName, passwordHash],
  );
  return { user: result.rows[0], temporaryPassword };
}
