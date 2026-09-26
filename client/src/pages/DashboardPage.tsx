// Экран /dashboard — docs/SPEC.md, раздел 6. Пустое состояние: «Нет данных — загрузите выгрузку».
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { formatMoney, daysAgoIso, todayIso } from "../lib/format";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";

interface DashboardMetrics {
  total_cancelled?: number;
  total_leads?: number;
  saved_amount?: number;
  won_amount?: number;
  potential_loss_amount?: number;
  potential_amount?: number;
  conversion_percent: number;
  work_coverage_percent: number;
}

interface DashboardResponse {
  empty: boolean;
  period: { from: string; to: string };
  openTasksCancellation: number;
  openTasksWarmLead: number;
  cancellation: DashboardMetrics | null;
  warmLead: DashboardMetrics | null;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div className="text-xs text-[var(--muted-fg)]">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </Card>
  );
}

export function DashboardPage() {
  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<DashboardResponse>(`/dashboard?from=${from}&to=${to}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить сводку."))
      .finally(() => setLoading(false));
  }, [from, to]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Сводка</h1>

      <Card className="mb-4 flex flex-wrap items-end gap-4">
        <div>
          <div className="mb-1 text-xs font-medium text-[var(--muted-fg)]">Период с</div>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-[var(--muted-fg)]">по</div>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </Card>

      {loading && <p className="text-sm text-[var(--muted-fg)]">Загрузка…</p>}
      {error && <p className="text-sm text-brand-error">{error}</p>}

      {!loading && data?.empty && (
        <Card>
          <p className="mb-2 text-sm">Нет данных — загрузите выгрузку.</p>
          <Link to="/import" className="text-sm text-brand-primary underline">
            Перейти к импорту выгрузки
          </Link>
        </Card>
      )}

      {!loading && data && !data.empty && (
        <div className="flex flex-col gap-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-[var(--muted-fg)]">Модуль «Отмены»</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Открытых задач" value={String(data.openTasksCancellation)} />
              <StatCard label="Всего отменено за период" value={String(data.cancellation?.total_cancelled ?? 0)} />
              <StatCard label="Сумма потенциальных потерь" value={formatMoney(data.cancellation?.potential_loss_amount ?? 0)} />
              <StatCard label="Спасённая сумма" value={formatMoney(data.cancellation?.saved_amount ?? 0)} />
              <StatCard label="Подтверждённая выручка (WON)" value={formatMoney(data.cancellation?.won_amount ?? 0)} />
              <StatCard label="Конверсия реанимации" value={`${data.cancellation?.conversion_percent ?? 0}%`} />
              <StatCard label="Покрытие отработки" value={`${data.cancellation?.work_coverage_percent ?? 0}%`} />
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-[var(--muted-fg)]">Модуль «Тёплые лиды»</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Открытых задач" value={String(data.openTasksWarmLead)} />
              <StatCard label="Всего лидов за период" value={String(data.warmLead?.total_leads ?? 0)} />
              <StatCard label="Потенциальная сумма" value={formatMoney(data.warmLead?.potential_amount ?? 0)} />
              <StatCard label="Реализованная сумма" value={formatMoney(data.warmLead?.won_amount ?? 0)} />
              <StatCard label="Конверсия в реализацию" value={`${data.warmLead?.conversion_percent ?? 0}%`} />
              <StatCard label="Покрытие отработки" value={`${data.warmLead?.work_coverage_percent ?? 0}%`} />
            </div>
          </section>

          <Link to="/reports" className="text-sm text-brand-primary underline">
            Открыть подробную отчётность →
          </Link>
        </div>
      )}
    </div>
  );
}
