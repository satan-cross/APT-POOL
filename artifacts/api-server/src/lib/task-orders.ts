import { getWorkload } from "./workload-catalog";
import { minerPool, type MinerPool } from "./miner-pool";

export type TaskOrderAvailability = "available" | "not_available";

export type TaskOrderTask = {
  id: string;
  title: string;
  description: string;
  category: string;
  status: TaskOrderAvailability;
  statusReason: string;
  sourceWorkloadId: string;
  executor: string;
  defaultItems: number;
  creditsPerThousand: number;
  estimatedSolvePercent: number;
  authorizationBoundary: "loopback-only";
};

export type TaskOrderCatalog = {
  mode: "preview";
  depositRequired: false;
  dispatchMode: "local-preview-only";
  notice: string;
  tasks: TaskOrderTask[];
};

export type TaskOrderQuoteInput = {
  taskId: string;
  hashRate: number;
  solvedPercent: number;
  totalItems: number;
};

export type TaskOrderQuote = {
  taskId: string;
  taskName: string;
  status: TaskOrderAvailability;
  availabilityReason: string;
  hashRate: number;
  solvedPercent: number;
  totalItems: number;
  estimatedSolvedItems: number;
  estimatedSeconds: number;
  estimatedTime: string;
  balanceRequiredCredits: number;
  depositRequired: false;
  dispatchMode: "local-preview-only";
};

export type TaskOrderQueueResult = {
  taskId: string;
  taskName: string;
  sourceWorkloadId: string;
  status: "queued";
  activeMiners: number;
  jobIds: string[];
  jobsIssued: number;
  dispatchMode: "loopback-local";
  message: string;
};

const safeTask = (
  id: string,
  title: string,
  description: string,
  category: string,
  sourceWorkloadId: string,
  executor: string,
  creditsPerThousand: number,
  defaultItems = 10_000,
): TaskOrderTask => ({
  id,
  title,
  description,
  category,
  status: "available",
  statusReason: "Available in the bounded local executor.",
  sourceWorkloadId,
  executor,
  defaultItems,
  creditsPerThousand,
  estimatedSolvePercent: 85,
  authorizationBoundary: "loopback-only",
});

const unavailableTask = (
  id: string,
  title: string,
  description: string,
  category: string,
  statusReason: string,
): TaskOrderTask => ({
  id,
  title,
  description,
  category,
  status: "not_available",
  statusReason,
  sourceWorkloadId: "",
  executor: "not-dispatched",
  defaultItems: 0,
  creditsPerThousand: 0,
  estimatedSolvePercent: 0,
  authorizationBoundary: "loopback-only",
});

// These names are mapped from the uploaded PHP task console to the existing
// safe workload executors. The PHP payment, card, wallet, and seller data are
// intentionally not imported.
const TASK_ORDER_TASKS: TaskOrderTask[] = [
  safeTask("web_security_challenge", "Web security challenge", "Analyze an isolated web-application fixture and produce a remediation finding.", "Ethical hacker / CTF", "w-45", "web-challenge", 8),
  safeTask("simulated_sql_flaw", "Simulated SQL-injection finding", "Match a synthetic query shape and document the parameterized-query fix.", "Ethical hacker / CTF", "w-46", "sql-detector", 7),
  safeTask("insecure_auth_review", "Insecure authentication review", "Evaluate synthetic authentication controls and record defensive improvements.", "Ethical hacker / CTF", "w-47", "auth-audit", 7),
  safeTask("vulnerable_api_report", "Vulnerable API analysis", "Review a synthetic API contract for validation and authorization weaknesses.", "Ethical hacker / CTF", "w-48", "api-remediation", 7),
  safeTask("challenge_binary_reverse_engineering", "Challenge binary inspection", "Inspect provided fixture bytes, strings, and headers without executing a binary.", "Ethical hacker / CTF", "w-49", "binary-inspection", 10),
  safeTask("simulated_phishing_investigation", "Simulated phishing investigation", "Score a synthetic message for phishing indicators and produce a triage result.", "Blue team", "w-51", "phishing-analysis", 6),
  safeTask("suspicious_login_analysis", "Suspicious login analysis", "Rank synthetic authentication events for anomalous behavior.", "Blue team", "w-52", "login-triage", 6),
  safeTask("cloud_misconfiguration_lab", "Cloud misconfiguration lab", "Evaluate synthetic cloud settings against defensive policy rules.", "Blue team", "w-53", "cloud-audit", 7),
  safeTask("sandbox_asset_discovery", "Sandbox asset manifest audit", "Review a supplied private-lab asset manifest without probing a network.", "Blue team", "w-54", "asset-manifest", 5),
  safeTask("simulated_privilege_escalation", "Privilege-policy validation", "Analyze synthetic roles and permissions for unsafe privilege paths.", "Blue team", "w-55", "privilege-policy", 7),
  safeTask("cryptography_challenge", "Cryptography challenge", "Verify known-answer cryptography vectors using provided test data only.", "Ethical hacker / CTF", "w-56", "crypto-challenge", 8),
  safeTask("simulated_data_leak", "Simulated data-leak investigation", "Match synthetic incident records to an exposure path and containment step.", "Blue team", "w-57", "data-leak-triage", 6),
  safeTask("sandbox_ransomware_analysis", "Sandbox ransomware analysis", "Inspect static metadata and strings from a fake sample without execution.", "Blue team", "w-58", "ransomware-analysis", 9),
  safeTask("capture_the_flag", "Capture-the-flag challenge", "Complete a bounded local puzzle with isolated challenge state.", "Ethical hacker / CTF", "w-59", "ctf-puzzle", 8),
  safeTask("endpoint_alert_triage", "Endpoint-alert triage", "Correlate synthetic endpoint events into a defensive alert disposition.", "Blue team", "w-60", "endpoint-triage", 6),
  safeTask("siem_detection_validation", "SIEM detection-rule validation", "Replay a synthetic event stream against a detection rule.", "Blue team", "w-61", "siem-rule", 6),
  safeTask("synthetic_threat_hunting", "Synthetic threat hunting", "Match synthetic indicators and timelines without accessing real telemetry.", "Blue team", "w-62", "threat-hunting", 7),
  safeTask("firewall_flow_review", "Firewall-flow review", "Evaluate synthetic network flows against an allow/deny policy.", "Blue team", "w-63", "firewall-review", 5),
  safeTask("patch_priority_review", "Patch-priority review", "Rank synthetic assets by defensive patch risk.", "Operations", "w-64", "patch-priority", 4),
  safeTask("incident_response_drill", "Incident-response playbook drill", "Replay a synthetic incident state machine and verify response sequencing.", "Blue team", "w-65", "ir-playbook", 6),
  safeTask("cloud_audit_log_review", "Cloud audit-log review", "Classify synthetic audit events for defensive follow-up.", "Blue team", "w-66", "cloud-logs", 5),
  safeTask("backup_restoration_drill", "Backup restoration drill", "Verify an in-memory backup manifest round trip.", "Operations", "w-67", "backup-restore", 5),
  safeTask("response_timing", "Detection and response timing", "Measure synthetic detection-to-response timeline metrics.", "Blue team", "w-68", "response-timing", 4),
  // Additional safe tasks present in the uploaded htdocs shop. They retain
  // the archive IDs but point only to existing synthetic local executors.
  safeTask("checksum_generation", "Checksum generation", "Generate a bounded checksum manifest for synthetic archive fixtures.", "Archive / local training", "w-28", "checksum-batch", 4),
  safeTask("cpu_performance_benchmark", "CPU performance benchmark", "Run a bounded integer benchmark against a deterministic local fixture.", "Archive / local training", "w-20", "cpu-benchmark", 4),
  safeTask("cryptographic_library_benchmark", "Cryptographic library benchmark", "Benchmark signing and verification against synthetic test messages.", "Archive / local training", "w-42", "signing-benchmark", 6),
  safeTask("dependency_scan", "Dependency scan", "Review a synthetic dependency manifest for policy and pinning issues.", "Archive / local training", "w-24", "dependency-audit", 6),
  safeTask("entropy_test", "Entropy test", "Evaluate generated synthetic bytes with a bounded randomness preflight.", "Archive / local training", "w-27", "entropy-test", 5),
  safeTask("file_integrity_verification", "File integrity verification", "Verify digests for an in-memory archive manifest without retaining files.", "Archive / local training", "w-28", "checksum-batch", 4),
  safeTask("hash_algorithm_benchmark", "Hash algorithm benchmark", "Compare fixed synthetic hashing workloads without accepting supplied hash lists.", "Archive / local training", "w-19", "hash-benchmark", 6),
  safeTask("isolated_fuzz_testing", "Isolated fuzz testing", "Run bounded parser mutations against an in-memory fixture.", "Archive / local training", "w-25", "fuzz-fixture", 7),
  safeTask("malware_sample_sandbox", "Malware sample sandbox review", "Classify metadata and strings from a fake sample without execution.", "Archive / local training", "w-26", "malware-metadata", 8),
  safeTask("malware_sample_forensics", "Malware sample forensics", "Produce a static indicator report from a synthetic sample fixture.", "Archive / local training", "w-26", "malware-metadata", 8),
  safeTask("network_protocol_benchmark", "Network protocol benchmark", "Exercise a local encode/decode loop without contacting a remote peer.", "Archive / local training", "w-43", "protocol-benchmark", 5),
  safeTask("password_policy_audit", "Password-policy audit", "Evaluate synthetic password-policy controls without testing credentials.", "Archive / local training", "w-22", "policy-audit", 6),
  safeTask("phishing_indicator_analysis", "Phishing-indicator analysis", "Score a synthetic message for defensive phishing indicators.", "Archive / local training", "w-51", "phishing-analysis", 5),
  safeTask("proof_of_work_benchmark", "Synthetic proof-of-work benchmark", "Measure a bounded local hash fixture; no coin, wallet, or external mining is involved.", "Archive / local training", "w-19", "hash-benchmark", 5),
  safeTask("siem_detection_rule", "SIEM detection-rule replay", "Replay synthetic events against a defensive detection rule.", "Archive / local training", "w-61", "siem-rule", 6),
  safeTask("endpoint_detection_validation", "Endpoint detection validation", "Correlate synthetic endpoint events without accessing real telemetry.", "Archive / local training", "w-60", "endpoint-triage", 6),
  safeTask("detection_response_metrics", "Detection-response metrics", "Measure a seeded synthetic detection-to-response timeline.", "Archive / local training", "w-68", "response-timing", 4),
  safeTask("tls_configuration_audit", "TLS configuration audit", "Review supplied loopback policy metadata without contacting external hosts.", "Archive / local training", "w-23", "tls-audit", 6),
  safeTask("backup_restoration_test", "Backup restoration test", "Verify a synthetic backup manifest round trip entirely in memory.", "Archive / local training", "w-39", "backup-integrity", 5),
  safeTask("dns_redirect_integrity_review", "DNS redirect range test", "Grade the production-shaped local DNS service and its permitted loopback target; external DNS and traffic are out of scope.", "Blue team", "w-70", "dns-redirect-fixture", 5),
  unavailableTask("password_hash_recovery", "Password hash recovery", "Credential recovery or cracking work.", "Credential recovery", "Password cracking and recovery are not offered; use the password-policy audit for defensive review."),
  unavailableTask("authorized_external_simulation", "Authorized external attack simulation", "External attack activity against designated assets.", "External operations", "This console only dispatches loopback-bound fixtures; no external targets are contacted."),
  unavailableTask("wallet_private_key_recovery", "Wallet private-key recovery", "Private-key or seed recovery from wallet material.", "Crypto recovery", "Private-key, seed, and mnemonic recovery are not performed."),
  unavailableTask("payment_card_inventory", "Payment-card inventory order", "Payment-card or account-data inventory.", "Restricted marketplace", "Payment-card, credential, and account-data inventory is not accepted."),
];

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function getTaskOrderCatalog(): TaskOrderCatalog {
  return {
    mode: "preview",
    depositRequired: false,
    dispatchMode: "local-preview-only",
    notice: "Preview mode uses synthetic credits only. It does not accept deposits, charge users, crack credentials, or dispatch work to external miners.",
    tasks: TASK_ORDER_TASKS,
  };
}

export function quoteTaskOrder(input: TaskOrderQuoteInput): TaskOrderQuote {
  const task = TASK_ORDER_TASKS.find((candidate) => candidate.id === input.taskId);
  if (!task) throw new Error("Unknown task order");

  if (task.status !== "available") {
    return {
      taskId: task.id,
      taskName: task.title,
      status: task.status,
      availabilityReason: task.statusReason,
      hashRate: input.hashRate,
      solvedPercent: input.solvedPercent,
      totalItems: input.totalItems,
      estimatedSolvedItems: 0,
      estimatedSeconds: 0,
      estimatedTime: "not available",
      balanceRequiredCredits: 0,
      depositRequired: false,
      dispatchMode: "local-preview-only",
    };
  }

  const estimatedSolvedItems = Math.floor(input.totalItems * (input.solvedPercent / 100));
  const estimatedSeconds = Math.max(1, Math.ceil(input.totalItems / input.hashRate));
  const balanceRequiredCredits = Math.max(
    1,
    Math.ceil((input.totalItems * task.creditsPerThousand) / 1_000),
  );

  return {
    taskId: task.id,
    taskName: task.title,
    status: task.status,
    availabilityReason: task.statusReason,
    hashRate: input.hashRate,
    solvedPercent: input.solvedPercent,
    totalItems: input.totalItems,
    estimatedSolvedItems,
    estimatedSeconds,
    estimatedTime: formatDuration(estimatedSeconds),
    balanceRequiredCredits,
    depositRequired: false,
    dispatchMode: "local-preview-only",
  };
}

export function queueTaskOrder(taskId: string, pool: MinerPool = minerPool): TaskOrderQueueResult {
  const task = TASK_ORDER_TASKS.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error("Unknown task order");
  if (task.status !== "available") throw new Error(task.statusReason);

  const workload = getWorkload(task.sourceWorkloadId);
  if (!workload || workload.evidencePolicy !== "executor-result-required") {
    throw new Error("Task is not backed by a safe local executor");
  }

  const queued = pool.queueLocalJob(workload.id);
  return {
    taskId: task.id,
    taskName: task.title,
    sourceWorkloadId: workload.id,
    status: "queued",
    activeMiners: queued.activeMiners,
    jobIds: queued.jobIds,
    jobsIssued: queued.jobsIssued,
    dispatchMode: "loopback-local",
    message: queued.activeMiners
      ? `Queued for ${queued.activeMiners} local miner(s); current workers received a fresh job.`
      : "Queued for the local pool; the next loopback worker connection will receive this job.",
  };
}

export function defaultTaskOrderHashRate() {
  return Math.max(1, minerPool.snapshot().hashRate);
}