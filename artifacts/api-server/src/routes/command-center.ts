import { Router, type IRouter, type Request } from "express";
import { GetCommandCenterStatusResponse } from "@workspace/api-zod";
import {
  GetCommandCenterSettingsResponse,
  MigrateCommandCenterDnsBody,
  MigrateCommandCenterDnsResponse,
  SaveCommandCenterSettingsBody,
  SaveCommandCenterSettingsResponse,
  RunCommandCenterDemoBody,
  RunCommandCenterDemoResponse,
  RunCommandCenterExploitDetectionBody,
  RunCommandCenterExploitDetectionResponse,
  QuoteTaskOrderBody,
  QueueTaskOrderBody,
  QueueTaskOrderResponse,
} from "@workspace/api-zod";
import { getCommandCenterStatus } from "../lib/command-center";
import { loadCommandCenterSettings, saveCommandCenterSettings } from "../lib/command-center-settings";
import { migrateDns, runCommandCenterDemo } from "../lib/demo-runner";
import { runExploitDetection } from "../lib/exploit-detector";
import {
  defaultTaskOrderHashRate,
  getTaskOrderCatalog,
  queueTaskOrder,
  quoteTaskOrder,
} from "../lib/task-orders";

type CommandCenterHandlers = {
  getStatus: typeof getCommandCenterStatus;
  runDemo: typeof runCommandCenterDemo;
  migrateDns: typeof migrateDns;
  runExploitDetection?: typeof runExploitDetection;
  getTaskOrderCatalog?: typeof getTaskOrderCatalog;
  quoteTaskOrder?: typeof quoteTaskOrder;
  queueTaskOrder?: typeof queueTaskOrder;
};

function requestError(error: unknown, fallback: string) {
  // Zod issue messages describe the rejected shape without exposing the
  // submitted artifact.  Keep request validation errors deliberately generic
  // so a malformed public-key artifact (or any other payload) is never
  // reflected by this API.
  if (
    error
    && typeof error === "object"
    && "issues" in error
    && Array.isArray((error as { issues?: unknown }).issues)
  ) {
    return fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function isSameOriginRequest(req: Request) {
  const requestHost = req.get("host");
  if (!requestHost) return false;
  const matchesRequestHost = (value: string) => {
    try {
      return new URL(value).host === requestHost;
    } catch {
      return false;
    }
  };
  const origin = req.get("origin");
  if (origin) return matchesRequestHost(origin);

  const referer = req.get("referer");
  if (!referer) return true;
  return matchesRequestHost(referer);
}

const defaultHandlers: CommandCenterHandlers = {
  getStatus: getCommandCenterStatus,
  runDemo: runCommandCenterDemo,
  migrateDns,
  runExploitDetection,
  getTaskOrderCatalog,
  quoteTaskOrder,
  queueTaskOrder,
};

export function createCommandCenterRouter(
  handlers: CommandCenterHandlers = defaultHandlers,
): IRouter {
  const router: IRouter = Router();

  router.get("/command-center/status", (_req, res) => {
    res.json(GetCommandCenterStatusResponse.parse(handlers.getStatus()));
  });

  router.get("/command-center/settings", async (_req, res) => {
    try {
      res.json(GetCommandCenterSettingsResponse.parse(await loadCommandCenterSettings()));
    } catch (error) {
      res.status(500).json({ error: requestError(error, "Unable to load settings") });
    }
  });

  router.get("/command-center/task-orders", (_req, res) => {
    const catalog = handlers.getTaskOrderCatalog ?? getTaskOrderCatalog;
    res.json({
      ...catalog(),
      defaultHashRate: defaultTaskOrderHashRate(),
    });
  });

  router.post("/command-center/task-orders/quote", (req, res) => {
    try {
      const { taskId, hashRate, solvedPercent, totalItems } = QuoteTaskOrderBody.parse(req.body);
      const quote = handlers.quoteTaskOrder ?? quoteTaskOrder;
      res.json(quote({ taskId, hashRate, solvedPercent, totalItems }));
    } catch (error) {
      res.status(400).json({ error: requestError(error, "Invalid task order quote") });
    }
  });

  router.post("/command-center/task-orders/queue", (req, res) => {
    try {
      const { taskId } = QueueTaskOrderBody.parse(req.body);
      const queue = handlers.queueTaskOrder ?? queueTaskOrder;
      res.json(QueueTaskOrderResponse.parse(queue(taskId)));
    } catch (error) {
      res.status(400).json({ error: requestError(error, "Unable to queue local task") });
    }
  });

  router.put("/command-center/settings", async (req, res) => {
    try {
      const input = SaveCommandCenterSettingsBody.parse(req.body);
      res.json(SaveCommandCenterSettingsResponse.parse(await saveCommandCenterSettings(input)));
    } catch (error) {
      res.status(400).json({ error: requestError(error, "Invalid settings") });
    }
  });

  router.post("/command-center/demo", async (req, res) => {
    try {
      const { workloadId, difficulty, publicKeyArtifact, mnemonicWords } = RunCommandCenterDemoBody.parse(req.body);
      if (publicKeyArtifact !== undefined && !isSameOriginRequest(req)) {
        res.status(403).json({ error: "Cross-origin public-key workload requests are not permitted" });
        return;
      }
      res.json(RunCommandCenterDemoResponse.parse(
         await handlers.runDemo(workloadId, difficulty, undefined, undefined, publicKeyArtifact, mnemonicWords),
      ));
    } catch (error) {
      res.status(400).json({ error: requestError(error, "Invalid workload demo") });
    }
  });

  router.post("/command-center/dns/migrate", async (req, res) => {
    try {
      const { targetIp, difficulty } = MigrateCommandCenterDnsBody.parse(req.body);
      res.json(MigrateCommandCenterDnsResponse.parse(await handlers.migrateDns(targetIp, difficulty)));
    } catch (error) {
      res.status(400).json({ error: requestError(error, "Invalid DNS migration") });
    }
  });

  router.post("/command-center/exploit-detection", (req, res) => {
    try {
      const input = RunCommandCenterExploitDetectionBody.parse(req.body);
      const detect = handlers.runExploitDetection ?? runExploitDetection;
      res.json(RunCommandCenterExploitDetectionResponse.parse(detect(input)));
    } catch (error) {
      res.status(400).json({ error: requestError(error, "Invalid exploit detection request") });
    }
  });

  return router;
}

const router = createCommandCenterRouter();

export default router;