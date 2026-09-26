import path from "node:path";
import express, { type RequestHandler, type Router } from "express";
import { apiRouter } from "./routes";
import { diagnosticIdMiddleware } from "./middleware/diagnosticId";
import { errorHandler } from "./middleware/errorHandler";

export function createApp(
  sessionMiddleware: RequestHandler,
  routes: Router = apiRouter,
): express.Express {
  const app = express();

  // За обратным прокси Replit секьюр-куки сессии работают только с доверием к прокси.
  app.set("trust proxy", 1);

  app.use(diagnosticIdMiddleware);
  app.use(express.json({ limit: "5mb" }));
  app.use(sessionMiddleware);
  app.use("/api", routes);

  // Собранный клиент (client/dist) отдаём как статику в продакшене (npm run build кладёт его сюда).
  const clientDist = path.join(__dirname, "..", "..", "client", "dist");
  app.use(express.static(clientDist));

  // SPA-роутинг: любой не-API GET-запрос отдаёт index.html, чтобы работали прямые ссылки
  // вида /cancellations/123 после перезагрузки страницы. В Express 5 маршрут-шаблон '*' для
  // этого больше не используется (path-to-regexp v8) — вместо него middleware без пути.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, "index.html"), (error) => {
      if (error) next();
    });
  });

  app.use(errorHandler);
  return app;
}