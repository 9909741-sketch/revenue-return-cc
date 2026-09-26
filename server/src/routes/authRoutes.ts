// Вход, выход, текущий пользователь и аварийное восстановление доступа администратора.
import { Router } from "express";
import { env } from "../env";
import { asyncHandler } from "../middleware/asyncHandler";
import { findUserByEmail, recoverAdmin } from "../services/users";
import { verifyPassword } from "../utils/password";
import { requireEmail, requireString } from "../utils/validation";
import { writeAudit } from "../services/auditLog";
import { SESSION_COOKIE_NAME } from "../session";

export const authRoutes = Router();

authRoutes.post(
  "/login",
  asyncHandler(async (req, res) => {
    const email = requireEmail(req.body?.email);
    const password = requireString(req.body?.password, "Пароль");

    const user = await findUserByEmail(email);
    const passwordOk = user ? await verifyPassword(password, user.password_hash) : false;

    if (!user || !passwordOk) {
      // Одинаковое сообщение для «нет такого email» и «неверный пароль» — не подсказываем
      // злоумышленнику, какие email существуют в системе.
      res.status(401).json({ error: "Неверный email или пароль." });
      return;
    }
    if (!user.active) {
      res.status(403).json({ error: "Учётная запись отключена. Обратитесь к администратору." });
      return;
    }

    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((error) => (error ? reject(error) : resolve()));
    });
    req.session.user = {
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      trade_point: user.trade_point,
    };
    await writeAudit(user.email, "Вход в систему");

    res.json({ user: req.session.user });
  }),
);

authRoutes.post("/logout", (req, res) => {
  const secureCookie = req.session?.cookie?.secure === true;
  req.session.destroy((error) => {
    if (error) {
      console.error("Session destruction failed during logout.", {
        method: req.method,
        route: "/api/auth/logout",
        requestId: req.diagnosticId,
        error,
      });
      res.status(500).json({ error: "Не удалось завершить сеанс. Попробуйте ещё раз." });
      return;
    }
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: secureCookie === true,
      sameSite: "lax",
      path: "/",
    });
    res.json({ ok: true });
  });
});

authRoutes.get("/me", (req, res) => {
  res.json({ user: req.session.user ?? null });
});

// Служебный эндпоинт восстановления доступа — только по точному совпадению секретного кода
// из переменной окружения ADMIN_RECOVERY_CODE (см. docs/PASSPORT.md, блок 6).
authRoutes.post(
  "/recover",
  asyncHandler(async (req, res) => {
    if (!env.adminRecoveryCode) {
      res.status(503).json({ error: "Функция восстановления недоступна: код восстановления не настроен." });
      return;
    }
    const code = requireString(req.body?.code, "Код восстановления");
    if (code !== env.adminRecoveryCode) {
      res.status(403).json({ error: "Неверный код восстановления." });
      return;
    }
    const email = requireEmail(req.body?.email);
    const fullName = requireString(req.body?.full_name ?? "Администратор (восстановлен)", "Имя");

    const result = await recoverAdmin(email, fullName);
    await writeAudit(email, "Аварийное восстановление доступа администратора через ADMIN_RECOVERY_CODE");

    res.json({
      user: result.user,
      temporaryPassword: result.temporaryPassword,
      note: "Пароль показан один раз. Сохраните его — повторно он показан не будет.",
    });
  }),
);
