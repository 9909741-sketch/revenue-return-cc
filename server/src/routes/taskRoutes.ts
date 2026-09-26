// Общие маршруты задачника — используются и для /cancellations, и для /warm-leads
// на фронтенде (параметр type в query/URL отличает модуль).
import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { getCurrentUser, requireAuth } from "../middleware/auth";
import { getTaskWithTouches, listTasks, recordTouch, takeTask } from "../services/taskService";
import { requireOneOf, ValidationError } from "../utils/validation";

export const taskRoutes = Router();

taskRoutes.use(requireAuth);

function parseListParam(value: unknown): string[] | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

taskRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const actor = getCurrentUser(req);
    const type = requireOneOf(req.query.type, ["cancellation", "warm_lead"] as const, "Тип задачи");

    const tasks = await listTasks(actor, {
      type,
      statuses: parseListParam(req.query.statuses),
      tradePoints: parseListParam(req.query.tradePoints),
      operatorEmail: typeof req.query.operatorEmail === "string" ? req.query.operatorEmail : undefined,
      dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined,
      dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : undefined,
    });

    res.json({ tasks });
  }),
);

taskRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const actor = getCurrentUser(req);
    const { task, touches } = await getTaskWithTouches(actor, String(req.params.id));
    res.json({ task, touches });
  }),
);

taskRoutes.post(
  "/:id/take",
  asyncHandler(async (req, res) => {
    const actor = getCurrentUser(req);
    const task = await takeTask(actor, String(req.params.id));
    res.json({ task });
  }),
);

taskRoutes.post(
  "/:id/touch",
  asyncHandler(async (req, res) => {
    const actor = getCurrentUser(req);
    const resultCode = req.body?.resultCode;
    const comment = req.body?.comment;
    const nextStatus = req.body?.nextStatus;
    if (typeof resultCode !== "string" || typeof comment !== "string") {
      throw new ValidationError("Поля «результат звонка» и «комментарий» обязательны.");
    }
    const result = await recordTouch(actor, String(req.params.id), {
      resultCode,
      comment,
      nextStatus: typeof nextStatus === "string" ? nextStatus : undefined,
    });
    res.json(result);
  }),
);
