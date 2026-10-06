export type WorkloadSeverity = "Critical" | "High" | "Medium" | "Low";
export type WorkloadCategory =
  | "cryptography"
  | "application-security"
  | "network-security"
  | "data-compute"
  | "operations"
  | "blue-team";

export type WorkloadDescriptor = {
  id: string;
  name: string;
  purpose: string;
  severity: WorkloadSeverity;
  category: WorkloadCategory;
  algorithm: string;
  note: string;
  executor: string;
  executionMode: "local-live";
  authorizationBoundary: "loopback-only";
  evidencePolicy: "executor-result-required" | "executor-not-implemented";
};

const local = (
  id: string,
  name: string,
  severity: WorkloadSeverity,
  category: WorkloadCategory,
  algorithm: string,
  note: string,
  executor: string,
): WorkloadDescriptor => ({
  id,
  name,
  purpose: `${name} is evaluated by a bounded local executor.`,
  severity,
  category,
  algorithm,
  note,
  executor,
  executionMode: "local-live",
  authorizationBoundary: "loopback-only",
  evidencePolicy: executor === "legacy" ? "executor-not-implemented" : "executor-result-required",
});

export const WORKLOAD_CATALOG: WorkloadDescriptor[] = [
  local("w-01", "24-word mnemonic derivation fixture", "Critical", "cryptography", "BIP39 / PBKDF2 / secp256k1", "Fresh lab material only; public derivation only; no mnemonic recovery", "mnemonic-fixture"),
  local("w-02", "Remote code execution surface", "Critical", "application-security", "Static sink matching", "Static fixture; no code execution", "legacy"),
  local("w-03", "Secret / credential exposure", "Critical", "application-security", "Entropy + regex scan", "Synthetic fixtures only", "legacy"),
  local("w-04", "Blockchain proof-of-work mining", "High", "cryptography", "Double SHA-256", "Bounded local proof", "legacy"),
  local("w-05", "CAPTCHA / anti-bot proof-of-work", "High", "application-security", "Hash iteration", "Rate-limit simulation only", "legacy"),
  local("w-06", "Password-hash strength benchmark", "High", "cryptography", "KDF cost review", "Synthetic fixture; no password candidates", "legacy"),
  local("w-07", "DNS tunneling", "High", "network-security", "Entropy / stream analysis", "Synthetic query analysis", "legacy"),
  local("w-08", "Injection surfaces", "High", "application-security", "AST / syntax matching", "Static query review", "legacy"),
  local("w-09", "SSRF boundary review", "High", "network-security", "URL parser", "Private-range detection; no outbound request", "legacy"),
  local("w-10", "Unsafe deserialization", "High", "application-security", "Static call-site review", "Payload is never loaded", "legacy"),
  local("w-11", "Cryptographic misuse", "High", "cryptography", "API trace", "Weak primitive detection", "legacy"),
  local("w-12", "Password storage", "Medium", "cryptography", "Salted KDF fixture", "Synthetic password fixture only", "legacy"),
  local("w-13", "AI computation", "Medium", "data-compute", "Matrix multiply", "Small deterministic matrix", "legacy"),
  local("w-14", "File integrity", "Medium", "operations", "SHA-256 digest", "Fixture digest verification", "legacy"),
  local("w-15", "Digital signatures", "Medium", "cryptography", "Ed25519 verify", "Known-message fixture", "legacy"),
  local("w-16", "SSL/TLS validation", "Medium", "network-security", "TLS policy review", "No external host contacted", "legacy"),
  local("w-17", "Key generation", "Medium", "cryptography", "CSPRNG sample", "Entropy health check", "legacy"),
  local("w-18", "DNS / DNSSEC validation", "Medium", "network-security", "Signed record proof", "Controlled loopback resolver", "legacy"),
  local("w-19", "Hashing algorithm benchmark", "Medium", "cryptography", "SHA-256 / SHA-512 / HMAC", "Fixed synthetic input batch", "hash-benchmark"),
  local("w-20", "CPU performance benchmark", "Medium", "data-compute", "Integer vector reduction", "Bounded local loop", "cpu-benchmark"),
  local("w-21", "Parallel batch processing", "Medium", "data-compute", "Chunked SHA-256", "Bounded in-memory batch", "parallel-batch"),
  local("w-22", "Password-policy audit", "High", "application-security", "Policy rule evaluation", "Synthetic policy records only", "policy-audit"),
  local("w-23", "TLS / HTTPS configuration audit", "High", "network-security", "Header and version policy", "Supplied metadata only", "tls-audit"),
  local("w-24", "Dependency and SBOM review", "High", "operations", "Component policy matching", "Synthetic component manifest", "dependency-audit"),
  local("w-25", "Isolated fuzz fixture", "High", "application-security", "Bounded mutation testing", "Pure parser fixture; no process launch", "fuzz-fixture"),
  local("w-26", "Malware sample metadata analysis", "High", "blue-team", "Static indicator matching", "Metadata and strings only; no execution", "malware-metadata"),
  local("w-27", "Randomness and entropy test", "Medium", "cryptography", "Frequency and runs test", "Generated sample only", "entropy-test"),
  local("w-28", "Large-scale checksum generation", "Medium", "operations", "SHA-256 batch digest", "Bounded synthetic dataset", "checksum-batch"),
  local("w-29", "Dataset deduplication", "Medium", "data-compute", "Digest set comparison", "Synthetic records only", "dedup"),
  local("w-30", "Machine-learning inference", "Medium", "data-compute", "Deterministic linear classifier", "User data is not loaded", "ml-inference"),
  local("w-31", "Monte Carlo simulation", "Medium", "data-compute", "Seeded pseudo-random sampling", "Bounded statistical run", "monte-carlo"),
  local("w-32", "Financial risk simulation", "Medium", "data-compute", "Seeded loss distribution", "Synthetic values only", "risk-simulation"),
  local("w-33", "Climate and weather simulation", "Medium", "data-compute", "Bounded cellular model", "Synthetic grid only", "climate-simulation"),
  local("w-34", "Matrix and linear algebra", "Medium", "data-compute", "Blocked matrix multiply", "Deterministic matrices", "matrix-benchmark"),
  local("w-35", "Compression benchmark", "Medium", "data-compute", "Deflate round-trip", "In-memory synthetic payload", "compression"),
  local("w-36", "Database query benchmark", "Medium", "data-compute", "Parameterized in-memory query", "No external database mutation", "query-benchmark"),
  local("w-37", "Automated accessibility audit", "Medium", "application-security", "Static DOM policy", "Synthetic markup fixture", "accessibility"),
  local("w-38", "Synthetic data anonymization", "Medium", "operations", "Deterministic redaction", "Synthetic PII-shaped values only", "anonymization"),
  local("w-39", "Backup integrity verification", "High", "operations", "Manifest digest chain", "In-memory backup manifest", "backup-integrity"),
  local("w-40", "Reproducible-build verification", "Medium", "operations", "Manifest canonicalization", "Synthetic build manifest", "reproducible-build"),
  local("w-41", "Blockchain transaction simulation", "Medium", "cryptography", "Hash-linked test transactions", "Local test data only", "blockchain-simulation"),
  local("w-42", "Wallet and signing-library benchmark", "Medium", "cryptography", "Ed25519 sign / verify", "Test messages only", "signing-benchmark"),
  local("w-43", "Network protocol benchmark", "Medium", "network-security", "Local encode / decode loop", "No remote peer contacted", "protocol-benchmark"),
  local("w-44", "Privacy-preserving computation", "Medium", "cryptography", "Additive secret sharing", "Synthetic values only", "privacy-computation"),
  local("w-45", "Web-application security challenge", "High", "application-security", "Static fixture analysis", "Isolated lab fixture; no exploit execution", "web-challenge"),
  local("w-46", "Simulated SQL-injection detector", "High", "application-security", "Query-shape matching", "Report only; no payload delivery", "sql-detector"),
  local("w-47", "Test-application authentication audit", "High", "application-security", "Control policy evaluation", "Synthetic accounts only", "auth-audit"),
  local("w-48", "Vulnerable API remediation report", "High", "application-security", "Contract boundary review", "Synthetic API contract", "api-remediation"),
  local("w-49", "Challenge binary inspection", "High", "blue-team", "Magic-byte and string scan", "Provided fixture bytes only", "binary-inspection"),
  local("w-50", "Synthetic secret-exposure scan", "High", "blue-team", "Pattern and entropy scan", "Finds indicators; does not recover secrets", "secret-scan"),
  local("w-51", "Phishing-indicator analysis", "High", "blue-team", "URL and language heuristics", "Synthetic message fixture", "phishing-analysis"),
  local("w-52", "Suspicious-login triage", "High", "blue-team", "Event scoring", "Synthetic authentication events", "login-triage"),
  local("w-53", "Cloud-configuration audit", "High", "blue-team", "Policy rule evaluation", "Synthetic configuration only", "cloud-audit"),
  local("w-54", "Sandbox asset manifest audit", "Medium", "network-security", "Local manifest inventory", "No network discovery", "asset-manifest"),
  local("w-55", "Privilege-policy validation", "High", "blue-team", "Role graph analysis", "Synthetic identities and roles", "privilege-policy"),
  local("w-56", "Cryptography challenge", "Medium", "cryptography", "Known-answer verification", "Provided test vectors only", "crypto-challenge"),
  local("w-57", "Simulated data-leak triage", "High", "blue-team", "Log and indicator matching", "Synthetic incident records", "data-leak-triage"),
  local("w-58", "Ransomware sample static analysis", "High", "blue-team", "Metadata and string scan", "No sample execution", "ransomware-analysis"),
  local("w-59", "Capture-the-flag puzzle", "Medium", "blue-team", "Bounded local puzzle", "Synthetic challenge state", "ctf-puzzle"),
  local("w-60", "Endpoint-alert triage", "High", "blue-team", "Event correlation", "Synthetic endpoint telemetry", "endpoint-triage"),
  local("w-61", "SIEM detection-rule validation", "High", "blue-team", "Rule replay", "Synthetic event stream", "siem-rule"),
  local("w-62", "Synthetic threat hunting", "High", "blue-team", "IOC and timeline matching", "Synthetic telemetry only", "threat-hunting"),
  local("w-63", "Firewall-flow review", "Medium", "network-security", "Flow policy matching", "Synthetic network flows", "firewall-review"),
  local("w-64", "Patch-priority review", "Medium", "operations", "Risk-weighted ranking", "Synthetic asset inventory", "patch-priority"),
  local("w-65", "Incident-response playbook drill", "Medium", "blue-team", "State-machine replay", "Synthetic incident only", "ir-playbook"),
  local("w-66", "Cloud audit-log review", "Medium", "blue-team", "Event classification", "Synthetic audit events", "cloud-logs"),
  local("w-67", "Backup restoration drill", "High", "operations", "Manifest round-trip", "In-memory backup fixture", "backup-restore"),
  local("w-68", "Detection and response timing", "Medium", "blue-team", "Synthetic timeline metrics", "No real incident data", "response-timing"),
  local("w-69", "Public-key recovery limits", "Critical", "cryptography", "Public-key parser / algorithm validation", "Supplied public-key artifact only; no private-key recovery", "public-key-validator"),
];

export function getWorkload(workloadId: string) {
  return WORKLOAD_CATALOG.find((workload) => workload.id === workloadId);
}
