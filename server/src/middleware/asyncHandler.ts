// Обёртка для асинхронных обработчиков маршрутов Express: перехватывает отклонённые
// промисы и передаёт ошибку в централизованный обработчик вместо падения процесса.
import { NextFunction, Request, RequestHandler, Response } from "express";

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
