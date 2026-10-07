import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { createCommandCenterRouter } from "./command-center";

export function createRouter(
  commandCenterRouter = createCommandCenterRouter(),
): IRouter {
  const router: IRouter = Router();

  router.use(healthRouter);
  router.use(commandCenterRouter);

  return router;
}

export default createRouter();
