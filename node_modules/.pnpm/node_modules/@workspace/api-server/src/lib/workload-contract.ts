import { createHash, randomUUID } from "node:crypto";
import { WORKLOAD_CATALOG, type WorkloadDescriptor } from "./workload-catalog";

export type WorkloadEvidenceSource =
  | "local-executor"
  | "mining-telemetry"
  | "simulated"
  | "mock"
  | "fixture";

export type WorkloadCompletionState =
  | "waiting"
  | "running"
  | "evidence_pending"
  | "complete"
  | "rejected";

export type WorkloadEvidenceRecord = {
  workloadId: string;
  jobId: string;
  executor: string;
  boundedPartition: string;
  source: WorkloadEvidenceSource;
  realWork: boolean;
  inputDigest: string;
  artifactDigest: string;
  evidenceDigest: string;
  observedAt: string;
  completionState: "complete";
};

export type WorkloadReportDetail = { label: string; value: string };
export type WorkloadEvidenceSummary = {
  completionState: WorkloadCompletionState;
  evidenceSource: WorkloadEvidenceSource | "none";
  lastEvidenceAt: string | null;
  evidenceDigest: string;
  acceptedReport?: AcceptedWorkloadReport;
};

export const WORKLOAD_EVIDENCE_MAX_AGE_MS = 5 * 60_000;

export const PUBLIC_KEY_ARTIFACT_MAX_BYTES = 16_384;
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const HEX_DIGEST = /^[a-f0-9]{64}$/;

/**
 * Keep the three-argument form for legacy workload evidence.  Issued
 * executor jobs use the artifact-bound form so a report for one artifact
 * cannot be replayed for another artifact or job.
 */
export function workloadInputDigest(
  workloadId: string,
  jobId: string,
  executor: string,
  artifactDigest?: string,
  boundedPartition?: string,
  evidencePolicy?: string,
) {
  if (artifactDigest === undefined && boundedPartition === undefined && evidencePolicy === undefined) {
    return digest(`${workloadId}:${jobId}:${executor}`);
  }
  if (boundedPartition === undefined && evidencePolicy === undefined) {
    return digest(`${workloadId}:${jobId}:${executor}:${artifactDigest ?? ""}`);
  }
  return digest([
    workloadId,
    jobId,
    executor,
    artifactDigest ?? "",
    boundedPartition ?? "",
    evidencePolicy ?? "",
  ].join(":"));
}

export type IssuedWorkloadJob = Readonly<{
  jobId: string;
  workloadId: string;
  executor: string;
  boundedPartition: string;
  evidencePolicy: WorkloadDescriptor["evidencePolicy"];
  artifactDigest: string;
  inputDigest: string;
  issuedAt: string;
  expiresAt: string;
}>;
export function createWorkloadEvidence(input: {
  workload: WorkloadDescriptor;
  jobId: string;
  details: Array<{ label: string; value: string }>;
  evidence: string[];
  boundedPartition?: string;
  artifactDigest?: string;
  observedAt?: string;
}): WorkloadEvidenceRecord {
  const isPublicKeyValidator = input.workload.executor === "public-key-validator";
  const evidencePayload = [
    input.workload.id,
    input.workload.executor,
    ...input.details.map((item) => `${item.label}=${item.value}`),
    ...input.evidence,
  ].join("\n");
  return {
    workloadId: input.workload.id,
    jobId: input.jobId,
    executor: input.workload.executor,
    boundedPartition: input.boundedPartition ?? "local-bounded-execution",
    source: isPublicKeyValidator || input.workload.evidencePolicy !== "executor-result-required"
      ? "fixture"
      : "local-executor",
    realWork: !isPublicKeyValidator && input.workload.evidencePolicy === "executor-result-required",
    inputDigest: workloadInputDigest(input.workload.id, input.jobId, input.workload.executor),
    artifactDigest: input.artifactDigest ?? digest(evidencePayload),
    evidenceDigest: digest(evidencePayload),
    observedAt: input.observedAt ?? new Date().toISOString(),
    completionState: "complete",
  };
}

/**
 * Register the result of a server-issued executor invocation.  This is the
 * only path that can create completion evidence for the public-key validator.
 * The job object is intentionally checked by identity as well as UUID: a
 * client cannot manufacture a structurally identical job and register it.
 */
export function registerWorkloadExecution(input: {
  job: IssuedWorkloadJob;
  result: ExecutorResult;
  now?: number;
}): {
  accepted: true;
  record: WorkloadEvidenceRecord;
  report: AcceptedWorkloadReport;
} | {
  accepted: false;
  reason: string;
} {
  const issued = issuedJobs.get(input.job.jobId);
  if (!issued) {
    return { accepted: false, reason: "workload job was not issued by this server" };
  }
  if (issued.job !== input.job) {
    // A structurally cloned job is not trusted; consume the matching
    // server-issued entry so failed attempts cannot pin registry capacity.
    issuedJobs.delete(input.job.jobId);
    return { accepted: false, reason: "workload job was not issued by this server" };
  }
  try {
    if (issued.consumed) {
      return { accepted: false, reason: "workload job has already been consumed" };
    }
    const workload = WORKLOAD_CATALOG.find((item) => item.id === input.job.workloadId);
    if (!workload || workload.evidencePolicy !== "executor-result-required") {
      return { accepted: false, reason: "workload executor evidence is not implemented" };
    }
    if (
      input.job.executor !== workload.executor
      || input.job.evidencePolicy !== workload.evidencePolicy
      || input.job.boundedPartition.length > 128
    ) {
      return { accepted: false, reason: "issued workload job policy does not match the workload" };
    }
    if (input.result.artifactDigest !== input.job.artifactDigest) {
      return { accepted: false, reason: "executor result does not match the issued artifact" };
    }
    if (input.result.boundedPartition !== input.job.boundedPartition) {
      return { accepted: false, reason: "executor result partition does not match the issued job" };
    }
    if (!input.result.answer || !input.result.details.length || !input.result.evidence.length) {
      return { accepted: false, reason: "executor result is incomplete" };
    }

    const now = input.now ?? Date.now();
    const issuedAt = Date.parse(input.job.issuedAt);
    const expiresAt = Date.parse(input.job.expiresAt);
    const observedAt = input.result.observedAt ?? new Date(now).toISOString();
    const observedAtMs = Date.parse(observedAt);
    if (
      !Number.isFinite(issuedAt)
      || !Number.isFinite(expiresAt)
      || !Number.isFinite(observedAtMs)
      || now < issuedAt - 30_000
      || now > expiresAt
      || observedAtMs < issuedAt - 30_000
      || observedAtMs > now + 30_000
      || now - observedAtMs > WORKLOAD_EVIDENCE_MAX_AGE_MS
    ) {
      return { accepted: false, reason: "issued workload job or executor result is stale" };
    }

    const record = buildTrustedEvidence(input.job, input.result, observedAt);
    const report: AcceptedWorkloadReport = {
      answer: input.result.answer,
      details: input.result.details.map((item) => ({ label: item.label, value: item.value })),
      evidence: [...input.result.evidence],
      executionEvidence: record,
    };
    trustedEvidenceRecords.add(record);
    const validation = workloadEvidenceLedger.recordTrusted(record, report, now);
    if (!validation.accepted) {
      return { accepted: false, reason: validation.reason };
    }
    issued.consumed = true;
    return { accepted: true, record, report };
  } catch {
    return { accepted: false, reason: "executor result registration failed" };
  } finally {
    issuedJobs.delete(input.job.jobId);
  }
}
export function validateWorkloadEvidence(
  record: WorkloadEvidenceRecord,
  now = Date.now(),
) {
  const workload = WORKLOAD_CATALOG.find((item) => item.id === record.workloadId);
  if (!workload) return { accepted: false as const, reason: "unknown workload" };
  const issued = issuedJobs.get(record.jobId);
  if (workload.executor === "public-key-validator") {
    if (
      !trustedEvidenceRecords.has(record)
      || !issued
      || record.workloadId !== issued.job.workloadId
      || record.executor !== issued.job.executor
    ) {
      return { accepted: false as const, reason: "public-key evidence was not registered by its issued executor" };
    }
    if (
      record.inputDigest !== issued.job.inputDigest
      || record.artifactDigest !== issued.job.artifactDigest
      || record.boundedPartition !== issued.job.boundedPartition
    ) {
      return { accepted: false as const, reason: "evidence input does not match the issued artifact" };
    }
    if (issued.consumed) {
      return { accepted: false as const, reason: "workload job has already been consumed" };
    }
  }
  if (workload.evidencePolicy !== "executor-result-required") {
    return { accepted: false as const, reason: "workload executor evidence is not implemented" };
  }
  if (record.source !== "local-executor") {
    return { accepted: false as const, reason: "evidence is not from a real local executor" };
  }
  if (!record.realWork) {
    return { accepted: false as const, reason: "simulated or mocked work cannot complete a workload" };
  }
  if (record.executor !== workload.executor) {
    return { accepted: false as const, reason: "evidence executor does not match the workload" };
  }
  if (!record.boundedPartition || record.boundedPartition.length > 128) {
    return { accepted: false as const, reason: "evidence bounded partition is invalid" };
  }
  if (!record.jobId) return { accepted: false as const, reason: "evidence is missing its issued job" };
  if (
    workload.executor !== "public-key-validator"
    && record.inputDigest !== workloadInputDigest(record.workloadId, record.jobId, record.executor)
  ) {
    return { accepted: false as const, reason: "evidence input does not match the issued job" };
  }
  if (!HEX_DIGEST.test(record.evidenceDigest)) {
    return { accepted: false as const, reason: "evidence digest is invalid" };
  }
  if (!HEX_DIGEST.test(record.artifactDigest)) {
    return { accepted: false as const, reason: "artifact digest is invalid" };
  }
  const observedAt = Date.parse(record.observedAt);
  if (!Number.isFinite(observedAt)) {
    return { accepted: false as const, reason: "evidence timestamp is invalid" };
  }
  if (observedAt > now + 30_000 || now - observedAt > WORKLOAD_EVIDENCE_MAX_AGE_MS) {
    return { accepted: false as const, reason: "evidence is stale or from the future" };
  }
  if (record.completionState !== "complete") {
    return { accepted: false as const, reason: "evidence does not prove completion" };
  }
  return { accepted: true as const, workload };
}

export class WorkloadEvidenceLedger {
  private readonly latest = new Map<string, WorkloadEvidenceRecord>();
  private readonly reports = new Map<string, AcceptedWorkloadReport>();

  record(record: WorkloadEvidenceRecord, now = Date.now()) {
    const validation = validateWorkloadEvidence(record, now);
    if (!validation.accepted) return validation;
    this.latest.set(record.workloadId, record);
    return validation;
  }

  summary(workloadId: string): WorkloadEvidenceSummary {
    const record = this.latest.get(workloadId);
    if (!record) {
      return {
        completionState: "waiting",
        evidenceSource: "none",
        lastEvidenceAt: null,
        evidenceDigest: "",
      };
    }
    const summary: WorkloadEvidenceSummary = {
      completionState: record.completionState,
      evidenceSource: record.source,
      lastEvidenceAt: record.observedAt,
      evidenceDigest: record.evidenceDigest,
    };
    const acceptedReport = this.reports.get(workloadId);
    if (acceptedReport) summary.acceptedReport = acceptedReport;
    return summary;
  }

  recordTrusted(
    record: WorkloadEvidenceRecord,
    report: AcceptedWorkloadReport,
    now = Date.now(),
  ) {
    if (!trustedEvidenceRecords.has(record)) {
      return { accepted: false as const, reason: "evidence was not created by a trusted executor" };
    }
    const validation = this.record(record, now);
    if (validation.accepted) this.reports.set(record.workloadId, report);
    return validation;
  }
}

export const workloadEvidenceLedger = new WorkloadEvidenceLedger();

export type AcceptedWorkloadReport = {
  answer: string;
  details: WorkloadReportDetail[];
  evidence: string[];
  executionEvidence: WorkloadEvidenceRecord;
};

function pruneIssuedJobs(now: number) {
  for (const [jobId, issued] of issuedJobs) {
    const expiresAt = Date.parse(issued.job.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) issuedJobs.delete(jobId);
  }
}

type ExecutorResult = {
  answer: string;
  details: WorkloadReportDetail[];
  evidence: string[];
  artifactDigest?: string;
  boundedPartition?: string;
  observedAt?: string;
};

export function issueWorkloadJob(input: {
  workload: WorkloadDescriptor;
  artifactDigest: string;
  boundedPartition: string;
  now?: number;
}): IssuedWorkloadJob {
  if (input.workload.evidencePolicy !== "executor-result-required") {
    throw new Error("workload does not accept executor results");
  }
  if (!HEX_DIGEST.test(input.artifactDigest)) {
    throw new Error("issued workload artifact digest is invalid");
  }
  if (!input.boundedPartition || input.boundedPartition.length > 128) {
    throw new Error("issued workload bounded partition is invalid");
  }

  const issuedAtMs = input.now ?? Date.now();
  if (!Number.isFinite(issuedAtMs)) {
    throw new Error("issued workload timestamp is invalid");
  }
  pruneIssuedJobs(issuedAtMs);
  if (issuedJobs.size >= MAX_ISSUED_WORKLOAD_JOBS) {
    throw new Error("issued workload job capacity reached");
  }
  const jobId = randomUUID();
  const issuedAt = new Date(issuedAtMs).toISOString();
  const expiresAt = new Date(issuedAtMs + WORKLOAD_EVIDENCE_MAX_AGE_MS).toISOString();
  const job: IssuedWorkloadJob = Object.freeze({
    jobId,
    workloadId: input.workload.id,
    executor: input.workload.executor,
    boundedPartition: input.boundedPartition,
    evidencePolicy: input.workload.evidencePolicy,
    artifactDigest: input.artifactDigest,
    inputDigest: workloadInputDigest(
      input.workload.id,
      jobId,
      input.workload.executor,
      input.artifactDigest,
    ),
    issuedAt,
    expiresAt,
  });
  issuedJobs.set(jobId, { job, consumed: false });
  return job;
}

function evidencePayload(
  job: IssuedWorkloadJob,
  details: WorkloadReportDetail[],
  evidence: string[],
) {
  return [
    job.workloadId,
    job.jobId,
    job.executor,
    job.boundedPartition,
    job.evidencePolicy,
    job.artifactDigest,
    job.inputDigest,
    ...details.map((item) => `${item.label}=${item.value}`),
    ...evidence,
  ].join("\n");
}

function buildTrustedEvidence(
  job: IssuedWorkloadJob,
  result: ExecutorResult,
  observedAt: string,
): WorkloadEvidenceRecord {
  return Object.freeze({
    workloadId: job.workloadId,
    jobId: job.jobId,
    executor: job.executor,
    boundedPartition: job.boundedPartition,
    source: "local-executor",
    realWork: true,
    inputDigest: job.inputDigest,
    artifactDigest: job.artifactDigest,
    evidenceDigest: digest(evidencePayload(job, result.details, result.evidence)),
    observedAt,
    completionState: "complete",
  });
}

const trustedEvidenceRecords = new WeakSet<object>();

export function discardIssuedWorkloadJob(job: IssuedWorkloadJob) {
  const issued = issuedJobs.get(job.jobId);
  if (!issued || issued.job !== job) return false;
  issuedJobs.delete(job.jobId);
  return true;
}

export const MAX_ISSUED_WORKLOAD_JOBS = 256;

/**
 * This is deliberately not exported by the parser.  The server issues this
 * partition before invoking the parser and checks that the parser reports the
 * same bounded execution partition when it registers its result.
 */
export const PUBLIC_KEY_BOUNDED_PARTITION = "public-key-parser:16KiB:max-one-key";

const issuedJobs = new Map<string, {
  job: IssuedWorkloadJob;
  consumed: boolean;
}>();

export function issuedWorkloadJobCount() {
  return issuedJobs.size;
}
