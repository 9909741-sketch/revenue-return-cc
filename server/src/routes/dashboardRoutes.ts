// Сводка — docs/PASSPORT.md, блок 4: доступна руководителю КЦ, руководителю ТТ (частично,
// только своя точка — обеспечивается внутри dashboardService) и администратору.
import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { getCurrentUser, requireAuth, requireRole } from "../middleware/auth";
import { getDashboard } from "../services/dashboardService";

export const dashboardRoutes = Router();

dashboardRoutes.use(requireAuth, requireRole("kc_head", "tt_head", "admin"));

dashboardRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const actor = getCurrentUser(req);
    const now = new Date();
    const defaultTo = now.toISOString().slice(0, 10);
    const defaultFromDate = new Date(now);
    defaultFromDate.setDate(defaultFromDate.getDate() - 30);
    const defaultFrom = defaultFromDate.toISOString().slice(0, 10);

    const from = typeof req.query.from === "string" ? req.query.from : defaultFrom;
    const to = typeof req.query.to === "string" ? req.query.to : defaultTo;

    const result = await getDashboard(actor, from, to);
    res.json(result);
  }),
);
