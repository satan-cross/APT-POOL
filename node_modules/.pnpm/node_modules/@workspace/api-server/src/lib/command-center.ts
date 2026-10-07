import { createHash } from "node:crypto";
import { dnsPlane } from "./dns-plane";
import {
  gpuMiner,
  reportedProcessHashRateMhs,
  type GpuMiningStatus,
} from "./gpu-miner-process";
import { minerPool, type ThroughputHealth } from "./miner-pool";
import { WORKLOAD_CATALOG } from "./workload-catalog";
import {
  workloadEvidenceLedger,
  type AcceptedWorkloadReport,
} from "./workload-contract";

type Severity = "Critical" | "High" | "Medium" | "Low";

type Workload = {
  id: string;
  name: string;
  purpose: string;
  severity: Severity;
  category: string;
  algorithm: string;
  executionMode: string;
  executor: string;
  authorizationBoundary: string;
  evidencePolicy: string;
  status: string;
  completionState: string;
  progress: number;
  verifiedShares: number;
  lastProof: string;
  rate: string;
  hashes: number;
  hashRate: number;
  note: string;
  evidenceSource: string;
  lastEvidenceAt: string | null;
  evidenceDigest: string;
  acceptedReport?: AcceptedWorkloadReport;
};

type LedgerBlock = {
  height: number;
  task: string;
  severity: Severity;
  hash: string;
  nonce: number;
  miner: string;
  timestamp: string;
};

const proof = (value: string) => createHash("sha256").update(value).digest("hex");

const workloads: Workload[] = WORKLOAD_CATALOG.map((workload) => ({
  id: workload.id,
  name: workload.name,
  purpose: workload.purpose,
  severity: workload.severity,
  category: workload.category,
  algorithm: workload.algorithm,
  executionMode: workload.executionMode,
  executor: workload.executor,
  authorizationBoundary: workload.authorizationBoundary,
  evidencePolicy: workload.evidencePolicy,
  status: "waiting",
  completionState: "waiting",
  progress: 0,
  verifiedShares: 0,
  lastProof: "",
  rate: "0.00 shares/min",
  hashes: 0,
  hashRate: 0,
  note: workload.note,
  evidenceSource: "none",
  lastEvidenceAt: null,
  evidenceDigest: "",
}));

export function getCommandCenterStatus(
  poolInstance = minerPool,
  dnsPlaneInstance = dnsPlane,
) {
  const pool = poolInstance.snapshot();
  for (const workload of workloads) {
    const observed = pool.workloads.find((item) => item.id === workload.id);
    const evidence = workloadEvidenceLedger.summary(workload.id);
    const shares = observed?.shares ?? 0;
    workload.completionState = evidence.completionState === "complete"
      ? "complete"
      : shares
        ? "running"
        : "waiting";
    workload.status = workload.completionState === "complete"
      ? "complete"
      : observed?.status ?? "waiting";
    workload.progress = workload.completionState === "complete"
      ? 100
      : Math.min(95, Math.round((shares / 10) * 100));
    workload.verifiedShares = shares;
    workload.lastProof = observed?.lastProof ?? "";
    workload.rate = observed?.rate ?? "0.00 shares/min";
    workload.hashes = observed?.hashes ?? 0;
    workload.hashRate = observed?.hashRate ?? 0;
    workload.evidenceSource = evidence.evidenceSource;
    workload.lastEvidenceAt = evidence.lastEvidenceAt;
    workload.evidenceDigest = evidence.evidenceDigest;
    workload.acceptedReport = evidence.acceptedReport;
  }
  return {
    generatedAt: new Date().toISOString(),
    coordinator: {
      status: pool.listening ? "operational" : "starting",
      activeMiners: pool.activeMiners,
      configuredMiners: pool.configuredMiners,
      workerHealth: pool.workerHealth,
      throughputHealth: pool.throughputHealth satisfies ThroughputHealth,
       gpuMining: {
         ...gpuMiner.snapshot(),
         effectiveHashRateMhs: reportedProcessHashRateMhs(),
       } satisfies GpuMiningStatus,
      intentionalScaleDowns: pool.intentionalScaleDowns,
      unexpectedRestarts: pool.unexpectedRestarts,
      poolPort: poolInstance.port,
      webPort: 8080,
      policy: "defensive fixtures only",
      acceptedShares: pool.acceptedShares,
      jobsIssued: pool.jobsIssued,
      totalHashes: pool.totalHashes,
      hashRate: pool.hashRate,
      difficulty: pool.difficulty,
      minerSource: pool.activeMiners ? "live TCP connections" : "no live connections",
    },
    dns: dnsPlaneInstance.snapshot(),
    workloads,
    ledger: pool.ledger.map((block) => ({
      height: block.height,
      task: block.workloadName,
      severity: block.severity as Severity,
      hash: block.hash,
      nonce: block.nonce,
      miner: block.miner,
      timestamp: block.timestamp,
    })),
  };
}