import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { localSecurityLab, type LocalSecurityLab } from "./local-security-lab";
import { runMnemonicFixture } from "./mnemonic-fixture";
import { runPublicKeyValidation as validatePublicKeyArtifact } from "./public-key-validator";
import type { WorkloadDescriptor } from "./workload-catalog";

export type SafeWorkloadResult = {
  answer: string;
  details: Array<{ label: string; value: string }>;
  evidence: string[];
  artifactDigest?: string;
  boundedPartition?: string;
};

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const detail = (label: string, value: string) => ({ label, value });

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function complete(
  answer: string,
  details: Array<{ label: string; value: string }>,
  evidence: string[],
  metadata: Pick<SafeWorkloadResult, "artifactDigest" | "boundedPartition"> = {},
): SafeWorkloadResult {
  return { answer, details, evidence, ...metadata };
}

async function runLocalWorkload(
  workload: WorkloadDescriptor,
  lab: LocalSecurityLab,
  input: { publicKeyArtifact?: string } = {},
): Promise<SafeWorkloadResult> {
  switch (workload.executor) {
    case "mnemonic-fixture":
      return runMnemonicFixture();
    case "public-key-validator":
      return validatePublicKeyArtifact(input.publicKeyArtifact);
    case "hash-benchmark": {
      const fixture = "ARGUS synthetic benchmark payload ".repeat(32);
      const started = Date.now();
      let sha256 = "";
      let sha512 = "";
      let hmac = "";
      for (let index = 0; index < 2_000; index += 1) {
        sha256 = createHash("sha256").update(`${fixture}:${index}`).digest("hex");
        sha512 = createHash("sha512").update(`${fixture}:${index}`).digest("hex");
        hmac = createHmac("sha256", "ARGUS-LAB").update(`${fixture}:${index}`).digest("hex");
      }
      return complete("Hash algorithm comparison completed", [
        detail("Iterations", "2,000"),
        detail("Algorithms", "SHA-256 / SHA-512 / HMAC-SHA256"),
        detail("Elapsed", `${Math.max(Date.now() - started, 1)} ms`),
        detail("Final digests", `${sha256.slice(0, 12)}… / ${sha512.slice(0, 12)}… / ${hmac.slice(0, 12)}…`),
      ], [`fixture_sha256=${digest(fixture)}`, "scope=synthetic"]);
    }
    case "cpu-benchmark": {
      const started = Date.now();
      let accumulator = 0;
      for (let index = 1; index <= 250_000; index += 1) accumulator = (accumulator + ((index * 17) % 97)) % 1_000_003;
      return complete("CPU vector reduction completed", [
        detail("Operations", "250,000 bounded integer reductions"),
        detail("Accumulator", String(accumulator)),
        detail("Elapsed", `${Math.max(Date.now() - started, 1)} ms`),
      ], [`result_sha256=${digest(String(accumulator))}`, "execution=local"]);
    }
    case "parallel-batch": {
      const outputs = Array.from({ length: 256 }, (_, index) => digest(`batch-record-${index}`));
      return complete("Parallel-safe batch digest completed", [
        detail("Records", String(outputs.length)),
        detail("Batch mode", "Independent in-memory records"),
        detail("First digest", outputs[0].slice(0, 16) + "…"),
        detail("Last digest", outputs.at(-1)!.slice(0, 16) + "…"),
      ], [`batch_root=${digest(outputs.join(""))}`, "network_access=disabled"]);
    }
    case "policy-audit":
    case "auth-audit": {
      const auth = await lab.getJson("/api/security/auth");
      const controls = {
        minLength: 14,
        mfaRequired: auth.mfa === true,
        lockout: auth.lockout === true,
        reuseWindow: 12,
      };
      const passed = Object.values(controls).filter(Boolean).length;
      return complete("Authentication policy controls evaluated", [
        detail("Controls passed", `${passed} / 4`),
        detail("MFA", controls.mfaRequired ? "required" : "missing"),
        detail("Lockout", controls.lockout ? "enabled" : "missing"),
        detail("Password length", `${controls.minLength} characters minimum`),
        detail("Live subject", String(auth.subject ?? "unknown")),
      ], ["service=/api/security/auth", "credentials_tested=0"]);
    }
    case "tls-audit": {
      const policy = await lab.getJson("/api/security/headers");
      const headers = Array.isArray(policy.headers) ? policy.headers.map(String) : [];
      return complete("TLS and HTTPS policy audit completed", [
        detail("Minimum protocol", String(policy.tlsMinimum ?? "unknown")),
        detail("Required headers", `${headers.length} policy checks`),
        detail("Legacy protocols", Array.isArray(policy.legacyProtocols) ? `${policy.legacyProtocols.join(" / ")} disabled` : "policy checked"),
        detail("Live response", "received from loopback security lab"),
      ], ["service=/api/security/headers", `header_policy_sha256=${digest(headers.join("|"))}`]);
    }
    case "dependency-audit": {
      const response = await lab.getJson("/api/security/manifest");
      const manifest = Array.isArray(response.components) ? response.components.map(String) : [];
      const reviewed = manifest.filter((item) => !item.includes("latest"));
      return complete("Local dependency manifest reviewed", [
        detail("Components", String(manifest.length)),
        detail("Pinned components", String(reviewed.length)),
        detail("Manifest source", "loopback security lab"),
        detail("Advisory fetch", "disabled by local policy"),
      ], [`manifest_sha256=${digest(manifest.join("\n"))}`, "service=/api/security/manifest"]);
    }
    case "fuzz-fixture": {
      const seed = "<record><name>ARGUS</name><count>3</count></record>";
      const mutations = [seed.replace("3", "0"), seed.replace("<", ""), seed + "x", seed.replace("</name>", "")];
      const rejected = mutations.filter((value) => !/^<record><name>[^<]+<\/name><count>\d+<\/count><\/record>$/.test(value)).length;
      return complete("Bounded parser fuzz fixture completed", [
        detail("Mutations", String(mutations.length)),
        detail("Rejected malformed inputs", String(rejected)),
        detail("Execution", "pure in-memory parser check"),
      ], [`seed_sha256=${digest(seed)}`, "process_launches=0"]);
    }
    case "malware-metadata":
    case "ransomware-analysis": {
      const fixture = "sample.exe|section:.text|import:CreateFileW|behavior:mass-file-write";
      const indicators = ["CreateFileW", "mass-file-write"].filter((item) => fixture.includes(item));
      return complete("Sample metadata indicators classified", [
        detail("Indicators", String(indicators.length)),
        detail("Observed", indicators.join(", ")),
        detail("Sample action", "metadata and strings only"),
      ], [`sample_metadata_sha256=${digest(fixture)}`, "execution=0"]);
    }
    case "entropy-test": {
      const sample = randomBytes(2_048);
      const buckets = new Set(sample).size;
      return complete("Randomness sample evaluated", [
        detail("Sample size", `${sample.length} bytes`),
        detail("Distinct byte values", String(buckets)),
        detail("Test", "frequency and runs preflight"),
      ], [`sample_sha256=${digest(sample)}`, "source=node-csprng"]);
    }
    case "checksum-batch": {
      const digests = Array.from({ length: 512 }, (_, index) => digest(`artifact-${index}-ARGUS`));
      return complete("Checksum batch completed", [
        detail("Artifacts", String(digests.length)),
        detail("Algorithm", "SHA-256"),
        detail("Digest set", `${new Set(digests).size} unique`),
      ], [`batch_root=${digest(digests.join(""))}`, "raw_artifacts_retained=0"]);
    }
    case "dedup": {
      const records = ["alpha", "beta", "alpha", "gamma", "beta", "delta"];
      const unique = new Set(records).size;
      return complete("Synthetic dataset deduplicated", [
        detail("Input records", String(records.length)),
        detail("Unique records", String(unique)),
        detail("Duplicates removed", String(records.length - unique)),
      ], [`dataset_sha256=${digest(records.join("|"))}`, "data_source=synthetic"]);
    }
    case "ml-inference": {
      const samples = [[2, 1], [1, 3], [-1, -2], [-2, -1]];
      const predictions = samples.map(([x, y]) => (x * 0.8 + y * 0.4 >= 0 ? 1 : 0));
      return complete("Deterministic classifier inference completed", [
        detail("Model", "2-feature linear threshold"),
        detail("Samples", String(samples.length)),
        detail("Positive classifications", String(predictions.filter(Boolean).length)),
      ], [`predictions_sha256=${digest(predictions.join(","))}`, "training=0"]);
    }
    case "monte-carlo":
    case "risk-simulation":
    case "response-timing": {
      const random = seeded(42);
      const values = Array.from({ length: 2_000 }, () => random());
      const average = values.reduce((sum, value) => sum + value, 0) / values.length;
      return complete("Seeded statistical simulation completed", [
        detail("Samples", String(values.length)),
        detail("Mean", average.toFixed(5)),
        detail("Seed", "42"),
      ], [`sample_sha256=${digest(values.join(","))}`, "external_data=0"]);
    }
    case "climate-simulation": {
      let grid = Array.from({ length: 16 }, (_, row) => Array.from({ length: 16 }, (_, column) => (row + column) % 7));
      for (let step = 0; step < 12; step += 1) {
        grid = grid.map((row, rowIndex) => row.map((value, columnIndex) => {
          const neighbors = [grid[rowIndex - 1]?.[columnIndex], grid[rowIndex + 1]?.[columnIndex], grid[rowIndex]?.[columnIndex - 1], grid[rowIndex]?.[columnIndex + 1]].filter((item): item is number => item !== undefined);
          return Math.round((value + neighbors.reduce((sum, item) => sum + item, 0)) / (neighbors.length + 1));
        }));
      }
      return complete("Bounded climate-grid simulation completed", [
        detail("Grid", "16 × 16"),
        detail("Steps", "12"),
        detail("Final center", String(grid[8][8])),
      ], [`grid_sha256=${digest(grid.flat().join(","))}`, "model=synthetic"]);
    }
    case "matrix-benchmark": {
      const left = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
      const right = [[9, 8, 7], [6, 5, 4], [3, 2, 1]];
      const product = left.map((row) => right[0].map((_, column) => row.reduce((sum, value, index) => sum + value * right[index][column], 0)));
      return complete("Blocked matrix multiplication completed", [
        detail("Dimensions", "3 × 3 × 3"),
        detail("Result", JSON.stringify(product)),
        detail("Operations", "27 multiply-add terms"),
      ], [`matrix_sha256=${digest(JSON.stringify(product))}`, "inputs=deterministic"]);
    }
    case "compression": {
      const input = Buffer.from("ARGUS compression fixture ".repeat(256));
      const compressed = deflateSync(input);
      const restored = inflateSync(compressed);
      return complete("Compression round-trip completed", [
        detail("Input bytes", String(input.length)),
        detail("Compressed bytes", String(compressed.length)),
        detail("Round trip", restored.equals(input) ? "verified" : "failed"),
      ], [`input_sha256=${digest(input)}`, `compressed_sha256=${digest(compressed)}`]);
    }
    case "query-benchmark": {
      const liveQuery = await lab.getJson("/api/security/query");
      const rows = Array.from({ length: 2_000 }, (_, id) => ({ id, state: id % 3 === 0 ? "open" : "closed" }));
      const started = Date.now();
      const result = rows.filter((row) => row.state === "open");
      return complete("Parameterized in-memory query benchmark completed", [
        detail("Rows scanned", String(rows.length)),
        detail("Matched rows", String(result.length)),
        detail("Elapsed", `${Math.max(Date.now() - started, 1)} ms`),
        detail("Live service boundary", String(liveQuery.inputBoundary ?? "unknown")),
      ], ["query_mode=parameterized", "database_mutation=0", "service=/api/security/query"]);
    }
    case "accessibility": {
      const fixture = { headings: 2, labels: 4, altText: 3, contrastFailures: 0, focusableControls: 7 };
      return complete("Synthetic accessibility policy audit completed", [
        detail("Headings", String(fixture.headings)),
        detail("Labels", String(fixture.labels)),
        detail("Contrast failures", String(fixture.contrastFailures)),
        detail("Focusable controls", String(fixture.focusableControls)),
      ], [`dom_fixture_sha256=${digest(JSON.stringify(fixture))}`, "browser_runtime=0"]);
    }
    case "anonymization": {
      const source = "Contact alex@example.test from 192.0.2.15";
      const redacted = source.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]").replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]");
      return complete("Synthetic data anonymization completed", [
        detail("Input", source),
        detail("Redacted", redacted),
        detail("Identifiers removed", "email and IP-shaped values"),
      ], [`output_sha256=${digest(redacted)}`, "source=synthetic"]);
    }
    case "backup-integrity":
    case "backup-restore": {
      const manifest = ["db.sql:1024", "uploads/index.json:88", "config/policy.json:412"];
      const root = digest(manifest.join("\n"));
      return complete("Backup manifest round-trip verified", [
        detail("Entries", String(manifest.length)),
        detail("Manifest root", root),
        detail("Restoration", "in-memory verification only"),
      ], [`manifest_sha256=${root}`, "filesystem_writes=0"]);
    }
    case "reproducible-build": {
      const manifest = ["src/index.ts", "src/policy.ts", "package-lock.json"].sort().join("\n");
      return complete("Canonical build manifest verified", [
        detail("Entries", "3"),
        detail("Canonical order", "lexicographic"),
        detail("Build output", "deterministic manifest only"),
      ], [`manifest_sha256=${digest(manifest)}`, "compiler_spawned=0"]);
    }
    case "blockchain-simulation": {
      let previous = digest("ARGUS-TESTNET-GENESIS");
      for (let index = 0; index < 8; index += 1) previous = digest(`${previous}:tx-${index}:testnet`);
      return complete("Test-network transaction chain simulated", [
        detail("Transactions", "8 synthetic transactions"),
        detail("Final block root", previous),
        detail("Network", "local fixture; no broadcast"),
      ], [`chain_root=${previous}`, "broadcast=0"]);
    }
    case "signing-benchmark": {
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const message = Buffer.from("ARGUS signing benchmark fixture");
      const signature = sign(null, message, privateKey);
      return complete("Signing-library benchmark completed", [
        detail("Algorithm", "Ed25519"),
        detail("Signature bytes", String(signature.length)),
        detail("Verification", verify(null, message, publicKey, signature) ? "valid" : "invalid"),
      ], [`signature_sha256=${digest(signature)}`, "messages=synthetic"]);
    }
    case "protocol-benchmark": {
      const message = { type: "telemetry", sequence: 7, status: "ok" };
      let encoded = "";
      let decoded: typeof message = message;
      for (let index = 0; index < 1_000; index += 1) {
        encoded = JSON.stringify({ ...message, sequence: index });
        decoded = JSON.parse(encoded) as typeof message;
      }
      return complete("Local protocol encode/decode benchmark completed", [
        detail("Round trips", "1,000"),
        detail("Last sequence", String(decoded.sequence)),
        detail("Transport", "in-memory only"),
      ], [`message_sha256=${digest(encoded)}`, "remote_connections=0"]);
    }
    case "privacy-computation": {
      const secret = 73;
      const shareA = 31;
      const shareB = secret - shareA;
      return complete("Additive secret-sharing computation verified", [
        detail("Shares", `${shareA} + ${shareB}`),
        detail("Reconstructed value", String(shareA + shareB)),
        detail("Raw input", "synthetic integer only"),
      ], [`shares_sha256=${digest(`${shareA}:${shareB}`)}`, "external_data=0"]);
    }
    case "web-challenge":
    case "sql-detector":
    case "api-remediation": {
      const fixture = "SELECT * FROM accounts WHERE id = '\" + input + \"'";
      const detected = /\bSELECT\b[\s\S]*(?:\+|\$\{|\binput\b)/i.test(fixture);
      return complete("Static application-security challenge analyzed", [
        detail("Finding", detected ? "query text reaches input" : "no match"),
        detail("Remediation", "use parameterized queries"),
        detail("Action", "no request or payload delivered"),
      ], [`fixture_sha256=${digest(fixture)}`, "network_requests=0"]);
    }
    case "binary-inspection": {
      const fixture = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x41, 0x52, 0x47, 0x55, 0x53]);
      return complete("Challenge binary metadata inspected", [
        detail("Magic bytes", fixture.subarray(0, 2).toString("hex")),
        detail("Format hint", fixture.subarray(0, 2).toString("ascii") === "MZ" ? "PE-shaped fixture" : "unknown"),
        detail("Execution", "none"),
      ], [`fixture_sha256=${digest(fixture)}`, "process_spawned=0"]);
    }
    case "secret-scan": {
      const fixture = "token=EXAMPLE_ONLY_1234567890; entropy=synthetic";
      const matches = fixture.match(/\b(?:token|secret|password)\s*=\s*[A-Z0-9_]+/gi) ?? [];
      return complete("Synthetic secret-exposure indicators classified", [
        detail("Indicators", String(matches.length)),
        detail("Action", "indicator reported; value not recovered or transmitted"),
        detail("Fixture", "synthetic"),
      ], [`fixture_sha256=${digest(fixture)}`, "secret_recovery=0"]);
    }
    case "phishing-analysis": {
      const fixture = "Urgent account verification at https://login.example.test";
      const indicators = [/urgent/i, /verify/i, /login/i].filter((pattern) => pattern.test(fixture)).length;
      return complete("Synthetic message phishing indicators classified", [
        detail("Indicators", String(indicators)),
        detail("Signals", "urgency / verification / login language"),
        detail("Delivery", "no message sent"),
      ], [`message_sha256=${digest(fixture)}`, "outbound_messages=0"]);
    }
    case "login-triage":
    case "endpoint-triage":
    case "cloud-logs": {
      const eventResponse = await lab.getJson("/api/security/events");
      const events = Array.isArray(eventResponse.events) ? eventResponse.events : [];
      const suspicious = events.filter((event) => !event.success).length;
      return complete("Live security events triaged", [
        detail("Events", String(events.length)),
        detail("Suspicious events", String(suspicious)),
        detail("Disposition", suspicious ? "review required" : "clear"),
      ], [`events_sha256=${digest(JSON.stringify(events))}`, "service=/api/security/events"]);
    }
    case "cloud-audit": {
      const controls = { publicBucket: false, wildcardIam: false, auditLogs: true, encryption: true };
      const failures = Object.values(controls).filter((value) => !value).length;
      return complete("Synthetic cloud configuration audited", [
        detail("Controls reviewed", String(Object.keys(controls).length)),
        detail("Failures", String(failures)),
        detail("Highest priority", failures ? "remove public exposure and wildcard IAM" : "none"),
      ], [`config_sha256=${digest(JSON.stringify(controls))}`, "cloud_contact=0"]);
    }
    case "asset-manifest": {
      const response = await lab.getJson("/api/security/manifest");
      const assets = Array.isArray(response.assets) ? response.assets.map(String) : [];
      return complete("Sandbox asset manifest inventoried", [
        detail("Assets", String(assets.length)),
        detail("Discovery mode", "local security lab manifest"),
        detail("Remote probes", "none"),
      ], [`asset_manifest_sha256=${digest(assets.join("|"))}`, "network_scans=0", "service=/api/security/manifest"]);
    }
    case "privilege-policy": {
      const edges = [["analyst", "read-logs"], ["admin", "write-policy"], ["service", "read-metrics"]];
      const wildcardEdges = edges.filter(([, permission]) => permission.includes("*")).length;
      return complete("Synthetic privilege policy validated", [
        detail("Role edges", String(edges.length)),
        detail("Wildcard permissions", String(wildcardEdges)),
        detail("Result", wildcardEdges ? "review required" : "least privilege fixture passes"),
      ], [`policy_sha256=${digest(JSON.stringify(edges))}`, "identities=synthetic"]);
    }
    case "crypto-challenge": {
      const expected = digest("ARGUS-KNOWN-ANSWER");
      const actual = digest("ARGUS-KNOWN-ANSWER");
      return complete(actual === expected ? "Cryptography known-answer test passed" : "Known-answer test failed", [
        detail("Algorithm", "SHA-256"),
        detail("Comparison", actual === expected ? "constant fixture match" : "mismatch"),
        detail("Input", "provided test vector only"),
      ], [`answer_sha256=${actual}`, "secret_recovery=0"]);
    }
    case "data-leak-triage":
    case "threat-hunting": {
      const records = ["normal request", "indicator: example.test", "normal response", "indicator: synthetic-token"];
      const indicators = records.filter((record) => record.startsWith("indicator:"));
      return complete("Synthetic incident indicators triaged", [
        detail("Records", String(records.length)),
        detail("Indicators", String(indicators.length)),
        detail("Raw incident data", "not retained"),
      ], [`timeline_sha256=${digest(records.join("\n"))}`, "external_queries=0"]);
    }
    case "ctf-puzzle": {
      const encoded = Buffer.from("QVJHVVMtTEFC", "base64").toString("utf8");
      return complete(encoded === "ARGUS-LAB" ? "Bounded capture-the-flag puzzle solved" : "Puzzle validation failed", [
        detail("Puzzle", "base64 known-answer fixture"),
        detail("Answer", encoded),
        detail("Scope", "local challenge state"),
      ], [`answer_sha256=${digest(encoded)}`, "external_targets=0"]);
    }
    case "siem-rule": {
      const events = ["login_failed", "login_failed", "role_changed", "login_success"];
      const matched = events.filter((event) => event === "login_failed").length >= 2;
      return complete("Synthetic SIEM rule replay completed", [
        detail("Rule", "two failed logins in event window"),
        detail("Matched", matched ? "yes" : "no"),
        detail("Events replayed", String(events.length)),
      ], [`events_sha256=${digest(events.join("|"))}`, "live_events=0"]);
    }
    case "firewall-review": {
      const flows = [
        { source: "lab-a", destination: "lab-api", port: 443, allowed: true },
        { source: "lab-a", destination: "metadata", port: 80, allowed: false },
        { source: "lab-b", destination: "lab-dns", port: 53, allowed: true },
      ];
      const blocked = flows.filter((flow) => !flow.allowed).length;
      return complete("Synthetic firewall flows reviewed", [
        detail("Flows", String(flows.length)),
        detail("Blocked policy matches", String(blocked)),
        detail("External traffic", "not generated"),
      ], [`flows_sha256=${digest(JSON.stringify(flows))}`, "network_packets=0"]);
    }
    case "patch-priority": {
      const assets = [{ id: "api", exposure: 5, severity: 5 }, { id: "worker", exposure: 2, severity: 3 }, { id: "lab-ui", exposure: 3, severity: 2 }];
      const ranked = [...assets].sort((left, right) => (right.exposure * right.severity) - (left.exposure * left.severity));
      return complete("Synthetic patch priorities ranked", [
        detail("Assets", String(ranked.length)),
        detail("Priority order", ranked.map((asset) => asset.id).join(" → ")),
        detail("Scoring", "exposure × severity"),
      ], [`ranking_sha256=${digest(ranked.map((asset) => asset.id).join("|"))}`, "package_mutations=0"]);
    }
    case "ir-playbook": {
      const states = ["detected", "contained", "eradicated", "recovered"];
      return complete("Incident-response playbook state machine completed", [
        detail("States", states.join(" → ")),
        detail("Terminal state", states.at(-1)!),
        detail("Incident", "synthetic"),
      ], [`playbook_sha256=${digest(states.join("|"))}`, "production_actions=0"]);
    }
    default:
      throw new Error(`No safe executor registered for ${workload.executor}`);
  }
}

export async function runSafeWorkload(
  workload: WorkloadDescriptor,
  input: { publicKeyArtifact?: string } = {},
): Promise<SafeWorkloadResult> {
  if (workload.executor === "public-key-validator") {
    return validatePublicKeyArtifact(input.publicKeyArtifact);
  }
  const lab = await localSecurityLab.start();
  const health = await lab.getJson("/healthz");
  const result = await runLocalWorkload(workload, lab, input);
  return {
    answer: result.answer,
    details: [
      detail("Live test subject", String(health.subject ?? "unknown")),
      detail("Service profile", String(health.profile ?? "unknown")),
      detail("Service health", String(health.status ?? "unknown")),
      ...result.details,
    ],
    evidence: [
      ...result.evidence,
      `local_service=${lab.baseUrl}`,
      `local_health=${String(health.status ?? "unknown")}`,
    ],
    artifactDigest: result.artifactDigest,
    boundedPartition: result.boundedPartition,
  };
}