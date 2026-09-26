// Экран /import — docs/SPEC.md, раздел 6. Админ — загрузка и маппинг столбцов,
// руководитель КЦ — только просмотр истории загрузок.
import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ImportBatch } from "../lib/types";
import { formatDateTime } from "../lib/format";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";

const FIELD_LABELS: Record<string, string> = {
  deal_id: "Идентификатор сделки",
  created_at: "Дата создания сделки",
  status_changed_at: "Дата изменения статуса",
  source_stage: "Текущий статус",
  classification: "Классификация сделки",
  amount: "Сумма сделки",
  kc_operator_email: "Оператор КЦ (email)",
  trade_point: "Торговая точка",
  tt_employee: "Ответственный на ТТ",
  transferred_at: "Дата передачи на ТТ",
  cancel_reason_code: "Причина отмены",
  cancel_comment: "Комментарий к отмене",
  client_phone: "Телефон клиента",
  client_name: "Имя клиента",
  product_group: "Товарная группа",
  channel: "Канал обращения",
};

export function ImportPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [fields, setFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<ImportBatch | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [mappingSaved, setMappingSaved] = useState(false);

  function loadAll() {
    setLoading(true);
    Promise.all([
      api.get<{ batches: ImportBatch[] }>("/import/batches"),
      api.get<{ mapping: Record<string, string>; fields: string[] }>("/import/mapping"),
    ])
      .then(([batchesData, mappingData]) => {
        setBatches(batchesData.batches);
        setMapping(mappingData.mapping);
        setFields(mappingData.fields);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить данные импорта."))
      .finally(() => setLoading(false));
  }

  useEffect(loadAll, []);

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await api.postForm<{ batch: ImportBatch }>("/import/upload", formData);
      setUploadResult(result.batch);
      setFile(null);
      loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить файл.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveMapping(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMappingSaved(false);
    try {
      await api.put("/import/mapping", { mapping });
      setMappingSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить маппинг.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Импорт выгрузки</h1>

      {error && <p className="text-sm text-brand-error">{error}</p>}

      {isAdmin && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Загрузить файл (XLSX или CSV)</h2>
          <form onSubmit={handleUpload} className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
            <Button type="submit" disabled={!file || busy}>
              {busy ? "Загружаем…" : "Загрузить"}
            </Button>
          </form>
          {uploadResult && (
            <div className="mt-3 rounded-md bg-brand-success/10 p-3 text-sm">
              Готово: всего строк {uploadResult.rows_total}, новых {uploadResult.rows_new}, обновлено{" "}
              {uploadResult.rows_updated}, ошибок {uploadResult.rows_errors}.
              {uploadResult.errors_detail.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-xs text-brand-error">
                  {uploadResult.errors_detail.map((e) => (
                    <li key={e.row_number}>
                      Строка {e.row_number}: {e.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}

      {isAdmin && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Маппинг столбцов выгрузки</h2>
          <p className="mb-3 text-xs text-[var(--muted-fg)]">
            Укажите, какому заголовку столбца в вашем файле соответствует каждое поле модели данных.
            Реальные названия колонок конкретного портала Битрикс24 могут отличаться от значений по умолчанию.
          </p>
          <form onSubmit={handleSaveMapping} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {fields.map((field) => (
              <label key={field} className="text-sm">
                {FIELD_LABELS[field] ?? field}
                <Input
                  className="mt-1"
                  value={mapping[field] ?? ""}
                  onChange={(e) => setMapping((prev) => ({ ...prev, [field]: e.target.value }))}
                />
              </label>
            ))}
            <div className="md:col-span-2">
              <Button type="submit" variant="secondary" disabled={busy}>
                Сохранить маппинг
              </Button>
              {mappingSaved && <span className="ml-3 text-sm text-brand-success">Сохранено.</span>}
            </div>
          </form>
        </Card>
      )}

      <Card>
        <h2 className="mb-2 text-sm font-semibold">История загрузок</h2>
        {loading && <p className="text-sm text-[var(--muted-fg)]">Загрузка…</p>}
        {!loading && batches.length === 0 && <p className="text-sm text-[var(--muted-fg)]">Выгрузок ещё не было.</p>}
        {!loading && batches.length > 0 && (
          <table className="table-compact w-full text-left text-sm">
            <thead className="border-b border-[var(--surface-border)] text-xs text-[var(--muted-fg)]">
              <tr>
                <th className="px-2">Дата</th>
                <th className="px-2">Файл</th>
                <th className="px-2">Кто загрузил</th>
                <th className="px-2">Всего</th>
                <th className="px-2">Новых</th>
                <th className="px-2">Обновлено</th>
                <th className="px-2">Ошибок</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.batch_id} className="border-b border-[var(--surface-border)] last:border-0">
                  <td className="px-2">{formatDateTime(b.uploaded_at)}</td>
                  <td className="px-2">{b.original_filename}</td>
                  <td className="px-2">{b.uploaded_by}</td>
                  <td className="px-2">{b.rows_total}</td>
                  <td className="px-2">{b.rows_new}</td>
                  <td className="px-2">{b.rows_updated}</td>
                  <td className="px-2">{b.rows_errors}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
