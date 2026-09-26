// Импорт выгрузки (функция MVP №1). Права: админ — edit, руководитель КЦ — только просмотр
// истории загрузок (docs/PASSPORT.md, блок 6).
import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../middleware/asyncHandler";
import { getCurrentUser, requireAuth, requireRole } from "../middleware/auth";
import { getColumnMapping, IMPORT_FIELD_KEYS, ImportFieldKey, setColumnMapping } from "../services/columnMapping";
import { listImportBatches, processImport } from "../services/importService";
import { writeAudit } from "../services/auditLog";
import { ValidationError } from "../utils/validation";

export const importRoutes = Router();

// Файл целиком читаем в память — импорт разовый, ручной, объёмы небольшие на MVP (см. RISKS.md, пункт 5).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

importRoutes.use(requireAuth, requireRole("admin", "kc_head"));

importRoutes.get(
  "/batches",
  asyncHandler(async (_req, res) => {
    const batches = await listImportBatches();
    res.json({ batches });
  }),
);

importRoutes.get(
  "/mapping",
  asyncHandler(async (_req, res) => {
    const mapping = await getColumnMapping();
    res.json({ mapping, fields: IMPORT_FIELD_KEYS });
  }),
);

importRoutes.put(
  "/mapping",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const actor = getCurrentUser(req);
    const incoming = req.body?.mapping;
    if (!incoming || typeof incoming !== "object") {
      throw new ValidationError("Не передан маппинг столбцов.");
    }
    const mapping = {} as Record<ImportFieldKey, string>;
    for (const field of IMPORT_FIELD_KEYS) {
      const value = incoming[field];
      if (typeof value !== "string" || !value.trim()) {
        throw new ValidationError(`Не указано название столбца для поля «${field}».`);
      }
      mapping[field] = value.trim();
    }
    await setColumnMapping(mapping);
    await writeAudit(actor.email, "Изменён маппинг столбцов импорта");
    res.json({ mapping });
  }),
);

importRoutes.post(
  "/upload",
  requireRole("admin"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const actor = getCurrentUser(req);
    if (!req.file) {
      throw new ValidationError("Файл не передан. Выберите XLSX или CSV-файл выгрузки.");
    }
    const summary = await processImport(req.file.buffer, req.file.originalname, actor.email);
    res.status(201).json(summary);
  }),
);
