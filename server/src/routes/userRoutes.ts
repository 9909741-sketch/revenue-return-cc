// Управление пользователями — доступно только администратору (docs/PASSPORT.md, блок 6, матрица прав).
import { Router } from "express";
import { USER_ROLES } from "../domain/statusCodes";
import { asyncHandler } from "../middleware/asyncHandler";
import { getCurrentUser, requireAuth, requireRole } from "../middleware/auth";
import { writeAudit } from "../services/auditLog";
import { createUser, listUsers, resetUserPassword, updateUser } from "../services/users";
import { requireEmail, requireOneOf, requireString } from "../utils/validation";

export const userRoutes = Router();

userRoutes.use(requireAuth, requireRole("admin"));

userRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    const users = await listUsers();
    res.json({ users });
  }),
);

userRoutes.post(
  "/",
  asyncHandler(async (req, res) => {
    const actor = getCurrentUser(req);
    const email = requireEmail(req.body?.email);
    const fullName = requireString(req.body?.full_name, "ФИО");
    const role = requireOneOf(req.body?.role, USER_ROLES, "Роль");
    const tradePoint = typeof req.body?.trade_point === "string" ? req.body.trade_point.trim() || null : null;

    const result = await createUser({ email, full_name: fullName, role, trade_point: tradePoint });
    await writeAudit(actor.email, `Создан пользователь ${email} с ролью ${role}`);

    res.status(201).json({
      user: result.user,
      temporaryPassword: result.temporaryPassword,
      note: "Временный пароль показан один раз. Передайте его сотруднику лично.",
    });
  }),
);

userRoutes.post(
  "/:email/reset-password",
  asyncHandler(async (req, res) => {
    const actor = getCurrentUser(req);
    const targetEmail = requireEmail(req.params.email);
    const temporaryPassword = await resetUserPassword(targetEmail);
    await writeAudit(actor.email, `Сброшен пароль пользователю ${targetEmail}`);

    res.json({
      temporaryPassword,
      note: "Временный пароль показан один раз. Передайте его сотруднику лично.",
    });
  }),
);

userRoutes.patch(
  "/:email",
  asyncHandler(async (req, res) => {
    const actor = getCurrentUser(req);
    const targetEmail = requireEmail(req.params.email);
    const role = req.body?.role !== undefined ? requireOneOf(req.body.role, USER_ROLES, "Роль") : undefined;
    const tradePoint =
      req.body?.trade_point !== undefined
        ? (typeof req.body.trade_point === "string" ? req.body.trade_point.trim() || null : null)
        : undefined;
    const active = req.body?.active !== undefined ? Boolean(req.body.active) : undefined;

    const updated = await updateUser(targetEmail, { role, trade_point: tradePoint, active });
    await writeAudit(actor.email, `Изменён пользователь ${targetEmail}`);

    res.json({ user: updated });
  }),
);
