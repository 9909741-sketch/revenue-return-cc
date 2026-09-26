// Сводка (docs/SPEC.md, раздел 6, экран /dashboard). Показывает ключевые метрики обоих
// модулей за период. Пустое состояние — «Нет данных — загрузите выгрузку», когда в системе
// вообще нет ни одной сделки (в отличие от /reports, где «нет данных за период» — про
// конкретный выбранный период).
import { pool } from "../db/pool";
import { AuthenticatedUser } from "../middleware/auth";
import { computeCancellationTotal, computeWarmLeadTotal } from "./reportService";

export interface DashboardResult {
  empty: boolean;
  period: { from: string; to: string };
  openTasksCancellation: number;
  openTasksWarmLead: number;
  cancellation: Awaited<ReturnType<typeof computeCancellationTotal>> | null;
  warmLead: Awaited<ReturnType<typeof computeWarmLeadTotal>> | null;
}

export async function getDashboard(actor: AuthenticatedUser, from: string, to: string): Promise<DashboardResult> {
  const totalDealsResult = await pool.query<{ count: string }>("SELECT count(*) FROM deals WHERE deleted_at IS NULL");
  const totalDeals = Number(totalDealsResult.rows[0].count);

  if (totalDeals === 0) {
    return {
      empty: true,
      period: { from, to },
      openTasksCancellation: 0,
      openTasksWarmLead: 0,
      cancellation: null,
      warmLead: null,
    };
  }

  const openStatusParams: unknown[] = [];
  let tradePointFilter = "";
  if (actor.role === "tt_head") {
    openStatusParams.push(actor.trade_point);
    tradePointFilter = `AND d.trade_point = $1`;
  }

  const openCancellation = await pool.query<{ count: string }>(
    `SELECT count(*) FROM tasks t JOIN deals d ON d.deal_id = t.deal_id
     WHERE t.type = 'cancellation' AND t.status IN ('NEW','WIP','NO_ANSWER') AND t.deleted_at IS NULL ${tradePointFilter}`,
    openStatusParams,
  );
  const openWarmLead = await pool.query<{ count: string }>(
    `SELECT count(*) FROM tasks t JOIN deals d ON d.deal_id = t.deal_id
     WHERE t.type = 'warm_lead' AND t.status IN ('NEW','WIP') AND t.deleted_at IS NULL ${tradePointFilter}`,
    openStatusParams,
  );

  const [cancellation, warmLead] = await Promise.all([
    computeCancellationTotal(actor, from, to),
    computeWarmLeadTotal(actor, from, to),
  ]);

  return {
    empty: false,
    period: { from, to },
    openTasksCancellation: Number(openCancellation.rows[0].count),
    openTasksWarmLead: Number(openWarmLead.rows[0].count),
    cancellation,
    warmLead,
  };
}
