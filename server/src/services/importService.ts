// Импорт выгрузки Б24 (функция MVP №1). Источник правил — docs/SPEC.md, раздел 3,
// docs/PASSPORT.md, блок 2 (пункт 1) и блок 5.
import { parse as parseCsv } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { PoolClient } from "pg";
import { pool } from "../db/pool";
import {
  CANCEL_REASONS,
  CancelReasonCode,
  CANCELLATION_FINAL_STATUSES,
  DealClassification,
  WARM_LEAD_FINAL_STATUSES,
} from "../domain/statusCodes";
import { calculatePriority } from "../domain/priority";
import { computeNextTouchDate } from "../domain/touchSchedule";
import { getColumnMapping, ImportFieldKey } from "./columnMapping";
import { ImportBatchRow, ImportRowError } from "../types/models";
import { ValidationError } from "../utils/validation";

// --- Разбор файла в список «сырых» строк (заголовок → значение) ---

function detectCsvDelimiter(headerLine: string): string {
  const semicolons = (headerLine.match(/;/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  // По умолчанию — точка с запятой, как указано в docs/SPEC.md, раздел 3.
  return commas > semicolons ? "," : ";";
}

function parseRows(buffer: Buffer, originalFilename: string): Record<string, unknown>[] {
  const lowerName = originalFilename.toLowerCase();
  if (lowerName.endsWith(".csv")) {
    const text = buffer.toString("utf-8");
    const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
    const delimiter = detectCsvDelimiter(firstLine);
    const records = parseCsv(text, {
      columns: true,
      delimiter,
      bom: true,
      trim: true,
      skip_empty_lines: true,
    }) as Record<string, unknown>[];
    return records;
  }

  // .xlsx / .xls — cellDates: true, чтобы даты приходили как объекты Date, а не как
  // числовые Excel-коды (иначе пришлось бы отдельно разбирать серийные номера дат).
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return [];
  }
  const sheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
}

// --- Нормализация отдельных значений ---

function parseFlexibleDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return null;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  const ruMatch = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/.exec(text);
  if (ruMatch) {
    const day = ruMatch[1].padStart(2, "0");
    const month = ruMatch[2].padStart(2, "0");
    const year = ruMatch[3];
    return `${year}-${month}-${day}`;
  }
  return null;
}

function parseAmount(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.replace(/[\s ]/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

// Реальные значения поля «Классификация сделки» в конкретной выгрузке Б24 не подтверждены
// (см. RISKS.md, пункт 1) — принято рабочее правило: если текст содержит корень «тепл»,
// считаем сделку тёплым лидом, иначе — обычной сделкой.
function normalizeClassification(value: unknown): DealClassification {
  const text = String(value ?? "").trim().toLowerCase();
  return text.includes("тепл") ? "тёплый_лид" : "обычная";
}

// Аналогично: считаем сделку отменённой, если текст стадии содержит корень «отмен».
function isCancelledStage(sourceStage: string): boolean {
  return /отмен/i.test(sourceStage);
}

function normalizeCancelReason(value: unknown): CancelReasonCode | null {
  const text = String(value ?? "").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(CANCEL_REASONS, text) ? (text as CancelReasonCode) : null;
}

// --- Результат обработки одной строки ---

interface ParsedRow {
  deal_id: string;
  created_at: string;
  status_changed_at: string;
  source_stage: string;
  classification: DealClassification;
  amount: number | null;
  kc_operator_email: string;
  trade_point: string;
  tt_employee: string;
  transferred_at: string | null;
  cancel_reason_code: CancelReasonCode | null;
  cancel_comment: string | null;
  client_phone: string;
  client_name: string;
  product_group: string | null;
  channel: string | null;
}

function readMappedValue(
  raw: Record<string, unknown>,
  mapping: Record<ImportFieldKey, string>,
  field: ImportFieldKey,
): unknown {
  const columnName = mapping[field];
  return raw[columnName];
}

function validateAndNormalizeRow(
  raw: Record<string, unknown>,
  mapping: Record<ImportFieldKey, string>,
): { row: ParsedRow } | { error: string } {
  const get = (field: ImportFieldKey) => readMappedValue(raw, mapping, field);

  const dealId = String(get("deal_id") ?? "").trim();
  const createdAt = parseFlexibleDate(get("created_at"));
  const statusChangedAt = parseFlexibleDate(get("status_changed_at"));
  const sourceStage = String(get("source_stage") ?? "").trim();
  const classificationRaw = get("classification");
  const kcOperatorEmail = String(get("kc_operator_email") ?? "").trim().toLowerCase();
  const tradePoint = String(get("trade_point") ?? "").trim();
  const ttEmployee = String(get("tt_employee") ?? "").trim();
  const clientPhone = String(get("client_phone") ?? "").trim();
  const clientName = String(get("client_name") ?? "").trim();

  const missing: string[] = [];
  if (!dealId) missing.push("Идентификатор сделки");
  if (!createdAt) missing.push("Дата создания сделки");
  if (!statusChangedAt) missing.push("Дата изменения статуса");
  if (!sourceStage) missing.push("Текущий статус");
  if (!classificationRaw) missing.push("Классификация сделки");
  if (!kcOperatorEmail) missing.push("Оператор КЦ");
  if (!tradePoint) missing.push("Торговая точка");
  if (!ttEmployee) missing.push("Ответственный на ТТ");
  if (!clientPhone) missing.push("Телефон клиента");
  if (!clientName) missing.push("Имя клиента");

  if (missing.length > 0) {
    return { error: `не заполнены обязательные поля: ${missing.join(", ")}` };
  }

  const row: ParsedRow = {
    deal_id: dealId,
    created_at: createdAt as string,
    status_changed_at: statusChangedAt as string,
    source_stage: sourceStage,
    classification: normalizeClassification(classificationRaw),
    amount: parseAmount(get("amount")),
    kc_operator_email: kcOperatorEmail,
    trade_point: tradePoint,
    tt_employee: ttEmployee,
    transferred_at: parseFlexibleDate(get("transferred_at")),
    cancel_reason_code: normalizeCancelReason(get("cancel_reason_code")),
    cancel_comment: (String(get("cancel_comment") ?? "").trim() || null),
    client_phone: clientPhone,
    client_name: clientName,
    product_group: (String(get("product_group") ?? "").trim() || null),
    channel: (String(get("channel") ?? "").trim() || null),
  };
  return { row };
}

// --- Применение строки к БД: upsert сделки + upsert задач ---

async function upsertDeal(client: PoolClient, row: ParsedRow): Promise<boolean> {
  const result = await client.query<{ is_insert: boolean }>(
    `INSERT INTO deals (
       deal_id, created_at, status_changed_at, source_stage, classification, amount,
       kc_operator_email, trade_point, tt_employee, transferred_at, cancel_reason_code,
       cancel_comment, client_phone, client_name, product_group, channel, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
     ON CONFLICT (deal_id) DO UPDATE SET
       created_at = EXCLUDED.created_at,
       status_changed_at = EXCLUDED.status_changed_at,
       source_stage = EXCLUDED.source_stage,
       classification = EXCLUDED.classification,
       amount = EXCLUDED.amount,
       kc_operator_email = EXCLUDED.kc_operator_email,
       trade_point = EXCLUDED.trade_point,
       tt_employee = EXCLUDED.tt_employee,
       transferred_at = EXCLUDED.transferred_at,
       cancel_reason_code = EXCLUDED.cancel_reason_code,
       cancel_comment = EXCLUDED.cancel_comment,
       client_phone = EXCLUDED.client_phone,
       client_name = EXCLUDED.client_name,
       product_group = EXCLUDED.product_group,
       channel = EXCLUDED.channel,
       updated_at = now()
     RETURNING (xmax = 0) AS is_insert`,
    [
      row.deal_id,
      row.created_at,
      row.status_changed_at,
      row.source_stage,
      row.classification,
      row.amount,
      row.kc_operator_email,
      row.trade_point,
      row.tt_employee,
      row.transferred_at,
      row.cancel_reason_code,
      row.cancel_comment,
      row.client_phone,
      row.client_name,
      row.product_group,
      row.channel,
    ],
  );
  return result.rows[0].is_insert;
}

async function upsertTask(
  client: PoolClient,
  params: {
    dealId: string;
    type: "cancellation" | "warm_lead";
    assignedOperatorEmail: string;
    priorityScore: number;
    nextTouchDate: string | null;
    finalStatuses: string[];
  },
): Promise<void> {
  // Новая задача создаётся со статусом NEW. Если задача уже есть и ещё не закрыта —
  // обновляем только приоритет (он зависит от суммы и давности, которые могли измениться
  // при повторной выгрузке), но не трогаем статус/счётчик касаний/исполнителя — история
  // отработки инструментом не сбрасывается (docs/SPEC.md, раздел 3, правила обработки).
  // Если задача уже закрыта (финальный статус) — не трогаем её вовсе.
  await client.query(
    `INSERT INTO tasks (deal_id, type, status, assigned_operator_email, priority_score, next_touch_date)
     VALUES ($1, $2, 'NEW', $3, $4, $5)
     ON CONFLICT (deal_id, type) DO UPDATE SET
       priority_score = EXCLUDED.priority_score,
       updated_at = now()
     WHERE NOT (tasks.status = ANY($6))`,
    [params.dealId, params.type, params.assignedOperatorEmail, params.priorityScore, params.nextTouchDate, params.finalStatuses],
  );
}

// --- Основная функция импорта ---

export interface ImportSummary {
  batch: ImportBatchRow;
}

export async function processImport(
  buffer: Buffer,
  originalFilename: string,
  uploadedBy: string,
): Promise<ImportSummary> {
  const lowerName = originalFilename.toLowerCase();
  if (!lowerName.endsWith(".csv") && !lowerName.endsWith(".xlsx") && !lowerName.endsWith(".xls")) {
    throw new ValidationError("Поддерживаются только файлы формата XLSX или CSV.");
  }

  let rawRows: Record<string, unknown>[];
  try {
    rawRows = parseRows(buffer, originalFilename);
  } catch (error) {
    throw new ValidationError(`Не удалось прочитать файл: ${(error as Error).message}`);
  }

  if (rawRows.length === 0) {
    throw new ValidationError("Файл не содержит строк с данными.");
  }

  const mapping = await getColumnMapping();
  const errors: ImportRowError[] = [];
  let rowsNew = 0;
  let rowsUpdated = 0;
  const now = new Date();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (let i = 0; i < rawRows.length; i += 1) {
      const rowNumber = i + 2; // +1 за заголовок, +1 за нумерацию с единицы
      const parsed = validateAndNormalizeRow(rawRows[i], mapping);
      if ("error" in parsed) {
        errors.push({ row_number: rowNumber, reason: parsed.error });
        continue;
      }
      const row = parsed.row;

      // Правило: при отсутствии причины отмены у отменённой сделки — код R10 (docs/SPEC.md, раздел 3).
      const cancelled = isCancelledStage(row.source_stage);
      if (cancelled && !row.cancel_reason_code) {
        row.cancel_reason_code = "R10";
      }

      const isInsert = await upsertDeal(client, row);
      if (isInsert) {
        rowsNew += 1;
      } else {
        rowsUpdated += 1;
      }

      const eventDate = new Date(row.status_changed_at);
      const priority = calculatePriority({
        amount: row.amount,
        eventDate,
        cancelReasonCode: row.cancel_reason_code,
        now,
      });

      if (row.classification === "тёплый_лид") {
        // База графика касаний — дата обращения клиента (docs/SPEC.md, раздел 5).
        const contactDate = new Date(row.created_at);
        const nextTouch = computeNextTouchDate(contactDate, 0);
        await upsertTask(client, {
          dealId: row.deal_id,
          type: "warm_lead",
          assignedOperatorEmail: row.kc_operator_email,
          priorityScore: priority.priorityScore,
          nextTouchDate: nextTouch ? nextTouch.toISOString().slice(0, 10) : null,
          finalStatuses: WARM_LEAD_FINAL_STATUSES,
        });
      }

      if (cancelled) {
        // SLA: первый звонок не позднее 24 часов с момента появления в выгрузке (docs/SPEC.md, раздел 5).
        const slaDeadline = new Date(now);
        slaDeadline.setDate(slaDeadline.getDate() + 1);
        await upsertTask(client, {
          dealId: row.deal_id,
          type: "cancellation",
          assignedOperatorEmail: row.kc_operator_email,
          priorityScore: priority.priorityScore,
          nextTouchDate: slaDeadline.toISOString().slice(0, 10),
          finalStatuses: CANCELLATION_FINAL_STATUSES,
        });
      }
    }

    const batchResult = await client.query<ImportBatchRow>(
      `INSERT INTO import_batches (uploaded_by, original_filename, rows_total, rows_new, rows_updated, rows_errors, errors_detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [uploadedBy, originalFilename, rawRows.length, rowsNew, rowsUpdated, errors.length, JSON.stringify(errors)],
    );

    await client.query(
      "INSERT INTO audit_log (user_email, action) VALUES ($1, $2)",
      [
        uploadedBy,
        `Импорт выгрузки «${originalFilename}»: всего строк ${rawRows.length}, новых ${rowsNew}, обновлено ${rowsUpdated}, ошибок ${errors.length}`,
      ],
    );

    await client.query("COMMIT");
    return { batch: batchResult.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listImportBatches(): Promise<ImportBatchRow[]> {
  const result = await pool.query<ImportBatchRow>("SELECT * FROM import_batches ORDER BY uploaded_at DESC");
  return result.rows;
}
