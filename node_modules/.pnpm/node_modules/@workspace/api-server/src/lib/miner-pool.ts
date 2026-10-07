import net from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { logger } from "./logger";
import { WORKLOAD_CATALOG } from "./workload-catalog";

export type IssuedJob = {
  jobId: string;
  workloadId: string;
  workloadName: string;
  executor: string;
  evidencePolicy: string;
  inputDigest: string;
  height: number;
  previousHash: string;
  difficulty: string;
  nonceStart: number;
  nonceEnd: number;
};

type Share = {
  jobId: string;
  workloadId: string;
  workloadName: string;
  executor: string;
  evidencePolicy: string;
  inputDigest: string;
  severity: string;
  miner: string;
  hash: string;
  nonce: number;
  timestamp: string;
};

type ConnectionState = {
  minerId: string;
  socket: net.Socket;
  buffer: string;
  currentJob?: IssuedJob;
  currentJobStartedAt?: number;
  localWorkerId?: number;
  acceptedShares: number;
  connectedAt: string;
  lastShare?: string;
};

type ShareListener = (share: Share & { height: number }) => void;
type HashStats = {
  hashes: number;
};

type HashRateSample = {
  workloadId: string;
  hashesPerSecond: number;
  sampledAt: number;
};

type LocalWorkerHealth = {
  enabled: boolean;
  configured: number;
  running: number;
  healthy: boolean;
};

export const RELEASE_THROUGHPUT_FLOOR_HPS = 1_000;
export const RELEASE_EVIDENCE_MAX_AGE_MS = 10_000;

export type ThroughputHealth = {
  status: "healthy" | "warming-up" | "below-floor" | "offline";
  releaseFloorHashRate: number;
  observedHashRate: number;
  acceptedShares: number;
  evidenceAgeMs: number | null;
  evidenceFresh: boolean;
  explanation: string;
};

export function evaluateThroughputHealth(input: {
  listening: boolean;
  activeMiners: number;
  configuredMiners: number;
  workerHealth: LocalWorkerHealth;
  acceptedShares: number;
  totalHashes: number;
  hashRate: number;
  lastAcceptedAt?: string;
  now?: number;
}): ThroughputHealth {
  const evidenceAgeMs = input.lastAcceptedAt
    ? Math.max(0, (input.now ?? Date.now()) - Date.parse(input.lastAcceptedAt))
    : null;
  const evidenceFresh = evidenceAgeMs !== null && evidenceAgeMs <= RELEASE_EVIDENCE_MAX_AGE_MS;
  const base = {
    releaseFloorHashRate: RELEASE_THROUGHPUT_FLOOR_HPS,
    observedHashRate: input.hashRate,
    acceptedShares: input.acceptedShares,
    evidenceAgeMs,
    evidenceFresh,
  };

  if (!input.listening || input.activeMiners === 0) {
    return {
      ...base,
      status: "offline",
      explanation: "No live miner connection is producing release evidence.",
    };
  }
  if (!input.workerHealth.healthy || input.activeMiners < input.configuredMiners) {
    return {
      ...base,
      status: "below-floor",
      explanation: "The connected worker pool is below its configured live capacity.",
    };
  }
  if (!input.totalHashes || !input.acceptedShares || !input.lastAcceptedAt) {
    return {
      ...base,
      status: "warming-up",
      explanation: "Waiting for the first accepted share and measured hash-rate sample.",
    };
  }
  if (input.hashRate < RELEASE_THROUGHPUT_FLOOR_HPS || !evidenceFresh) {
    return {
      ...base,
      status: "below-floor",
      explanation: !evidenceFresh
        ? "The last accepted proof is older than the live evidence window."
        : "Measured hash rate is below the minimum release-health floor.",
    };
  }
  return {
    ...base,
    status: "healthy",
    explanation: "Accepted shares and measured hash rate are above the release-health floor.",
  };
}

type MinerPoolOptions = {
  startLocalWorker?: boolean;
};
const WORKLOADS = WORKLOAD_CATALOG;

const MINING_WORKLOADS = WORKLOAD_CATALOG.filter(
  (workload) => workload.executor !== "public-key-validator",
);
export const ALLOWED_DIFFICULTIES = ["00", "000", "0000"] as const;
export type MinerDifficulty = (typeof ALLOWED_DIFFICULTIES)[number];
const TARGET_SHARES_PER_WORKLOAD = 10;

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function solve(job: IssuedJob) {
  for (let nonce = job.nonceStart; nonce < job.nonceEnd; nonce += 1) {
    const hash = digest(`${job.height}:${job.previousHash}:${job.workloadId}:${nonce}`);
    if (hash.startsWith(job.difficulty)) return { nonce, hash };
  }
  return null;
}

const LOCAL_MINER_WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const net = require("node:net");
const { createHash } = require("node:crypto");
const { performance } = require("node:perf_hooks");

let stopping = false;
let socket;
let buffer = "";

function solve(job) {
  const prefix = job.height + ":" + job.previousHash + ":" + job.workloadId + ":";
  const startedAt = performance.now();
  let hashes = 0;
  const reportProgress = () => {
    parentPort.postMessage({
      type: "hash_progress",
      workloadId: job.workloadId,
      hashes,
      elapsedMs: Math.max(performance.now() - startedAt, 1),
    });
  };
  for (let nonce = job.nonceStart; nonce < job.nonceEnd; nonce += 1) {
    hashes += 1;
    const hash = createHash("sha256").update(prefix + nonce).digest("hex");
    if (hash.startsWith(job.difficulty)) {
      reportProgress();
      return { nonce, hash };
    }
    if (hashes % 10000 === 0) reportProgress();
  }
  reportProgress();
  return null;
}

function connect() {
  if (stopping) return;
  socket = net.createConnection({ port: workerData.port, host: "127.0.0.1" });
  socket.setEncoding("utf8");
  socket.once("connect", () => {
    if (!stopping) {
      socket.write(JSON.stringify({
        type: "worker",
        token: workerData.workerToken,
      }) + "\\n");
    }
  });
  socket.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\\n");
      try {
        const message = JSON.parse(line);
        if (message.type !== "job") continue;
        const result = solve(message);
        if (result) {
          socket.write(JSON.stringify({
            type: "share",
            jobId: message.jobId,
            nonce: result.nonce,
            hash: result.hash,
          }) + "\\n");
        }
      } catch {
        // The pool validates every message; malformed local messages are not retried.
      }
    }
  });
  socket.on("error", () => socket.destroy());
  socket.on("close", () => {
    if (!stopping) setTimeout(connect, 250);
  });
}

parentPort.on("message", (message) => {
  if (message && message.type === "stop") {
    stopping = true;
    if (socket) socket.destroy();
  }
});

connect();
`;

export class MinerPool {
  readonly port: number;

  private readonly server = net.createServer((socket) => this.handleConnection(socket));

  private readonly connections = new Map<net.Socket, ConnectionState>();

  private readonly workloadShares = new Map<string, Share[]>();

  private readonly ledger: Array<Share & { height: number }> = [];

  private readonly shareListeners = new Set<ShareListener>();

  private jobsIssued = 0;

  private totalAcceptedShares = 0;

  private totalHashes = 0;

  private readonly workloadHashes = new Map<string, HashStats>();

  private readonly hashRateSamples = new Map<string, HashRateSample>();

  private readonly localWorkerTokens = new Map<string, number>();

  private difficulty: MinerDifficulty = (process.env.MINER_DIFFICULTY as MinerDifficulty) || "0000";

  private configuredMiners = 1;

  private nextWorkloadIndex = 0;

  private activeWorkloadId?: string;

  private nextHeight = 1;

  private started = false;

  private nextWorkerId = 1;

  private readonly localWorkers = new Map<number, Worker>();

  private readonly retiringWorkers = new Set<Worker>();

  private intentionalScaleDowns = 0;

  private unexpectedRestarts = 0;

  constructor(port = Number(process.env.MINER_POOL_PORT ?? 9000), options: MinerPoolOptions = {}) {
    this.port = port;
    this.startWorkerAutomatically = options.startLocalWorker ?? true;
  }

  start() {
    if (this.started) return;
    this.server.on("error", (error) => logger.error({ err: error, port: this.port }, "Miner pool error"));
    this.server.listen(this.port, "127.0.0.1", () => {
      this.started = true;
      logger.info({ port: this.port, difficulty: this.difficulty }, "TCP miner pool listening");
      if (this.startWorkerAutomatically) this.ensureLocalWorkers();
    });
  }

  private handleConnection(socket: net.Socket) {
    const minerId = `miner-${randomBytes(4).toString("hex")}`;
    const state: ConnectionState = {
      minerId,
      socket,
      buffer: "",
      acceptedShares: 0,
      connectedAt: new Date().toISOString(),
    };
    this.connections.set(socket, state);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      state.buffer += chunk;
      let newline = state.buffer.indexOf("\n");
      while (newline >= 0) {
        const line = state.buffer.slice(0, newline);
        state.buffer = state.buffer.slice(newline + 1);
        newline = state.buffer.indexOf("\n");
        this.handleMessage(state, line);
      }
    });
    const removeConnection = () => {
      this.connections.delete(socket);
      this.hashRateSamples.delete(
        state.localWorkerId === undefined
          ? state.minerId
          : `local-worker-${state.localWorkerId}`,
      );
    };
    socket.on("close", removeConnection);
    socket.on("error", removeConnection);
    this.issueJob(state);
  }

  private issueJob(state: ConnectionState, requestedWorkloadId?: string) {
    if (state.socket.destroyed) return;
    const workload = requestedWorkloadId
      ? MINING_WORKLOADS.find((item) => item.id === requestedWorkloadId)
      : this.activeWorkloadId
        ? MINING_WORKLOADS.find((item) => item.id === this.activeWorkloadId)
        : MINING_WORKLOADS[this.nextWorkloadIndex % MINING_WORKLOADS.length];
    if (!workload) return;
    if (!requestedWorkloadId && !this.activeWorkloadId) this.nextWorkloadIndex += 1;
    const job: IssuedJob = {
      jobId: `job-${this.nextHeight}-${randomBytes(3).toString("hex")}`,
      workloadId: workload.id,
      workloadName: workload.name,
      executor: workload.executor,
      evidencePolicy: workload.evidencePolicy,
      inputDigest: digest(`${workload.id}:${this.nextHeight}:${workload.executor}`),
      height: this.nextHeight,
      previousHash: this.ledger.at(-1)?.hash ?? digest("ARGUS-GENESIS"),
      difficulty: this.difficulty,
      nonceStart: 0,
      nonceEnd: 1_000_000,
    };
    state.currentJob = job;
    state.currentJobStartedAt = performance.now();
    this.jobsIssued += 1;
    state.socket.write(`${JSON.stringify({ type: "job", ...job })}\n`);
  }

  queueLocalJob(workloadId: string) {
    const workload = MINING_WORKLOADS.find((item) => item.id === workloadId);
    if (!workload || workload.evidencePolicy !== "executor-result-required") {
      throw new Error("Only safe local executor workloads can be queued");
    }

    this.activeWorkloadId = workloadId;
    const jobIds: string[] = [];
    for (const state of this.connections.values()) {
      const before = state.currentJob?.jobId;
      this.issueJob(state, workloadId);
      if (state.currentJob?.jobId && state.currentJob.jobId !== before) {
        jobIds.push(state.currentJob.jobId);
      }
    }
    return {
      workloadId,
      workloadName: workload.name,
      activeMiners: this.connections.size,
      jobIds,
      jobsIssued: this.jobsIssued,
    };
  }

  private handleMessage(state: ConnectionState, line: string) {
    try {
      const message = JSON.parse(line) as { type?: string; jobId?: string; nonce?: number; hash?: string };
      if (message.type === "worker") {
        const workerMessage = message as { token?: string };
        const localWorkerId = workerMessage.token
          ? this.localWorkerTokens.get(workerMessage.token)
          : undefined;
        if (localWorkerId !== undefined) state.localWorkerId = localWorkerId;
        return;
      }
      if (message.type !== "share" || !state.currentJob || message.jobId !== state.currentJob.jobId) {
        state.socket.write(`${JSON.stringify({ type: "share_rejected", reason: "unknown job" })}\n`);
        return;
      }
      const nonce = typeof message.nonce === "number" ? message.nonce : NaN;
      if (!Number.isInteger(nonce) || nonce < state.currentJob.nonceStart || nonce >= state.currentJob.nonceEnd) {
        state.socket.write(`${JSON.stringify({ type: "share_rejected", reason: "nonce outside issued range" })}\n`);
        return;
      }
      const expectedHash = digest(`${state.currentJob.height}:${state.currentJob.previousHash}:${state.currentJob.workloadId}:${nonce}`);
      if (message.hash !== expectedHash || !expectedHash.startsWith(state.currentJob.difficulty)) {
        state.socket.write(`${JSON.stringify({ type: "share_rejected", reason: "proof does not meet difficulty" })}\n`);
        return;
      }
      const hashesUsed = nonce - state.currentJob.nonceStart + 1;
      const elapsedMs = Math.max(
        performance.now() - (state.currentJobStartedAt ?? performance.now()),
        1,
      );
      this.recordHashes(
        state.currentJob.workloadId,
        state.localWorkerId === undefined
          ? state.minerId
          : `local-worker-${state.localWorkerId}`,
        hashesUsed,
        elapsedMs,
      );
      const share: Share & { height: number } = {
        jobId: state.currentJob.jobId,
        workloadId: state.currentJob.workloadId,
        workloadName: state.currentJob.workloadName,
        executor: state.currentJob.executor,
        evidencePolicy: state.currentJob.evidencePolicy,
        inputDigest: state.currentJob.inputDigest,
        severity: WORKLOADS.find((item) => item.id === state.currentJob?.workloadId)?.severity ?? "Medium",
        miner: state.minerId,
        hash: expectedHash,
        nonce,
        timestamp: new Date().toISOString(),
        height: this.nextHeight,
      };
      state.acceptedShares += 1;
      this.totalAcceptedShares += 1;
      state.lastShare = share.timestamp;
      this.nextHeight += 1;
      this.ledger.push(share);
      this.ledger.splice(0, Math.max(0, this.ledger.length - 50));
      const shares = this.workloadShares.get(share.workloadId) ?? [];
      shares.push(share);
      shares.splice(0, Math.max(0, shares.length - 50));
      this.workloadShares.set(share.workloadId, shares);
      for (const listener of this.shareListeners) listener(share);
      state.socket.write(`${JSON.stringify({ type: "share_accepted", hash: share.hash, height: share.height })}\n`);
      this.issueJob(state);
    } catch {
      state.socket.write(`${JSON.stringify({ type: "share_rejected", reason: "invalid JSON message" })}\n`);
    }
  }

  async waitForShare(workloadId: string, minimumShares: number, timeoutMs = 30_000) {
    const current = this.workloadShares.get(workloadId)?.length ?? 0;
    if (current > minimumShares) return true;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.shareListeners.delete(listener);
        resolve(false);
      }, timeoutMs);
      const listener: ShareListener = (share) => {
        if (share.workloadId !== workloadId) return;
        clearTimeout(timer);
        this.shareListeners.delete(listener);
        resolve(true);
      };
      this.shareListeners.add(listener);
    });
  }

  setDifficulty(difficulty: string | undefined) {
    if (difficulty === undefined) return this.difficulty;
    if (!ALLOWED_DIFFICULTIES.includes(difficulty as MinerDifficulty)) {
      throw new Error(`difficulty must be one of ${ALLOWED_DIFFICULTIES.join(", ")}`);
    }
    this.difficulty = difficulty as MinerDifficulty;
    return this.difficulty;
  }

  setMinerCount(count: number | undefined) {
    if (count === undefined) return this.configuredMiners;
    if (!Number.isInteger(count) || count < 1 || count > 16) {
      throw new Error("minerCount must be an integer between 1 and 16");
    }
    this.configuredMiners = count;
    this.ensureLocalWorkers();
    return this.configuredMiners;
  }

  private recordHashes(
    workloadId: string,
    sampleId: string,
    hashes: number,
    elapsedMs: number,
  ) {
    this.totalHashes += hashes;
    const existing = this.workloadHashes.get(workloadId);
    this.workloadHashes.set(workloadId, {
      hashes: (existing?.hashes ?? 0) + hashes,
    });
    this.recordHashRateSample(
      sampleId,
      workloadId,
      (hashes * 1000) / elapsedMs,
    );
  }

  private recordHashRateSample(
    sampleId: string,
    workloadId: string,
    hashesPerSecond: number,
  ) {
    if (!Number.isFinite(hashesPerSecond) || hashesPerSecond <= 0) return;
    this.hashRateSamples.set(sampleId, {
      workloadId,
      hashesPerSecond,
      sampledAt: Date.now(),
    });
  }

  private hashRate(workloadId: string | undefined, now: number) {
    const activeMinerSamples = new Set(
      [...this.connections.values()].map((connection) =>
        connection.localWorkerId === undefined
          ? connection.minerId
          : `local-worker-${connection.localWorkerId}`,
      ),
    );
    let rate = 0;
    for (const [sampleId, sample] of this.hashRateSamples) {
      if (
        activeMinerSamples.has(sampleId)
        && (!workloadId || sample.workloadId === workloadId)
        && now - sample.sampledAt <= RELEASE_EVIDENCE_MAX_AGE_MS
      ) {
        rate += sample.hashesPerSecond;
      }
    }
    return Math.round(rate);
  }

  private ensureLocalWorkers() {
    if (!this.started || !this.startWorkerAutomatically) return;
    let runningWorkers = [...this.localWorkers.values()].filter(
      (worker) => !this.retiringWorkers.has(worker),
    ).length;
    while (runningWorkers < this.configuredMiners) {
      this.startLocalWorker(this.nextWorkerId++);
      runningWorkers += 1;
    }
    let excess = runningWorkers - this.configuredMiners;
    for (const [, worker] of this.localWorkers) {
      if (excess <= 0) break;
      if (this.retiringWorkers.has(worker)) continue;
      this.retiringWorkers.add(worker);
      this.intentionalScaleDowns += 1;
      worker.postMessage({ type: "stop" });
      void worker.terminate();
      excess -= 1;
    }
  }

  private startLocalWorker(workerId: number) {
    const workerToken = randomBytes(16).toString("hex");
    const worker = new Worker(LOCAL_MINER_WORKER_SOURCE, {
      eval: true,
      name: `local-miner-${workerId}`,
      workerData: { port: this.port, workerId, workerToken },
    });
    this.localWorkers.set(workerId, worker);
    this.localWorkerTokens.set(workerToken, workerId);
    worker.on(
      "message",
      (message: {
        type?: string;
        workloadId?: string;
        hashes?: number;
        elapsedMs?: number;
      }) => {
        if (
          message.type !== "hash_progress"
          || typeof message.workloadId !== "string"
          || !Number.isSafeInteger(message.hashes)
          || !Number.isFinite(message.elapsedMs)
          || message.hashes! <= 0
          || message.elapsedMs! <= 0
        ) {
          return;
        }
        this.recordHashRateSample(
          `local-worker-${workerId}`,
          message.workloadId,
          (message.hashes! * 1000) / message.elapsedMs!,
        );
      },
    );
    worker.on("error", (error) =>
      logger.warn({ err: error, workerId }, "Local miner worker failed"),
    );
    worker.on("exit", (code) => {
      const intentionalExit = this.retiringWorkers.delete(worker);
      if (this.localWorkers.get(workerId) === worker) {
        this.localWorkers.delete(workerId);
      }
      this.hashRateSamples.delete(`local-worker-${workerId}`);
      this.localWorkerTokens.delete(workerToken);
      if (this.started && !intentionalExit) {
        this.unexpectedRestarts += 1;
      }
      if (this.started && this.localWorkers.size < this.configuredMiners) {
        setTimeout(() => this.ensureLocalWorkers(), 250);
      }
      if (code !== 0 && !intentionalExit) {
        logger.warn({ code, workerId }, "Local miner worker exited");
      }
    });
  }

  snapshot() {
    const now = Date.now();
    const runningLocalWorkers = [...this.localWorkers.values()].filter(
      (worker) => !this.retiringWorkers.has(worker),
    ).length;
    const workerHealth: LocalWorkerHealth = {
      enabled: this.startWorkerAutomatically,
      configured: this.configuredMiners,
      running: runningLocalWorkers,
      healthy: !this.startWorkerAutomatically || runningLocalWorkers === this.configuredMiners,
    };
    const totalHashRate = this.hashRate(undefined, now);
    const throughputHealth = evaluateThroughputHealth({
      listening: this.started,
      activeMiners: this.connections.size,
      configuredMiners: this.configuredMiners,
      workerHealth,
      acceptedShares: this.totalAcceptedShares,
      totalHashes: this.totalHashes,
      hashRate: totalHashRate,
      lastAcceptedAt: this.ledger.at(-1)?.timestamp,
      now,
    });
    return {
      listening: this.started,
      activeMiners: this.connections.size,
      configuredMiners: this.configuredMiners,
      workerHealth,
      intentionalScaleDowns: this.intentionalScaleDowns,
      unexpectedRestarts: this.unexpectedRestarts,
      acceptedShares: this.totalAcceptedShares,
      jobsIssued: this.jobsIssued,
      difficulty: this.difficulty,
      totalHashes: this.totalHashes,
      hashRate: totalHashRate,
      throughputHealth,
      workloads: WORKLOADS.map((workload) => {
        const shares = this.workloadShares.get(workload.id) ?? [];
        const hashStats = this.workloadHashes.get(workload.id);
        const firstShare = shares[0]?.timestamp;
        const minutes = firstShare ? Math.max((now - Date.parse(firstShare)) / 60_000, 1 / 60) : 0;
        return {
          id: workload.id,
          shares: shares.length,
          lastProof: shares.at(-1)?.hash ?? "",
          lastJobId: shares.at(-1)?.jobId ?? "",
          lastInputDigest: shares.at(-1)?.inputDigest ?? "",
          rate: shares.length ? `${(shares.length / minutes).toFixed(2)} shares/min` : "0.00 shares/min",
          hashes: hashStats?.hashes ?? 0,
          hashRate: this.hashRate(workload.id, now),
          status: shares.length >= TARGET_SHARES_PER_WORKLOAD ? "verified" : shares.length ? "running" : "waiting",
          lastMiner: shares.at(-1)?.miner ?? "",
        };
      }),
      ledger: [...this.ledger].reverse(),
    };
  }

  liveTelemetry(workloadId?: string) {
    const snapshot = this.snapshot();
    const workload = snapshot.workloads.find((item) => item.id === workloadId);
    const last = workload;
    const isNonMiningWorkload = Boolean(
      workloadId
      && !MINING_WORKLOADS.some((item) => item.id === workloadId),
    );
    if (isNonMiningWorkload) {
      const descriptor = WORKLOADS.find((item) => item.id === workloadId);
      return {
        status: "not applicable",
        workloadId: workloadId ?? "",
        jobId: "",
        executor: descriptor?.executor ?? "",
        evidenceRole: "mining-telemetry-only" as const,
        inputDigest: "",
        activeMiners: 0,
        acceptedShares: 0,
        difficulty: this.difficulty,
        jobsIssued: 0,
        hashes: 0,
        hashRate: 0,
        workloadShares: 0,
        lastHash: "",
        lastMiner: "",
      };
    }
    return {
      status: last ? "share accepted" : "awaiting miner share",
      workloadId: last?.id ?? "",
      jobId: last?.lastJobId ?? "",
      executor: last ? WORKLOADS.find((item) => item.id === last.id)?.executor ?? "" : "",
      evidenceRole: "mining-telemetry-only",
      inputDigest: last?.lastInputDigest ?? "",
      activeMiners: snapshot.activeMiners,
      acceptedShares: snapshot.acceptedShares,
      difficulty: this.difficulty,
      jobsIssued: snapshot.jobsIssued,
      hashes: workload ? workload.hashes : snapshot.totalHashes,
      hashRate: workload ? workload.hashRate : snapshot.hashRate,
      workloadShares: workload?.shares ?? 0,
      lastHash: last?.lastProof ?? "",
      lastMiner: last?.lastMiner ?? "",
    };
  }

  onShare(listener: ShareListener) {
    this.shareListeners.add(listener);
    return () => this.shareListeners.delete(listener);
  }

  private readonly startWorkerAutomatically: boolean;

  async stop() {
    this.started = false;
    await Promise.all(
      [...this.localWorkers.values()].map(async (worker) => {
        this.retiringWorkers.add(worker);
        worker.postMessage({ type: "stop" });
        await worker.terminate();
      }),
    );
    this.localWorkers.clear();
    for (const socket of this.connections.keys()) socket.destroy();
    this.connections.clear();
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

export const minerPool = new MinerPool();
