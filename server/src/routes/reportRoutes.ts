// Отчётность (функция MVP №4). Права: оператор — нет доступа; руководитель КЦ, руководитель
// ТТ (только своя точка), администратор — просмотр (docs/PASSPORT.md, блок 6).
import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { getCurrentUser, requireAuth, requireRole } from "../middleware/auth";
import {
  computeCancellationReport,
  computeWarmLeadReport,
  previousPeriod,
  ReportCut,
} from "../services/reportService";
import { rowsToCsv } from "../utils/csvExport";
import { requireOneOf, requireString, ValidationError } from "../utils/validation";

export const reportRoutes = Router();

reportRoutes.use(requireAuth, requireRole("kc_head", "tt_head", "admin"));

const CUT_OPTIONS = ["operator", "trade_point", "tt_employee", "product_group", "channel"] as const;
const MODULE_OPTIONS = ["cancellation", "warm_lead"] as const;

interface ReportQuery {
  module: (typeof MODULE_OPTIONS)[number];
  from: string;
  to: string;
  cut: ReportCut;
}

function parseQuery(query: Record<string, unknown>): ReportQuery {
  const moduleName = requireOneOf(query.module, MODULE_OPTIONS, "Модуль отчёта");
  const from = requireString(query.from, "Начало периода");
  const to = requireString(query.to, "Конец периода");
  const cut = requireOneOf(query.cut, CUT_OPTIONS, "Разрез отчёта");
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    throw new ValidationError("Некорректные даты периода.");
  }
  return { module: moduleName, from, to, cut };
}

async function buildRows(actor: ReturnType<typeof getCurrentUser>, params: ReportQuery) {
  return params.module === "cancellation"
    ? computeCancellationReport(actor, params.from, params.to, params.cut)
    : computeWarmLeadReport(actor, params.from, params.to, params.cut);
}

reportRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const actor = getCurrentUser(req);
    const params = parseQuery(req.query as Record<string, unknown>);
    const rows = await buildRows(actor, params);

    let previousRows: Awaited<ReturnType<typeof buildRows>> | null = null;
    if (req.query.compare === "true") {
      const prev = previousPeriod(params.from, params.to);
      previousRows = await buildRows(actor, { ...params, from: prev.from, to: prev.to });
    }

    if (rows.length === 0) {
      res.json({ rows: [], previousRows, empty: true });
      return;
    }

    res.json({ rows, previousRows, empty: false });
  }),
);

reportRoutes.get(
  "/export.csv",
  asyncHandler(async (req, res) => {
    const actor = getCurrentUser(req);
    const params = parseQuery(req.query as Record<string, unknown>);
    // CSV строится из тех же вычисленных строк, что и экран — гарантия одинаковых цифр
    // (критерий приёмки №10).
    const rows = await buildRows(actor, params);
    const csv = rowsToCsv(rows as unknown as Record<string, string | number>[]);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="report_${params.module}_${params.from}_${params.to}.csv"`);
    res.send(csv);
  }),
);
