import app from "./app";
import { logger } from "./lib/logger";
import { dnsPlane } from "./lib/dns-plane";
import { gpuMiner } from "./lib/gpu-miner-process";
import { minerPool } from "./lib/miner-pool";
import { loadCommandCenterSettings } from "./lib/command-center-settings";
import { localSecurityLab } from "./lib/local-security-lab";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  await loadCommandCenterSettings();
  dnsPlane.start();
  minerPool.start();
  gpuMiner.start();
  await localSecurityLab.start();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

start().catch((err) => {
  logger.error({ err }, "Unable to load command center settings");
  process.exit(1);
});
