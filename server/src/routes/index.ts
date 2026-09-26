import { Router } from "express";
import { authRoutes } from "./authRoutes";
import { userRoutes } from "./userRoutes";
import { importRoutes } from "./importRoutes";
import { taskRoutes } from "./taskRoutes";
import { reportRoutes } from "./reportRoutes";
import { dashboardRoutes } from "./dashboardRoutes";

export const apiRouter = Router();

apiRouter.use("/auth", authRoutes);
apiRouter.use("/users", userRoutes);
apiRouter.use("/import", importRoutes);
apiRouter.use("/tasks", taskRoutes);
apiRouter.use("/reports", reportRoutes);
apiRouter.use("/dashboard", dashboardRoutes);
