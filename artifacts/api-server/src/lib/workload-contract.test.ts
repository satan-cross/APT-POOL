import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getWorkload } from "./workload-catalog";
import {
  discardIssuedWorkloadJob,
  issuedWorkloadJobCount,
  MAX_ISSUED_WORKLOAD_JOBS,
  PUBLIC_KEY_BOUNDED_PARTITION,
  WORKLOAD_EVIDENCE_MAX_AGE_MS,
  WorkloadEvidenceLedger,
  createWorkloadEvidence,
  issueWorkloadJob,
  registerWorkloadExecution,
  validateWorkloadEvidence,
  workloadInputDigest,
} from "./workload-contract";

const workload = getWorkload("w-19");
if (!workload) throw new Error("Test workload is missing");
const publicKeyWorkload = getWorkload("w-69");
if (!publicKeyWorkload) throw new Error("Public-key workload is missing");

const validEvidence = (observedAt = new Date().toISOString()) =>
  createWorkloadEvidence({
    workload,
    jobId: "job-contract-test",
    details: [{ label: "Digest count", value: "64" }],
    evidence: ["batch_sha256=4f".padEnd(77, "0")],
    observedAt,
  });

describe("workload evidence contract", () => {
  it("accepts fresh matching evidence from the named local executor", () => {
    const ledger = new WorkloadEvidenceLedger();
    assert.equal(ledger.record(validEvidence()).accepted, true);
    assert.deepEqual(ledger.summary(workload.id), {
      completionState: "complete",
      evidenceSource: "local-executor",
      lastEvidenceAt: ledger.summary(workload.id).lastEvidenceAt,
      evidenceDigest: validEvidence().evidenceDigest,
    });
  });

  it("rejects unknown and cross-workload evidence", () => {
    const ledger = new WorkloadEvidenceLedger();
    assert.equal(ledger.record({ ...validEvidence(), workloadId: "w-unknown" }).accepted, false);
    assert.equal(
      ledger.record({
        ...validEvidence(),
        workloadId: "w-20",
        inputDigest: workloadInputDigest("w-20", "job-contract-test", workload.executor),
      }).accepted,
      false,
    );
    assert.equal(ledger.summary(workload.id).completionState, "waiting");
  });

  it("rejects stale evidence", () => {
    const ledger = new WorkloadEvidenceLedger();
    const now = Date.now();
    const stale = validEvidence(new Date(now - WORKLOAD_EVIDENCE_MAX_AGE_MS - 1).toISOString());
    assert.deepEqual(ledger.record(stale, now), {
      accepted: false,
      reason: "evidence is stale or from the future",
    });
  });

  it("rejects mining, simulated, mocked, timer-only, and fixture-only results", () => {
    const ledger = new WorkloadEvidenceLedger();
    for (const source of ["mining-telemetry", "simulated", "mock", "fixture"] as const) {
      assert.equal(ledger.record({ ...validEvidence(), source }).accepted, false);
    }
    assert.equal(ledger.record({ ...validEvidence(), realWork: false }).accepted, false);
    assert.equal(ledger.summary(workload.id).completionState, "waiting");
  });

  it("keeps legacy fixture demos pending until a real executor is implemented", () => {
    const legacyWorkload = getWorkload("w-04");
    assert.ok(legacyWorkload);
    const evidence = createWorkloadEvidence({
      workload: legacyWorkload,
      jobId: "job-mining-only",
      details: [{ label: "Accepted share", value: "0000abc" }],
      evidence: ["miner_hash=0000abc"],
    });
    const ledger = new WorkloadEvidenceLedger();
    assert.deepEqual(ledger.record(evidence), {
      accepted: false,
      reason: "workload executor evidence is not implemented",
    });
    assert.equal(ledger.summary(legacyWorkload.id).completionState, "waiting");
  });

  it("rejects malformed evidence digests", () => {
    const ledger = new WorkloadEvidenceLedger();
    assert.deepEqual(ledger.record({ ...validEvidence(), evidenceDigest: "timer-finished" }), {
      accepted: false,
      reason: "evidence digest is invalid",
    });
  });

  it("does not let the generic evidence factory complete the public-key validator", () => {
    const generic = createWorkloadEvidence({
      workload: publicKeyWorkload,
      jobId: "not-issued",
      details: [{ label: "Answer", value: "fabricated" }],
      evidence: ["fixture=true"],
    });
    assert.equal(generic.source, "fixture");
    assert.equal(generic.realWork, false);
    assert.equal(new WorkloadEvidenceLedger().record(generic).accepted, false);

    assert.equal(
      new WorkloadEvidenceLedger().record({
        ...generic,
        source: "local-executor",
        realWork: true,
      }).accepted,
      false,
    );

    const fabricated = {
      workloadId: publicKeyWorkload.id,
      jobId: "not-issued",
      executor: publicKeyWorkload.executor,
      boundedPartition: PUBLIC_KEY_BOUNDED_PARTITION,
      source: "local-executor" as const,
      realWork: true,
      inputDigest: workloadInputDigest(publicKeyWorkload.id, "not-issued", publicKeyWorkload.executor),
      artifactDigest: "a".repeat(64),
      evidenceDigest: "b".repeat(64),
      observedAt: new Date().toISOString(),
      completionState: "complete" as const,
    };
    assert.equal(validateWorkloadEvidence(fabricated).accepted, false);
  });

  it("accepts exactly one fresh parser result for the issued artifact and exposes no raw artifact", () => {
    const now = Date.now();
    const artifactDigest = "1".repeat(64);
    const job = issueWorkloadJob({
      workload: publicKeyWorkload,
      artifactDigest,
      boundedPartition: PUBLIC_KEY_BOUNDED_PARTITION,
      now,
    });
    assert.match(job.jobId, /^[0-9a-f-]{36}$/);
    assert.equal(job.workloadId, publicKeyWorkload.id);
    assert.equal(job.executor, publicKeyWorkload.executor);
    assert.equal(job.evidencePolicy, "executor-result-required");
    assert.equal(job.artifactDigest, artifactDigest);
    assert.equal(
      job.inputDigest,
      workloadInputDigest(
        job.workloadId,
        job.jobId,
        job.executor,
        artifactDigest,
      ),
    );

    const result = {
      answer: "Assessment complete; private-key recovery was not attempted",
      details: [{ label: "Artifact SHA-256", value: artifactDigest }],
      evidence: [`artifact_sha256=${artifactDigest}`, "private_key_recovery=not_performed"],
      artifactDigest,
      boundedPartition: PUBLIC_KEY_BOUNDED_PARTITION,
      observedAt: new Date(now).toISOString(),
    };
    const accepted = registerWorkloadExecution({ job, result, now });
    assert.equal(accepted.accepted, true);
    if (!accepted.accepted) return;
    assert.equal(accepted.record.source, "local-executor");
    assert.equal(accepted.record.realWork, true);
    assert.equal(accepted.record.inputDigest, job.inputDigest);
    assert.equal(accepted.report.executionEvidence, accepted.record);
    assert.equal(accepted.report.details.some((item) => item.value === artifactDigest), true);
    assert.deepEqual(registerWorkloadExecution({ job, result, now }), {
      accepted: false,
      reason: "workload job was not issued by this server",
    });
    assert.equal(validateWorkloadEvidence(accepted.record, now).accepted, false);
    const tamperedLedger = new WorkloadEvidenceLedger();
    assert.equal(
      tamperedLedger.record({ ...accepted.record, source: "fixture" }).accepted,
      false,
    );

    const summary = new WorkloadEvidenceLedger().summary(publicKeyWorkload.id);
    // The per-test ledger is intentionally empty; the trusted server ledger
    // is checked through the returned report and command-center integration.
    assert.equal(summary.completionState, "waiting");
  });

  it("rejects cross-artifact, cross-workload, fabricated, and stale executor results", () => {
    const now = Date.now();
    const base = {
      answer: "assessment complete",
      details: [{ label: "status", value: "complete" }],
      evidence: ["parser=validated"],
      artifactDigest: "2".repeat(64),
      boundedPartition: PUBLIC_KEY_BOUNDED_PARTITION,
    };
    const issue = () => issueWorkloadJob({
      workload: publicKeyWorkload,
      artifactDigest: "2".repeat(64),
      boundedPartition: PUBLIC_KEY_BOUNDED_PARTITION,
      now,
    });
    const crossArtifactJob = issue();
    assert.equal(
      registerWorkloadExecution({
        job: crossArtifactJob,
        result: { ...base, artifactDigest: "3".repeat(64) },
        now,
      }).accepted,
      false,
    );
    const crossWorkloadJob = issue();
    assert.equal(
      registerWorkloadExecution({
        job: { ...crossWorkloadJob, workloadId: "w-19" },
        result: base,
        now,
      }).accepted,
      false,
    );
    const staleJob = issue();
    assert.equal(
      registerWorkloadExecution({
        job: staleJob,
        result: { ...base, observedAt: new Date(now - WORKLOAD_EVIDENCE_MAX_AGE_MS - 1).toISOString() },
        now,
      }).accepted,
      false,
    );
    const acceptedJob = issue();
    const accepted = registerWorkloadExecution({ job: acceptedJob, result: base, now });
    assert.equal(accepted.accepted, true);
    assert.equal(issuedWorkloadJobCount(), 0);
  });

  it("bounds outstanding jobs, prunes expired jobs at issuance, and cleans up exceptions", () => {
    const now = Date.now();
    for (let index = 0; index < MAX_ISSUED_WORKLOAD_JOBS; index += 1) {
      issueWorkloadJob({
        workload: publicKeyWorkload,
        artifactDigest: `${index.toString(16).padStart(2, "0")}${"a".repeat(62)}`,
        boundedPartition: PUBLIC_KEY_BOUNDED_PARTITION,
        now,
      });
    }
    assert.equal(issuedWorkloadJobCount(), MAX_ISSUED_WORKLOAD_JOBS);
    assert.throws(
      () => issueWorkloadJob({
        workload: publicKeyWorkload,
        artifactDigest: "b".repeat(64),
        boundedPartition: PUBLIC_KEY_BOUNDED_PARTITION,
        now,
      }),
      /capacity reached/,
    );

    const afterExpiry = now + WORKLOAD_EVIDENCE_MAX_AGE_MS + 1;
    const fresh = issueWorkloadJob({
      workload: publicKeyWorkload,
      artifactDigest: "c".repeat(64),
      boundedPartition: PUBLIC_KEY_BOUNDED_PARTITION,
      now: afterExpiry,
    });
    assert.equal(issuedWorkloadJobCount(), 1);
    assert.equal(discardIssuedWorkloadJob(fresh), true);
    assert.equal(issuedWorkloadJobCount(), 0);

    const failing = issueWorkloadJob({
      workload: publicKeyWorkload,
      artifactDigest: "d".repeat(64),
      boundedPartition: PUBLIC_KEY_BOUNDED_PARTITION,
      now,
    });
    const throwingResult = {
      answer: "assessment complete",
      get details(): never {
        throw new Error("deliberate executor failure");
      },
      evidence: ["parser=validated"],
      artifactDigest: failing.artifactDigest,
      boundedPartition: PUBLIC_KEY_BOUNDED_PARTITION,
    };
    assert.equal(
      registerWorkloadExecution({
        job: failing,
        result: throwingResult,
        now,
      }).accepted,
      false,
    );
    assert.equal(issuedWorkloadJobCount(), 0);
  });
});