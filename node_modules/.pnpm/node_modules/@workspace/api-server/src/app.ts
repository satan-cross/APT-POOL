import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { createRouter } from "./routes";
import { createCommandCenterRouter } from "./routes/command-center";
import { logger } from "./lib/logger";

export function createApp(commandCenterRouter = createCommandCenterRouter()): Express {
  const app: Express = express();

  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get("/", (_req, res) => {
    res.json({ status: "ok", service: "argus-api" });
  });

  app.use("/api", createRouter(commandCenterRouter));

  return app;
}

const app = createApp();

export default app;
