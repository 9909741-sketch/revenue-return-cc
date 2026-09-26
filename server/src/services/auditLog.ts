// Запись в журнал действий (audit_log). Пустой перехват ошибок запрещён правилами репозитория,
// поэтому ошибка записи в журнал логируется в консоль, а не проглатывается молча.
import { pool } from "../db/pool";

export async function writeAudit(userEmail: string, action: string): Promise<void> {
  try {
    await pool.query("INSERT INTO audit_log (user_email, action) VALUES ($1, $2)", [userEmail, action]);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Не удалось записать audit_log:", error);
  }
}
