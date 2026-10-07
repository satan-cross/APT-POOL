import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import path from "node:path";
import type { Readable } from "node:stream";
import { logger } from "./logger";

export type RequestedBackend = "auto" | "gpu" | "disabled";
type ActiveBackend = "gpu" | "cpu-fallback" | "disabled";

export type GpuMiningStatus = {
  enabled: boolean;
  requestedBackend: RequestedBackend;
  available: boolean;
  active: boolean;
  backend: ActiveBackend;
  device: string;
  processCount: number;
  stdoutLines: number;
  measuredHashRate: number;
  effectiveHashRateMhs: number;
  noncesChecked: number;
  lastEventAt: string | null;
  lastShareAt: string | null;
  explanation: string;
};

type MinerChild = ChildProcessByStdio<null, Readable, Readable>;

function requestedBackend(): RequestedBackend {
  const value = process.env.MINER_BACKEND?.trim().toLowerCase();
  if (process.env.GPU_MINING_ENABLED?.trim().toLowerCase() === "false") return "disabled";
  if (value === "disabled" || value === "gpu" || value === "auto") return value;
  return "auto";
}

function probeGpu() {
  const probes = [
    {
      command: "nvidia-smi",
      args: ["--query-gpu=name", "--format=csv,noheader"],
    },
    {
      command: "rocminfo",
      args: [],
    },
  ];
  for (const probe of probes) {
    const result = spawnSync(probe.command, probe.args, {
      encoding: "utf8",
      timeout: 1_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status === 0 && result.stdout.trim()) {
      const firstLine = result.stdout.trim().split(/\r?\n/)[0]?.trim();
      return {
        available: true,
        device: firstLine || probe.command,
      };
    }
  }
  return { available: false, device: "" };
}

function initialStatus(): GpuMiningStatus {
  const requested = requestedBackend();
  const probe = probeGpu();
  return {
    enabled: requested !== "disabled",
    requestedBackend: requested,
    available: probe.available,
    active: false,
    backend: "disabled",
    device: probe.device,
    processCount: 0,
    stdoutLines: 0,
    measuredHashRate: 0,
    effectiveHashRateMhs: 0,
    noncesChecked: 0,
    lastEventAt: null,
    lastShareAt: null,
    explanation:
      requested === "disabled"
        ? "GPU process mining is disabled; local worker threads remain active."
        : probe.available
          ? "A local GPU was detected; the GPU process is waiting to start."
          : "No supported local GPU was detected; local worker threads remain active.",
  };
}

export class GpuMinerProcess {
  private child?: MinerChild;
  private status = initialStatus();
  private stdoutBuffer = "";
  private started = false;
  private lastRateSampleAt?: number;

  constructor(private readonly poolPort: number) {}

  start() {
    this.started = true;
    if (this.child || this.status.requestedBackend === "disabled") return;
    if (!this.status.available && this.status.requestedBackend === "gpu") {
      this.status = {
        ...this.status,
        enabled: true,
        active: false,
        backend: "disabled",
        processCount: 0,
        explanation: "GPU mining was requested, but no supported local GPU was detected.",
      };
      return;
    }

    const script = path.resolve(
      process.env.ARGUS_WORKSPACE_ROOT ?? path.resolve(process.cwd(), "../.."),
      "artifacts/security-command-center/miners/gpu_miner.py",
    );
    const python = process.env.PYTHON_EXECUTABLE ?? "python3";
    const child = spawn(
      python,
      [
        script,
        "--host",
        "127.0.0.1",
        "--port",
        String(this.poolPort),
        "--backend",
        this.status.requestedBackend,
      ],
      {
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.child = child;
    this.lastRateSampleAt = undefined;
    this.status = {
      ...this.status,
      active: true,
      backend: this.status.available ? "gpu" : "disabled",
      processCount: 1,
      explanation: this.status.available
        ? "GPU miner process is connecting to the local proof pool."
        : "Automatic mode is starting the bounded CPU fallback.",
    };

    let processError: string | undefined;
    child.stdout.on("data", (chunk: Buffer | string) => {
      this.stdoutBuffer += chunk.toString();
      let newline = this.stdoutBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = this.stdoutBuffer.slice(0, newline).trim();
        this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
        newline = this.stdoutBuffer.indexOf("\n");
        if (!line) continue;
        this.status = {
          ...this.status,
          stdoutLines: this.status.stdoutLines + 1,
          lastEventAt: new Date().toISOString(),
        };
        try {
          const event = JSON.parse(line) as {
            event?: string;
            backend?: string;
            message?: string;
            hashrateHps?: number;
            hashrateMhs?: number;
            noncesChecked?: number;
          };
          if (event.backend === "cpu-fallback") {
            this.status = {
              ...this.status,
              active: true,
              backend: "cpu-fallback",
              processCount: 1,
              explanation: event.message ?? "GPU libraries were unavailable; the process is using CPU fallback.",
            };
          } else if (event.backend === "gpu") {
            this.status = {
              ...this.status,
              active: true,
              backend: "gpu",
              processCount: 1,
              explanation: event.message ?? "GPU miner process is connected to the local proof pool.",
            };
          }
          if (event.event === "miner_error") {
            processError = event.message;
            this.status = {
              ...this.status,
              active: false,
              backend: "disabled",
              processCount: 0,
              explanation: `GPU mining is unavailable: ${event.message ?? "the requested GPU backend could not start."}`,
            };
          } else if (event.event === "pool_connected") {
            this.status = {
              ...this.status,
              active: true,
              processCount: 1,
              explanation: this.status.backend === "cpu-fallback"
                ? this.status.explanation
                : "GPU miner process is connected to the local proof pool.",
            };
          } else if (event.event === "miner_started" && event.backend === "cpu-fallback") {
            this.status = {
              ...this.status,
              backend: "cpu-fallback",
              explanation: event.message ?? "GPU libraries were unavailable; the process is using CPU fallback.",
            };
          }
          if (event.event === "hash_sample" && event.hashrateHps !== undefined) {
            this.lastRateSampleAt = Date.now();
            this.status = {
              ...this.status,
              measuredHashRate: Math.max(0, Math.round(event.hashrateHps)),
              effectiveHashRateMhs: Math.max(0, Number(event.hashrateMhs) || 0),
              noncesChecked: Math.max(0, Math.round(event.noncesChecked ?? 0)),
            };
          } else if (event.event === "share_submitted") {
            this.status = {
              ...this.status,
              lastShareAt: new Date().toISOString(),
            };
          }
        } catch {
          logger.warn({ line }, "GPU miner emitted non-JSON stdout");
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      logger.warn({ message: chunk.toString().trim() }, "GPU miner stderr");
    });
    child.once("error", (error) => {
      this.lastRateSampleAt = undefined;
      this.status = {
        ...this.status,
        active: false,
        processCount: 0,
        measuredHashRate: 0,
        effectiveHashRateMhs: 0,
        explanation: `Unable to start the GPU miner process: ${error.message}`,
      };
      this.child = undefined;
    });
    child.once("exit", (code) => {
      this.lastRateSampleAt = undefined;
      this.status = {
        ...this.status,
        active: false,
        processCount: 0,
        backend: "disabled",
        measuredHashRate: 0,
        effectiveHashRateMhs: 0,
        explanation: processError
          ? `GPU mining is unavailable: ${processError}`
          : code === 0
            ? "GPU miner process stopped."
            : `GPU miner process exited with code ${code ?? "unknown"}.`,
      };
      this.child = undefined;
    });
  }

  async setRequestedBackend(requestedBackend: RequestedBackend) {
    if (this.child) await this.stop();
    this.lastRateSampleAt = undefined;
    const probe = probeGpu();
    this.status = {
      ...this.status,
      enabled: requestedBackend !== "disabled",
      requestedBackend,
      available: probe.available,
      device: probe.device,
      active: false,
      backend: "disabled",
      processCount: 0,
      measuredHashRate: 0,
      effectiveHashRateMhs: 0,
      explanation:
        requestedBackend === "disabled"
          ? "GPU process mining is disabled; local worker threads remain active."
          : requestedBackend === "gpu" && !probe.available
            ? "GPU mining was requested, but no supported local GPU was detected."
            : requestedBackend === "auto" && !probe.available
              ? "No supported local GPU was detected; automatic mode will use bounded CPU fallback."
              : "A local GPU was detected; the GPU process is waiting to start.",
    };
    if (this.started) this.start();
  }

  snapshot(): GpuMiningStatus {
    if (
      this.lastRateSampleAt === undefined
      || Date.now() - this.lastRateSampleAt > 10_000
    ) {
      return {
        ...this.status,
        measuredHashRate: 0,
        effectiveHashRateMhs: 0,
      };
    }
    return { ...this.status };
  }

  async stop() {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.status = {
      ...this.status,
      active: false,
      backend: "disabled",
      processCount: 0,
      measuredHashRate: 0,
      effectiveHashRateMhs: 0,
      explanation: "GPU miner process stopped.",
    };
  }
}

export const gpuMiner = new GpuMinerProcess(Number(process.env.MINER_POOL_PORT ?? 9000));

export function reportedProcessHashRateMhs(): number {
  const reported = gpuMiner.snapshot().effectiveHashRateMhs;
  return Number.isFinite(reported) ? Math.max(0, reported) : 0;
}