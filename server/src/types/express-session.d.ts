// Расширение типов express-session: что именно храним в сессии пользователя.
import "express-session";
import { UserRole } from "../domain/statusCodes";

declare module "express-session" {
  interface SessionData {
    user?: {
      email: string;
      full_name: string;
      role: UserRole;
      trade_point: string | null;
    };
  }
}
