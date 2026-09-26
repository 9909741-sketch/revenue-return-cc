// Централизованная обработка ошибок. Требование репозитория: любая ошибка — понятный
// русский текст без кодов, приложение не падает, ошибка обязательно логируется.
import { ErrorRequestHandler } from "express";
import multer from "multer";
import { NotFoundError, ValidationError } from "../utils/validation";
import { AccessDeniedError } from "./auth";
import { writeAudit } from "../services/auditLog";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof AccessDeniedError) {
    res.status(403).json({ error: err.message });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof multer.MulterError) {
    // Например, файл выгрузки больше лимита 20 МБ (server/src/routes/importRoutes.ts).
    res.status(400).json({ error: `Не удалось загрузить файл: ${err.message}.` });
    return;
  }

  // Ошибка, которую заранее не предвидели, — логируем и в консоль, и в audit_log,
  // пользователю показываем общий понятный текст без технических подробностей.
  // eslint-disable-next-line no-console
  console.error("Необработанная ошибка сервера:", {
    requestId: req.diagnosticId,
    error: err,
  });
  const userEmail = req.session?.user?.email ?? "неизвестный пользователь";
  void writeAudit(
    userEmail,
    `Ошибка сервера [${req.diagnosticId}] на ${req.method} ${req.originalUrl}: ${(err as Error).message}`,
  );

  res.status(500).json({ error: "Внутренняя ошибка сервера. Попробуйте ещё раз или обратитесь к администратору." });
};
