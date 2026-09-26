// Экран /reports — docs/SPEC.md, раздел 6 и раздел 8. Период + разрез, сравнение с
// предыдущим периодом, экспорт CSV с теми же цифрами, что на экране (критерий приёмки №10).
import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { daysAgoIso, todayIso } from "../lib/format";
import { Card } from "../components/ui/Card";
import { Select } from "../components/ui/Select";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";

const CUT_LABELS: Record<string, string> = {
  operator: "Оператор КЦ",
  trade_point: "Торговая точка",
  tt_employee: "Сотрудник ТТ",
  product_group: "Товарная группа",
  channel: "Канал обращения",
};

const CANCELLATION_COLUMNS: { key: string; label: string; isPercent?: boolean; isMoney?: boolean }[] = [
  { key: "total_cancelled", label: "Всего отменено" },
  { key: "cancel_share_percent", label: "Доля отмен", isPercent: true },
  { key: "cancel_bad_count", label: "Некорректные отмены" },
  { key: "cancel_bad_share_percent", label: "Доля некорректных", isPercent: true },
  { key: "saved_count", label: "Реанимировано" },
  { key: "conversion_percent", label: "Конверсия реанимации", isPercent: true },
  { key: "potential_loss_amount", label: "Сумма потерь", isMoney: true },
  { key: "saved_amount", label: "Сумма спасённых", isMoney: true },
  { key: "confirmed_won_amount", label: "Подтверждённая выручка", isMoney: true },
  { key: "return_rate_percent", label: "Коэффициент возврата", isPercent: true },
  { key: "work_coverage_percent", label: "Покрытие отработки", isPercent: true },
  { key: "avg_reaction_hours", label: "Средний срок реакции, ч" },
];

const WARM_LEAD_COLUMNS: { key: string; label: string; isPercent?: boolean; isMoney?: boolean }[] = [
  { key: "total_leads", label: "Всего лидов" },
  { key: "passed_tt_count", label: "Передано на ТТ" },
  { key: "passed_tt_share_percent", label: "Доля передачи на ТТ", isPercent: true },
  { key: "no_result_count", label: "Закрыто без результата" },
  { key: "no_result_share_percent", label: "Доля без результата", isPercent: true },
  { key: "won_count", label: "Реализовано" },
  { key: "conversion_percent", label: "Конверсия в реализацию", isPercent: true },
  { key: "potential_amount", label: "Потенциальная сумма", isMoney: true },
  { key: "won_amount", label: "Реализованная сумма", isMoney: true },
  { key: "revenue_conversion_percent", label: "Конверсия по выручке", isPercent: true },
  { key: "work_coverage_percent", label: "Покрытие отработки", isPercent: true },
  { key: "avg_reaction_hours", label: "Средний срок реакции, ч" },
];

function formatCell(value: unknown, col: { isPercent?: boolean; isMoney?: boolean }): string {
  if (value == null) return "—";
  if (col.isPercent) return `${value}%`;
  if (col.isMoney) return new Intl.NumberFormat("ru-RU").format(Number(value)) + " ₽";
  return String(value);
}

export function ReportsPage() {
  const [module, setModule] = useState<"cancellation" | "warm_lead">("cancellation");
  const [cut, setCut] = useState("trade_point");
  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());
  const [compare, setCompare] = useState(false);

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [previousRows, setPreviousRows] = useState<Record<string, unknown>[] | null>(null);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const columns = module === "cancellation" ? CANCELLATION_COLUMNS : WARM_LEAD_COLUMNS;

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ module, cut, from, to, compare: String(compare) });
    api
      .get<{ rows: Record<string, unknown>[]; previousRows: Record<string, unknown>[] | null; empty: boolean }>(
        `/reports?${params.toString()}`,
      )
      .then((data) => {
        setRows(data.rows);
        setPreviousRows(data.previousRows);
        setEmpty(data.empty);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось построить отчёт."))
      .finally(() => setLoading(false));
  }, [module, cut, from, to, compare]);

  function exportCsv() {
    const params = new URLSearchParams({ module, cut, from, to });
    window.location.href = `/api/reports/export.csv?${params.toString()}`;
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Отчётность</h1>

      <Card className="mb-4 flex flex-wrap items-end gap-4">
        <div>
          <div className="mb-1 text-xs font-medium text-[var(--muted-fg)]">Модуль</div>
          <Select value={module} onChange={(e) => setModule(e.target.value as "cancellation" | "warm_lead")}>
            <option value="cancellation">Отмены</option>
            <option value="warm_lead">Тёплые лиды</option>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-[var(--muted-fg)]">Разрез</div>
          <Select value={cut} onChange={(e) => setCut(e.target.value)}>
            {Object.entries(CUT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-[var(--muted-fg)]">Период с</div>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-[var(--muted-fg)]">по</div>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
          Сравнить с предыдущим периодом
        </label>
        <Button variant="secondary" onClick={exportCsv} disabled={empty}>
          Экспорт CSV
        </Button>
      </Card>

      {loading && <p className="text-sm text-[var(--muted-fg)]">Загрузка…</p>}
      {error && <p className="text-sm text-brand-error">{error}</p>}

      {!loading && !error && empty && (
        <Card>
          <p className="text-sm">Нет данных за выбранный период. Загрузите выгрузку на экране «Импорт».</p>
        </Card>
      )}

      {!loading && !error && !empty && (
        <Card className="overflow-x-auto" noPadding>
          <table className="table-compact w-full min-w-[1000px] text-left text-sm">
            <thead className="border-b border-[var(--surface-border)] text-xs text-[var(--muted-fg)]">
              <tr>
                <th className="px-3">{CUT_LABELS[cut]}</th>
                {columns.map((col) => (
                  <th key={col.key} className="px-3">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.cut_value)} className="border-b border-[var(--surface-border)] last:border-0">
                  <td className="px-3 font-medium">{String(row.cut_value)}</td>
                  {columns.map((col) => (
                    <td key={col.key} className="px-3">
                      {formatCell(row[col.key], col)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {!loading && !error && !empty && compare && previousRows && previousRows.length > 0 && (
        <div className="mt-4">
          <h2 className="mb-2 text-sm font-semibold text-[var(--muted-fg)]">Предыдущий период (для сравнения)</h2>
          <Card className="overflow-x-auto" noPadding>
            <table className="table-compact w-full min-w-[1000px] text-left text-sm">
              <thead className="border-b border-[var(--surface-border)] text-xs text-[var(--muted-fg)]">
                <tr>
                  <th className="px-3">{CUT_LABELS[cut]}</th>
                  {columns.map((col) => (
                    <th key={col.key} className="px-3">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previousRows.map((row) => (
                  <tr key={String(row.cut_value)} className="border-b border-[var(--surface-border)] last:border-0">
                    <td className="px-3 font-medium">{String(row.cut_value)}</td>
                    {columns.map((col) => (
                      <td key={col.key} className="px-3">
                        {formatCell(row[col.key], col)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
