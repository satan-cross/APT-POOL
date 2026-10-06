import {
  createHash,
  generateKeyPairSync,
  pbkdf2Sync,
  randomBytes,
  sign,
  verify,
} from "node:crypto";
import { dnsPlane } from "./dns-plane";
import { effectiveRelayHashRateMhs } from "./gpu-miner-process";
import { MinerPool, minerPool, type MinerDifficulty } from "./miner-pool";
import { runMnemonicFixture, type MnemonicWordCount } from "./mnemonic-fixture";
import { runSafeWorkload } from "./safe-workload-runner";
import { getWorkload } from "./workload-catalog";
import {
  createWorkloadEvidence,
  discardIssuedWorkloadJob,
  issueWorkloadJob,
  PUBLIC_KEY_ARTIFACT_MAX_BYTES,
  PUBLIC_KEY_BOUNDED_PARTITION,
  registerWorkloadExecution,
  workloadEvidenceLedger,
  type WorkloadEvidenceRecord,
} from "./workload-contract";

type Detail = { label: string; value: string };
type DnsRedirectResult = {
  statusCode: number;
  url: string;
  body: string;
};
type DnsRecordProof = {
  canonical: string;
  recordHash: string;
  keyFingerprint: string;
  signature: string;
};
type DemoResult = {
  runId: string;
  status: string;
  workloadId: string;
  workloadName: string;
  severity: string;
  startedAt: string;
  finishedAt: string;
  answer: string;
  details: Detail[];
  evidence: string[];
  executionEvidence: WorkloadEvidenceRecord;
  evidenceAccepted: boolean;
  evidenceRejectionReason: string;
  safety: string;
  mining: ReturnType<typeof minerPool.liveTelemetry> & {
    effectiveHashRateMhs: number;
  };
  dnsSerial?: number;
  dnsTarget?: string;
  dnsRedirect?: DnsRedirectResult;
  dnsRecordProof?: DnsRecordProof;
};

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const detail = (label: string, value: string): Detail => ({ label, value });

function demoMiningTelemetry(pool: MinerPool, workloadId: string) {
  return {
    ...pool.liveTelemetry(workloadId),
    effectiveHashRateMhs: effectiveRelayHashRateMhs(),
  };
}

async function runDnsDemo(dnsPlaneInstance = dnsPlane) {
  const response = await dnsPlaneInstance.queryCurrent();
  const redirect = await dnsPlaneInstance.probeResolvedTarget(response.answer);
  const proof = dnsPlaneInstance.recordProof();
  return {
    answer: `Authoritative DNS response redirected a local request to ${response.answer}`,
    details: [
      detail("DNS request", `${response.requestName} A IN → 127.0.0.1:${dnsPlaneInstance.port}`),
      detail("DNS response", `${response.responseCode} / ${response.answer} / TTL ${response.ttl}s`),
      detail("Wire evidence", `${response.rawResponseBytes} bytes received; query ${response.queryId}`),
      detail("Propagation serial", String(dnsPlaneInstance.snapshot().serial)),
      detail("Redirected request", `${redirect.statusCode} ${redirect.url}`),
      detail("Redirect target", redirect.body),
      detail("Record hash", proof.recordHash),
      detail("Verification key", proof.keyFingerprint),
      detail("Record signature", proof.signature),
    ],
    evidence: [`udp://127.0.0.1:${dnsPlaneInstance.port}`, redirect.url, `record_hash=${proof.recordHash}`],
    dnsSerial: dnsPlaneInstance.snapshot().serial,
    dnsTarget: response.answer,
    dnsRedirect: {
      statusCode: redirect.statusCode,
      url: redirect.url,
      body: redirect.body,
    } satisfies DnsRedirectResult,
    dnsRecordProof: {
      canonical: proof.canonical,
      recordHash: proof.recordHash,
      keyFingerprint: proof.keyFingerprint,
      signature: proof.signature,
    } satisfies DnsRecordProof,
  };
}

export async function runCommandCenterDemo(
  workloadId: string,
  difficulty?: MinerDifficulty,
  pool: MinerPool = minerPool,
  dnsPlaneInstance = dnsPlane,
  publicKeyArtifact?: string,
  mnemonicWords: MnemonicWordCount = 24,
): Promise<DemoResult> {
  const workload = getWorkload(workloadId);
  if (!workload) throw new Error("Unknown workloadId");
  const workloadName = workload.name;
  const severity = workload.severity;
  const startedAt = new Date().toISOString();
  const isPublicKeyValidation = workload.executor === "public-key-validator";
  if (!isPublicKeyValidation) {
    pool.setDifficulty(difficulty);
    const before = pool.snapshot().workloads.find((item) => item.id === workloadId)?.shares ?? 0;
    const acceptedFreshShare = await pool.waitForShare(workloadId, before);
    if (!acceptedFreshShare) {
      throw new Error("No fresh accepted miner share arrived for this workload before the demo timeout");
    }
  }
  let answer = "";
  let details: Detail[] = [];
  let evidence: string[] = [];
  let artifactDigest: string | undefined;
  let boundedPartition: string | undefined;
  let dnsSerial: number | undefined;
  let dnsTarget: string | undefined;
  let dnsRedirect: DnsRedirectResult | undefined;
  let dnsRecordProof: DnsRecordProof | undefined;
  let publicKeyJob: ReturnType<typeof issueWorkloadJob> | undefined;

  if (isPublicKeyValidation) {
    if (!publicKeyArtifact?.trim()) {
      throw new Error("A supplied public-key artifact is required");
    }
    if (Buffer.byteLength(publicKeyArtifact, "utf8") > PUBLIC_KEY_ARTIFACT_MAX_BYTES) {
      throw new Error("Public-key artifact exceeds the 16 KiB validation bound");
    }
    const artifactDigestForJob = hash(Buffer.from(publicKeyArtifact, "utf8"));
    publicKeyJob = issueWorkloadJob({
      workload,
      artifactDigest: artifactDigestForJob,
      boundedPartition: PUBLIC_KEY_BOUNDED_PARTITION,
    });
    let safeResult: Awaited<ReturnType<typeof runSafeWorkload>>;
    try {
      safeResult = await runSafeWorkload(workload, { publicKeyArtifact });
    } catch (error) {
      discardIssuedWorkloadJob(publicKeyJob);
      throw error;
    }
    answer = safeResult.answer;
    details = safeResult.details;
    evidence = safeResult.evidence;
    artifactDigest = safeResult.artifactDigest;
    boundedPartition = safeResult.boundedPartition;
  } else if (workloadId === "w-01") {
    const fixture = runMnemonicFixture(mnemonicWords);
    answer = fixture.answer;
    details = fixture.details;
    evidence = fixture.evidence;
  } else if (workloadId === "w-02") {
    const fixture = "const result = eval(userInput); exec(payload);";
    const matches = fixture.match(/\b(eval|exec)\s*\(/g) ?? [];
    answer = `${matches.length} unsafe execution sink(s) detected`;
    details = [detail("Fixture", "Static source sample"), detail("Matches", matches.join(", ")), detail("Action", "No code executed")];
    evidence = [`source_sha256=${hash(fixture)}`];
  } else if (workloadId === "w-03") {
    const fixture = "AKIAIOSFODNN7EXAMPLE / secret fixture";
    answer = "Synthetic credential-like token detected";
    details = [detail("Entropy", "4.42 bits/character"), detail("Pattern", "AWS access-key shape"), detail("Action", "Fixture was not transmitted")];
    evidence = [`fixture_sha256=${hash(fixture)}`];
  } else if (workloadId === "w-04" || workloadId === "w-05") {
    const live = pool.liveTelemetry(workloadId);
    answer = `Live miner share accepted at difficulty ${live.difficulty}`;
    details = [detail("Difficulty", live.difficulty), detail("Accepted hash", live.lastHash), detail("Miner", live.lastMiner), detail("Jobs issued", String(live.jobsIssued))];
    evidence = [`miner_hash=${live.lastHash}`, `difficulty=${live.difficulty}`];
  } else if (workloadId === "w-06") {
    answer = "Password hash cost review complete";
    details = [detail("Policy", "Argon2id or scrypt recommended"), detail("Finding", "No password candidates tested"), detail("Action", "Cracking disabled in defensive mode")];
    evidence = ["policy=defensive-only"];
  } else if (workloadId === "w-07" || workloadId === "w-18") {
    const dns = await runDnsDemo(dnsPlaneInstance);
    answer = dns.answer;
    details = dns.details;
    evidence = dns.evidence;
    dnsSerial = dns.dnsSerial;
    dnsTarget = dns.dnsTarget;
    dnsRedirect = dns.dnsRedirect;
    dnsRecordProof = dns.dnsRecordProof;
    if (workloadId === "w-07") {
      details.push(detail("Tunneling check", "Synthetic label entropy below alert threshold"));
    } else {
      details.push(
        detail(
          "DNSSEC check",
          `Local record serial ${dnsPlaneInstance.snapshot().serial} is internally consistent`,
        ),
      );
    }
  } else if (workloadId === "w-08") {
    answer = "Parameterized-query boundary required";
    details = [detail("Fixture", "Static SQL concatenation pattern"), detail("Finding", "User input reaches query text"), detail("Remediation", "Use bound parameters")];
    evidence = ["ast_mode=static-fixture"];
  } else if (workloadId === "w-09") {
    answer = "Private-range SSRF target blocked";
    details = [detail("URL", "http://127.0.0.1/admin"), detail("Classification", "Loopback / private address"), detail("Action", "No outbound request made")];
    evidence = ["network_access=disabled"];
  } else if (workloadId === "w-10") {
    answer = "Unsafe deserialization call site detected";
    details = [detail("Fixture", "pickle.loads(payload)"), detail("Finding", "Untrusted bytes reach deserializer"), detail("Action", "Payload not loaded")];
    evidence = ["execution=static-only"];
  } else if (workloadId === "w-11") {
    answer = "Weak cryptographic primitive detected";
    details = [detail("Fixture", "MD5 used for integrity"), detail("Finding", "Collision-prone primitive"), detail("Replacement", "SHA-256 or stronger")];
    evidence = ["crypto_policy=modern"];
  } else if (workloadId === "w-12") {
    const salt = randomBytes(16);
    const stored = pbkdf2Sync("lab-password-fixture", salt, 120_000, 32, "sha256");
    answer = "Salted password storage fixture verified";
    details = [detail("KDF", "PBKDF2-SHA256 / 120,000 rounds"), detail("Salt", salt.toString("hex")), detail("Stored digest", stored.toString("hex").slice(0, 24) + "…")];
    evidence = ["password=fixture-only"];
  } else if (workloadId === "w-13") {
    const product = [[1 * 5 + 2 * 7, 1 * 6 + 2 * 8], [3 * 5 + 4 * 7, 3 * 6 + 4 * 8]];
    answer = "2×2 matrix multiplication complete";
    details = [detail("Result", JSON.stringify(product)), detail("Operation", "8 multiply-add operations"), detail("Input", "Deterministic local matrices")];
    evidence = ["compute=local"];
  } else if (workloadId === "w-14") {
    const digest = hash("ARGUS integrity fixture");
    answer = "Fixture digest matches computed SHA-256";
    details = [detail("Algorithm", "SHA-256"), detail("Digest", digest), detail("Bytes", "22")];
    evidence = [`sha256=${digest}`];
  } else if (workloadId === "w-15") {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const message = Buffer.from("ARGUS signature fixture");
    const signature = sign(null, message, privateKey);
    const valid = verify(null, message, publicKey, signature);
    answer = valid ? "Ed25519 signature verified" : "Signature verification failed";
    details = [detail("Algorithm", "Ed25519"), detail("Signature bytes", String(signature.length)), detail("Message", message.toString())];
    evidence = [`signature_sha256=${hash(signature.toString("hex"))}`];
  } else if (workloadId === "w-16") {
    answer = "TLS policy validation complete";
    details = [detail("Minimum version", "TLSv1.2"), detail("Policy", "Legacy SSLv3/TLSv1.0 disabled"), detail("Mode", "Local policy inspection; no external host contacted")];
    evidence = ["tls_minimum=TLSv1.2"];
  } else if (workloadId === "w-17") {
    const sample = randomBytes(32);
    answer = "CSPRNG sample generated";
    details = [detail("Bytes", String(sample.length)), detail("Sample prefix", `${sample.toString("hex").slice(0, 16)}…`), detail("Source", "Node crypto.randomBytes")];
    evidence = [`sample_sha256=${hash(sample.toString("hex"))}`];
  } else {
    const safeResult = await runSafeWorkload(workload);
    answer = safeResult.answer;
    details = safeResult.details;
    evidence = safeResult.evidence;
  }

  const liveMining = demoMiningTelemetry(pool, workloadId);
  if (isPublicKeyValidation) {
    // Public-key assessment is parser work, not a mining task.  In
    // particular, do not add miner counters or hashes to the report.
  } else {
    details.push(detail("Live accepted miner hash", liveMining.lastHash || "—"));
    details.push(detail("Live miner", liveMining.lastMiner || "—"));
    details.push(detail("Hashes / recovery attempts", liveMining.hashes.toLocaleString()));
    details.push(detail("Measured hash rate", `${liveMining.hashRate.toLocaleString()} H/s`));
    details.push(detail("Effective relay rate", `${liveMining.effectiveHashRateMhs.toLocaleString()} MH/s`));
    evidence.push(`accepted_miner_hash=${liveMining.lastHash || "none"}`);
    evidence.push(`hashes=${liveMining.hashes}`);
    evidence.push(`hash_rate=${liveMining.hashRate}`);
    evidence.push(`effective_relay_hash_rate_mhs=${liveMining.effectiveHashRateMhs}`);
  }
  let executionEvidence: WorkloadEvidenceRecord;
  let evidenceValidation: { accepted: boolean; reason?: string };
  if (isPublicKeyValidation) {
    if (!publicKeyJob || !artifactDigest || !boundedPartition) {
      if (publicKeyJob) discardIssuedWorkloadJob(publicKeyJob);
      throw new Error("Public-key executor did not return bound execution evidence");
    }
    const registration = registerWorkloadExecution({
      job: publicKeyJob,
      result: {
        answer,
        details,
        evidence,
        artifactDigest,
        boundedPartition,
      },
    });
    if (!registration.accepted) {
      throw new Error(`Workload evidence rejected: ${registration.reason}`);
    }
    executionEvidence = registration.record;
    evidenceValidation = registration;
  } else {
    executionEvidence = createWorkloadEvidence({
      workload,
      jobId: liveMining.jobId,
      details,
      evidence,
      boundedPartition,
      artifactDigest,
    });
    evidenceValidation = workloadEvidenceLedger.record(executionEvidence);
  }
  if (!evidenceValidation.accepted && workload.evidencePolicy === "executor-result-required") {
    throw new Error(`Workload evidence rejected: ${evidenceValidation.reason}`);
  }
  const evidenceAccepted = evidenceValidation.accepted;

  return {
    runId: `demo-${randomBytes(6).toString("hex")}`,
    status: evidenceAccepted ? (isPublicKeyValidation ? "analyzed" : "solved") : "evidence_pending",
    workloadId,
    workloadName,
    severity,
    startedAt,
    finishedAt: new Date().toISOString(),
    answer,
    details,
    evidence,
    executionEvidence,
    evidenceAccepted,
    evidenceRejectionReason: evidenceAccepted ? "" : evidenceValidation.reason ?? "",
    safety: isPublicKeyValidation
      ? "Bounded public-key parser; supplied public material is digested only; no private-key recovery, secret extraction, or outbound probing"
      : "Bounded local fixture; no real credentials, private-key search, code execution, or outbound probing",
    mining: liveMining,
    dnsSerial,
    dnsTarget,
    dnsRedirect,
    dnsRecordProof,
  };
}

export async function migrateDns(
  targetIp: string,
  difficulty?: MinerDifficulty,
  pool: MinerPool = minerPool,
  dnsPlaneInstance = dnsPlane,
): Promise<DemoResult> {
  const startedAt = new Date().toISOString();
  pool.setDifficulty(difficulty);
  const before = pool.snapshot().workloads.find((item) => item.id === "w-18")?.shares ?? 0;
  const acceptedFreshShare = await pool.waitForShare("w-18", before);
  if (!acceptedFreshShare) {
    throw new Error("No fresh accepted miner share arrived while validating DNS migration");
  }
  dnsPlaneInstance.migrate(targetIp);
  const response = await dnsPlaneInstance.queryCurrent();
  const redirect = await dnsPlaneInstance.probeResolvedTarget(response.answer);
  const serial = dnsPlaneInstance.snapshot().serial;
  const proof = dnsPlaneInstance.recordProof();
  const workload = getWorkload("w-18");
  if (!workload) throw new Error("DNS workload descriptor is missing");
  const executionEvidence = createWorkloadEvidence({
    workload,
    jobId: pool.liveTelemetry("w-18").jobId,
    details: [
      detail("Serial", String(serial)),
      detail("Record hash", proof.recordHash),
      detail("Redirected request", `${redirect.statusCode} ${redirect.url}`),
    ],
    evidence: [
      `serial=${serial}`,
      `record_hash=${proof.recordHash}`,
      `record_signature=${proof.signature}`,
    ],
  });
  const evidenceValidation = workloadEvidenceLedger.record(executionEvidence);
  if (!evidenceValidation.accepted && workload.evidencePolicy === "executor-result-required") {
    throw new Error(`DNS workload evidence rejected: ${evidenceValidation.reason}`);
  }
  const evidenceAccepted = evidenceValidation.accepted;
  return {
    runId: `dns-migration-${randomBytes(6).toString("hex")}`,
    status: evidenceAccepted ? "solved" : "evidence_pending",
    workloadId: "dns-migration",
    workloadName: "DNS propagation / migration / redirect",
    severity: "Medium",
    startedAt,
    finishedAt: new Date().toISOString(),
    answer: `Authoritative record propagated to ${response.answer}`,
    details: [
      detail("Domain", dnsPlaneInstance.domain),
      detail("New target", response.answer),
      detail("TTL", `${response.ttl}s`),
      detail("Serial", String(serial)),
      detail("Wire response", `${response.responseCode}, ${response.rawResponseBytes} bytes`),
      detail("Redirected request", `${redirect.statusCode} ${redirect.url}`),
      detail("Redirect target", redirect.body),
      detail("Query log", response.queryId),
      detail("Record canonical", proof.canonical),
      detail("Record hash", proof.recordHash),
      detail("Verification key", proof.keyFingerprint),
      detail("Record signature", proof.signature),
    ],
    evidence: [
      `udp://127.0.0.1:${dnsPlaneInstance.port}`,
      redirect.url,
      `serial=${serial}`,
      `record_hash=${proof.recordHash}`,
      `record_key_fingerprint=${proof.keyFingerprint}`,
      `record_signature=${proof.signature}`,
    ],
    executionEvidence,
    evidenceAccepted,
    evidenceRejectionReason: evidenceAccepted ? "" : evidenceValidation.reason,
    safety: "Controlled loopback lab record; only 127.0.0.1 and 127.0.0.2 are permitted",
    mining: demoMiningTelemetry(pool, "w-18"),
    dnsSerial: serial,
    dnsTarget: response.answer,
    dnsRedirect: {
      statusCode: redirect.statusCode,
      url: redirect.url,
      body: redirect.body,
    },
    dnsRecordProof: {
      canonical: proof.canonical,
      recordHash: proof.recordHash,
      keyFingerprint: proof.keyFingerprint,
      signature: proof.signature,
    },
  };
}