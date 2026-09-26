import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export const diagnosticIdMiddleware: RequestHandler = (req, res, next) => {
  const diagnosticId = randomUUID();
  req.diagnosticId = diagnosticId;
  res.setHeader("X-Request-Id", diagnosticId);
  next();
};