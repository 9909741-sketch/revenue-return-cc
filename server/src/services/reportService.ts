// Отчётность (функция MVP №4). Формулы модуля 1 — docs/SPEC.md, раздел 8.
// Формулы модуля 2 — в проекте нет отдельного документа «база знаний, раздел 3.5»
// (SPEC ссылается на файл, которого нет в репозитории), поэтому метрики модуля 2
// построены по аналогии с модулем 1, как и требует SPEC («реализуются по тем же
// формулам») — решение зафиксировано в docs/CHANGELOG.md.
import { pool } from "../db/pool";
import { AuthenticatedUser } from "../middleware/auth";
import { ValidationError } from "../utils/validation";

export type ReportCut = "operator" | "trade_point" | "tt_employee" | "product_group" | "channel";

interface DealJoinRow {
  deal_id: string;
  amount: number | null;
  trade_point: string;
  tt_employee: string;
  product_group: string | null;
  channel: string | null;
  status_changed_at: string;
  created_at: string;
  transferred_at: string | null;
  kc_operator_email: string;
  kc_operator_name: string | null;
  cancellation_status: string | null;
  cancellation_task_id: string | null;
  warm_lead_status: string | null;
  warm_lead_task_id: string | null;
}

async function fetchJoinedDeals(actor: AuthenticatedUser, from: string, to: string): Promise<DealJoinRow[]> {
  const params: unknown[] = [from, to];
  let tradePointFilter = "";
  if (actor.role === "tt_head") {
    params.push(actor.trade_point);
    tradePointFilter = `AND d.trade_point = $${params.length}`;
  }

  const result = await pool.query<DealJoinRow>(
    `SELECT
       d.deal_id, d.amount, d.trade_point, d.tt_employee, d.product_group, d.channel,
       d.status_changed_at, d.created_at, d.transferred_at,
       d.kc_operator_email, ko.full_name AS kc_operator_name,
       tc.status AS cancellation_status, tc.task_id AS cancellation_task_id,
       tw.status AS warm_lead_status, tw.task_id AS warm_lead_task_id
     FROM deals d
     LEFT JOIN users ko ON ko.email = d.kc_operator_email
     LEFT JOIN tasks tc ON tc.deal_id = d.deal_id AND tc.type = 'cancellation' AND tc.deleted_at IS NULL
     LEFT JOIN tasks tw ON tw.deal_id = d.deal_id AND tw.type = 'warm_lead' AND tw.deleted_at IS NULL
     WHERE d.deleted_at IS NULL
       AND d.status_changed_at >= $1 AND d.status_changed_at <= $2
       ${tradePointFilter}`,
    params,
  );
  return result.rows;
}

async function fetchFirstTouchMap(): Promise<Map<string, Date>> {
  const result = await pool.query<{ task_id: string; first_touch: string }>(
    "SELECT task_id, MIN(happened_at) AS first_touch FROM touches GROUP BY task_id",
  );
  const map = new Map<string, Date>();
  for (const row of result.rows) {
    map.set(row.task_id, new Date(row.first_touch));
  }
  return map;
}

function cutValue(row: DealJoinRow, cut: ReportCut): string {
  switch (cut) {
    case "operator":
      // Разрез по оператору — владелец сделки из выгрузки (d.kc_operator_email), а не
      // исполнитель конкретной задачи: в MVP переназначение задач между операторами не
      // реализовано (см. docs/CHANGELOG.md), эти значения всегда совпадают, а использование
      // deal-уровня корректно считает знаменатель «передано на ТТ» и для сделок без задачи.
      return row.kc_operator_name || row.kc_operator_email || "Не назначен";
    case "trade_point":
      return row.trade_point || "Не указана";
    case "tt_employee":
      return row.tt_employee || "Не указан";
    case "product_group":
      return row.product_group || "Не указана";
    case "channel":
      return row.channel || "Не указан";
    default:
      return "Все";
  }
}

export interface CancellationMetricsRow {
  cut_value: string;
  total_cancelled: number;
  transferred_total: number;
  cancel_share_percent: number;
  cancel_bad_count: number;
  cancel_bad_share_percent: number;
  saved_count: number;
  conversion_percent: number;
  potential_loss_amount: number;
  saved_amount: number;
  confirmed_won_amount: number;
  return_rate_percent: number;
  work_coverage_percent: number;
  avg_reaction_hours: number;
}

export interface WarmLeadMetricsRow {
  cut_value: string;
  total_leads: number;
  passed_tt_count: number;
  passed_tt_share_percent: number;
  no_result_count: number;
  no_result_share_percent: number;
  won_count: number;
  conversion_percent: number;
  potential_amount: number;
  won_amount: number;
  revenue_conversion_percent: number;
  work_coverage_percent: number;
  avg_reaction_hours: number;
}

function safeDivide(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function metricsForCancellationRows(
  groupRows: DealJoinRow[],
  firstTouchByTask: Map<string, Date>,
): Omit<CancellationMetricsRow, "cut_value"> {
  const cancelledRows = groupRows.filter((r) => r.cancellation_task_id);
  const transferredTotal = groupRows.filter((r) => r.transferred_at).length;
  const cancelBad = cancelledRows.filter((r) => r.cancellation_status === "CANCEL_BAD");
  const saved = cancelledRows.filter((r) => r.cancellation_status === "REPASS" || r.cancellation_status === "WON");
  const worked = cancelledRows.filter((r) => r.cancellation_status !== "NEW");
  const won = cancelledRows.filter((r) => r.cancellation_status === "WON");

  // Сумма сделки хранится как numeric (число или null) — сделки без суммы исключены
  // из денежных метрик (критерий приёмки №3).
  const sumAmount = (list: DealJoinRow[]) =>
    list.reduce((acc, r) => acc + (r.amount == null ? 0 : Number(r.amount)), 0);

  const reactionHours: number[] = [];
  for (const r of cancelledRows) {
    if (!r.cancellation_task_id) continue;
    const firstTouch = firstTouchByTask.get(r.cancellation_task_id);
    if (!firstTouch) continue;
    const hours = (firstTouch.getTime() - new Date(r.status_changed_at).getTime()) / (1000 * 60 * 60);
    if (hours >= 0) reactionHours.push(hours);
  }
  const avgReaction = reactionHours.length
    ? reactionHours.reduce((a, b) => a + b, 0) / reactionHours.length
    : 0;

  return {
    total_cancelled: cancelledRows.length,
    transferred_total: transferredTotal,
    cancel_share_percent: safeDivide(cancelledRows.length, transferredTotal),
    cancel_bad_count: cancelBad.length,
    cancel_bad_share_percent: safeDivide(cancelBad.length, cancelledRows.length),
    saved_count: saved.length,
    conversion_percent: safeDivide(saved.length, worked.length),
    potential_loss_amount: round2(sumAmount(cancelledRows)),
    saved_amount: round2(sumAmount(saved)),
    confirmed_won_amount: round2(sumAmount(won)),
    return_rate_percent: safeDivide(sumAmount(saved), sumAmount(cancelledRows)),
    work_coverage_percent: safeDivide(worked.length, cancelledRows.length),
    avg_reaction_hours: round2(avgReaction),
  };
}

export async function computeCancellationReport(
  actor: AuthenticatedUser,
  from: string,
  to: string,
  cut: ReportCut,
): Promise<CancellationMetricsRow[]> {
  const rows = await fetchJoinedDeals(actor, from, to);
  const firstTouchByTask = await fetchFirstTouchMap();

  const groups = new Map<string, DealJoinRow[]>();
  for (const row of rows) {
    const key = cutValue(row, cut);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const result: CancellationMetricsRow[] = [];
  for (const [key, groupRows] of groups) {
    result.push({ cut_value: key, ...metricsForCancellationRows(groupRows, firstTouchByTask) });
  }

  return result.sort((a, b) => b.total_cancelled - a.total_cancelled);
}

export async function computeCancellationTotal(
  actor: AuthenticatedUser,
  from: string,
  to: string,
): Promise<Omit<CancellationMetricsRow, "cut_value">> {
  const rows = await fetchJoinedDeals(actor, from, to);
  const firstTouchByTask = await fetchFirstTouchMap();
  return metricsForCancellationRows(rows, firstTouchByTask);
}

function metricsForWarmLeadRows(
  groupRows: DealJoinRow[],
  firstTouchByTask: Map<string, Date>,
): Omit<WarmLeadMetricsRow, "cut_value"> {
  const leadRows = groupRows.filter((r) => r.warm_lead_task_id);
  const passedTt = leadRows.filter((r) => r.warm_lead_status === "PASSED_TT");
  const noResult = leadRows.filter((r) => r.warm_lead_status === "NO_RESULT");
  const won = leadRows.filter((r) => r.warm_lead_status === "WON");
  const worked = leadRows.filter((r) => r.warm_lead_status !== "NEW");

  const sumAmount = (list: DealJoinRow[]) =>
    list.reduce((acc, r) => acc + (r.amount == null ? 0 : Number(r.amount)), 0);

  const reactionHours: number[] = [];
  for (const r of leadRows) {
    if (!r.warm_lead_task_id) continue;
    const firstTouch = firstTouchByTask.get(r.warm_lead_task_id);
    if (!firstTouch) continue;
    const hours = (firstTouch.getTime() - new Date(r.created_at).getTime()) / (1000 * 60 * 60);
    if (hours >= 0) reactionHours.push(hours);
  }
  const avgReaction = reactionHours.length
    ? reactionHours.reduce((a, b) => a + b, 0) / reactionHours.length
    : 0;

  return {
    total_leads: leadRows.length,
    passed_tt_count: passedTt.length,
    passed_tt_share_percent: safeDivide(passedTt.length, leadRows.length),
    no_result_count: noResult.length,
    no_result_share_percent: safeDivide(noResult.length, leadRows.length),
    won_count: won.length,
    conversion_percent: safeDivide(won.length, worked.length),
    potential_amount: round2(sumAmount(leadRows)),
    won_amount: round2(sumAmount(won)),
    revenue_conversion_percent: safeDivide(sumAmount(won), sumAmount(leadRows)),
    work_coverage_percent: safeDivide(worked.length, leadRows.length),
    avg_reaction_hours: round2(avgReaction),
  };
}

export async function computeWarmLeadReport(
  actor: AuthenticatedUser,
  from: string,
  to: string,
  cut: ReportCut,
): Promise<WarmLeadMetricsRow[]> {
  const rows = await fetchJoinedDeals(actor, from, to);
  const firstTouchByTask = await fetchFirstTouchMap();

  const groups = new Map<string, DealJoinRow[]>();
  for (const row of rows) {
    const key = cutValue(row, cut);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const result: WarmLeadMetricsRow[] = [];
  for (const [key, groupRows] of groups) {
    result.push({ cut_value: key, ...metricsForWarmLeadRows(groupRows, firstTouchByTask) });
  }

  return result.sort((a, b) => b.total_leads - a.total_leads);
}

export async function computeWarmLeadTotal(
  actor: AuthenticatedUser,
  from: string,
  to: string,
): Promise<Omit<WarmLeadMetricsRow, "cut_value">> {
  const rows = await fetchJoinedDeals(actor, from, to);
  const firstTouchByTask = await fetchFirstTouchMap();
  return metricsForWarmLeadRows(rows, firstTouchByTask);
}

// Сравнение с предыдущим периодом той же длины (docs/SPEC.md, раздел 8).
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const lengthMs = toDate.getTime() - fromDate.getTime();
  if (lengthMs < 0) {
    throw new ValidationError("Дата начала периода должна быть раньше даты окончания.");
  }
  const prevTo = new Date(fromDate.getTime() - 24 * 60 * 60 * 1000);
  const prevFrom = new Date(prevTo.getTime() - lengthMs);
  return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) };
}
