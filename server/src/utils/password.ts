// Хэширование паролей и генерация временных паролей.
// Используем bcryptjs (чистый JS) вместо bcrypt — не требует нативной компиляции
// при установке (см. docs/CHANGELOG.md).
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const SALT_ROUNDS = 10;

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}

// Временный пароль для нового пользователя или сброса — показывается администратору один раз,
// нигде не сохраняется в открытом виде (см. docs/PASSPORT.md, lockout-сценарий).
export function generateTemporaryPassword(): string {
  // 10 символов из букв (без похожих друг на друга) и цифр — легко продиктовать по телефону.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(10);
  let password = "";
  for (let i = 0; i < 10; i += 1) {
    password += alphabet[bytes[i] % alphabet.length];
  }
  return password;
}
