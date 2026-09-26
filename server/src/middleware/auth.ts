// Проверка входа и прав доступа. Всегда на сервере, до выполнения запроса —
// см. docs/PASSPORT.md, блок 6: «ГДЕ ПРОВЕРЯЕТСЯ ДОСТУП: на сервере, до выполнения запроса».
import { NextFunction, Request, Response } from "express";
import { UserRole } from "../domain/statusCodes";

export class AccessDeniedError extends Error {
  constructor(message = "Недостаточно прав для этого действия.") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export interface AuthenticatedUser {
  email: string;
  full_name: string;
  role: UserRole;
  trade_point: string | null;
}

// Достаёт текущего пользователя из сессии — использовать внутри уже защищённых requireAuth маршрутов.
export function getCurrentUser(req: Request): AuthenticatedUser {
  const user = req.session.user;
  if (!user) {
    throw new AccessDeniedError("Требуется вход в систему.");
  }
  return user;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.user) {
    res.status(401).json({ error: "Требуется вход в систему." });
    return;
  }
  next();
}

// Разрешает доступ только перечисленным ролям. Использовать после requireAuth.
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = getCurrentUser(req);
    if (!roles.includes(user.role)) {
      next(new AccessDeniedError("Недостаточно прав для этого действия."));
      return;
    }
    next();
  };
}
