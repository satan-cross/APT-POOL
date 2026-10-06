import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import net from "node:net";
import { after, describe, it } from "node:test";
import { LocalDnsPlane } from "./dns-plane";
import { localSecurityLab } from "./local-security-lab";
import { runSafeWorkload } from "./safe-workload-runner";
import { WORKLOAD_CATALOG } from "./workload-catalog";

function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(value.length), value]);
}

function derInteger(value: Buffer): Buffer {
  const unsigned = value[0] & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value;
  return der(0x02, unsigned);
}

function compositeRsaSpki(): { der: Buffer; modulus: bigint } {
  let modulus = (1n << 2047n) + 1n;
  while (modulus % 3n !== 0n) modulus += 2n;
  const modulusBytes = Buffer.alloc(256);
  let remaining = modulus;
  for (let index = modulusBytes.length - 1; index >= 0; index -= 1) {
    modulusBytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  const rsaOid = Buffer.from("06092a864886f70d010101", "hex");
  const algorithm = der(0x30, Buffer.concat([rsaOid, Buffer.from("0500", "hex")]));
  const rsaPublicKey = der(0x30, Buffer.concat([
    derInteger(modulusBytes),
    derInteger(Buffer.from("010001", "hex")),
  ]));
  const subjectPublicKey = der(0x03, Buffer.concat([Buffer.from([0]), rsaPublicKey]));
  return { modulus, der: der(0x30, Buffer.concat([algorithm, subjectPublicKey])) };
}

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function runWithLocalDnsPlane(
  workload: (typeof WORKLOAD_CATALOG)[number],
  input: { publicKeyArtifact?: string } = {},
) {
  if (workload.executor !== "dns-redirect-fixture") return runSafeWorkload(workload, input);
  const plane = new LocalDnsPlane(await getFreePort());
  plane.start();
  const deadline = Date.now() + 1_000;
  let targetReady = false;
  while (!targetReady && Date.now() < deadline) {
    try {
      await plane.probeResolvedTarget("127.0.0.1");
      targetReady = plane.snapshot().status === "Active & synchronized";
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assert.ok(targetReady, "loopback DNS target should be ready");
  try {
    return await runSafeWorkload(workload, { ...input, dnsPlaneInstance: plane });
  } finally {
    await plane.stop();
  }
}

describe("safe workload catalog", () => {
  after(async () => {
    await localSecurityLab.stop();
  });

  it("has a local executor for every expanded catalog workload", async () => {
    const executable = WORKLOAD_CATALOG.filter((workload) => workload.executor !== "legacy");

    assert.equal(WORKLOAD_CATALOG.length, 70);
    assert.equal(executable.length, WORKLOAD_CATALOG.length);
    for (const workload of executable) {
      const result = await runWithLocalDnsPlane(workload, workload.executor === "public-key-validator"
        ? { publicKeyArtifact: "not-a-public-key" }
        : undefined);
      assert.ok(result.answer, `${workload.id} should return an answer`);
      assert.ok(result.details.length > 0, `${workload.id} should return details`);
      assert.ok(result.evidence.length > 0, `${workload.id} should return evidence`);
      if (workload.executor !== "public-key-validator") {
        assert.ok(result.details.some((item) => item.label === "Live test subject"), `${workload.id} should report its live subject`);
        assert.ok(result.evidence.some((item) => item.startsWith("local_service=http://127.0.0.1:")), `${workload.id} should report its local service`);
      }
      assert.equal(workload.executionMode, "local-live");
      assert.equal(workload.evidencePolicy, "executor-result-required", `${workload.id} should require executor evidence`);
    }
  });

  it("grades the production-shaped local DNS plane without leaving loopback", async () => {
    const workload = WORKLOAD_CATALOG.find((item) => item.executor === "dns-redirect-fixture");
    assert.ok(workload);
    const result = await runWithLocalDnsPlane(workload);

    assert.match(result.answer, /local DNS range test graded A/i);
    assert.ok(result.details.some((item) => item.label === "Checks passed" && item.value === "5 / 5"));
    assert.ok(result.details.some((item) => item.label === "DNS response" && item.value.includes("127.0.0.1")));
    assert.ok(result.details.some((item) => item.label === "Loopback target" && item.value.startsWith("200 ARGUS local redirect target")));
    assert.ok(result.details.some((item) => item.label === "External DNS or traffic" && item.value === "not contacted"));
    assert.ok(result.evidence.includes("external_dns_queries=0"));
    assert.ok(result.evidence.includes("external_redirects=0"));
  });

  it("validates a supplied public key and records a digest without recovering a private key", async () => {
    const workload = WORKLOAD_CATALOG.find((item) => item.executor === "public-key-validator");
    assert.ok(workload);
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
    const artifact = publicKey.export({ type: "spki", format: "pem" }).toString();

    const result = await runSafeWorkload(workload, { publicKeyArtifact: artifact });

    assert.match(result.answer, /private-key recovery is not feasible/i);
    assert.ok(result.artifactDigest);
    assert.equal(result.boundedPartition, "public-key-parser:16KiB:max-one-key");
    assert.ok(result.details.some((item) => item.label === "Key type" && item.value === "ec"));
    assert.ok(result.details.some((item) => item.label === "Curve" && item.value === "secp256k1"));
    assert.ok(result.details.some((item) => item.label === "Parser validation" && item.value === "valid and supported"));
    assert.ok(result.details.some((item) => item.label === "Recovery conclusion" && /does not reveal the private key/i.test(item.value)));
    assert.ok(result.evidence.includes(`artifact_sha256=${result.artifactDigest}`));
    assert.ok(result.evidence.includes("private_key_recovery=not_performed"));
    assert.ok(!result.details.some((item) => item.label === "Live test subject"));
    assert.ok(!result.evidence.some((item) => item.startsWith("local_service=")));
  });

  it("accepts strict DER hex and base64 while rejecting trailing bytes", async () => {
    const workload = WORKLOAD_CATALOG.find((item) => item.executor === "public-key-validator");
    assert.ok(workload);
    const { publicKey } = generateKeyPairSync("ed25519");
    const der = publicKey.export({ type: "spki", format: "der" });

    const hex = await runSafeWorkload(workload, { publicKeyArtifact: der.toString("hex") });
    assert.equal(hex.details.find((item) => item.label === "Encoding")?.value, "DER (hex)");
    assert.equal(hex.details.find((item) => item.label === "Key type")?.value, "ed25519");
    assert.ok(hex.details.some((item) => item.label === "Validation scope" && /point-equation.*not claimed/i.test(item.value)));

    const base64 = await runSafeWorkload(workload, { publicKeyArtifact: der.toString("base64") });
    assert.equal(base64.details.find((item) => item.label === "Encoding")?.value, "DER (base64)");
    assert.equal(base64.details.find((item) => item.label === "Key type")?.value, "ed25519");

    const trailingDer = await runSafeWorkload(workload, { publicKeyArtifact: `${der.toString("hex")}00` });
    assert.equal(trailingDer.details.find((item) => item.label === "Parser validation")?.value, "failed");
    assert.equal(trailingDer.details.find((item) => item.label === "Key type")?.value, "unknown");
    assert.ok(trailingDer.evidence.includes("parser=validation-failed"));
  });

  it("rejects private-key containers and PEM trailing material", async () => {
    const workload = WORKLOAD_CATALOG.find((item) => item.executor === "public-key-validator");
    assert.ok(workload);
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const privateDer = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
    const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

    for (const artifact of [privatePem, privateDer, `${publicPem}trailing`]) {
      const result = await runSafeWorkload(workload, { publicKeyArtifact: artifact });
      assert.match(result.answer, /failed cryptographic parsing/i);
      assert.equal(result.details.find((item) => item.label === "Key type")?.value, "unknown");
      assert.equal(result.details.find((item) => item.label === "Algorithm")?.value, "unknown");
      assert.equal(result.details.find((item) => item.label === "Curve")?.value, "unknown");
      assert.equal(result.details.find((item) => item.label === "Parser validation")?.value, "failed");
      assert.ok(result.evidence.includes("private_key_recovery=not_performed"));
    }
  });

  it("rejects invalid EC points after mathematical curve validation", async () => {
    const workload = WORKLOAD_CATALOG.find((item) => item.executor === "public-key-validator");
    assert.ok(workload);
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
    const invalid = Buffer.from(publicKey.export({ type: "spki", format: "der" }));
    invalid.fill(0, invalid.length - 32);

    const result = await runSafeWorkload(workload, { publicKeyArtifact: invalid.toString("base64") });
    assert.match(result.answer, /failed cryptographic parsing/i);
    assert.equal(result.details.find((item) => item.label === "Key type")?.value, "unknown");
    assert.ok(result.evidence.includes("parser=mathematical-validation-failed"));
  });

  it("reports malformed and unsupported public-key artifacts from the real parser", async () => {
    const workload = WORKLOAD_CATALOG.find((item) => item.executor === "public-key-validator");
    assert.ok(workload);

    const malformed = await runSafeWorkload(workload, { publicKeyArtifact: "AA==" });
    assert.match(malformed.answer, /failed cryptographic parsing/i);
    assert.ok(malformed.evidence.some((item) => item === "parser=validation-failed"));
    assert.ok(malformed.artifactDigest);
    assert.equal(malformed.details.find((item) => item.label === "Key type")?.value, "unknown");
    assert.equal(malformed.details.find((item) => item.label === "Algorithm")?.value, "unknown");
    assert.equal(malformed.details.find((item) => item.label === "Curve")?.value, "unknown");

    const { publicKey } = generateKeyPairSync("ed448");
    const unsupportedArtifact = publicKey.export({ type: "spki", format: "pem" }).toString();
    const unsupported = await runSafeWorkload(workload, { publicKeyArtifact: unsupportedArtifact });
    assert.match(unsupported.answer, /unsupported/i);
    assert.ok(unsupported.details.some((item) => item.label === "Key type" && item.value === "ed448"));
    assert.ok(unsupported.details.some((item) => item.label === "Parser validation" && item.value === "valid but unsupported algorithm"));
    assert.ok(unsupported.evidence.includes("private_key_recovery=not_performed"));
  });

  it("reports weak RSA strength without claiming blanket security", async () => {
    const workload = WORKLOAD_CATALOG.find((item) => item.executor === "public-key-validator");
    assert.ok(workload);
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 1024, publicExponent: 0x10001 });
    const artifact = publicKey.export({ type: "spki", format: "pem" }).toString();

    const result = await runSafeWorkload(workload, { publicKeyArtifact: artifact });

    assert.match(result.answer, /below.*2048|weak/i);
    assert.ok(result.details.some((item) => item.label === "Algorithm" && /1024-bit/i.test(item.value)));
    assert.ok(result.details.some((item) => item.label === "Parser validation" && /weak/i.test(item.value)));
    assert.ok(result.details.some((item) => item.label === "Validation scope" && /primality.*not proven/i.test(item.value)));
    assert.ok(result.details.some((item) => item.label === "Recovery conclusion" && /does not establish.*security.*recoverability/i.test(item.value)));
  });

  it("does not infer RSA recoverability from a large but factored modulus", async () => {
    const workload = WORKLOAD_CATALOG.find((item) => item.executor === "public-key-validator");
    assert.ok(workload);
    const { der: artifact, modulus } = compositeRsaSpki();
    assert.equal(modulus % 3n, 0n);
    assert.equal(modulus % 2n, 1n);

    const result = await runSafeWorkload(workload, { publicKeyArtifact: artifact.toString("base64") });
    const recovery = result.details.find((item) => item.label === "Recovery conclusion")?.value ?? "";

    assert.equal(result.details.find((item) => item.label === "Key type")?.value, "rsa");
    assert.ok(result.details.some((item) => item.label === "Algorithm" && /2048-bit/i.test(item.value)));
    assert.doesNotMatch(result.answer, /private-key recovery is not feasible/i);
    assert.match(result.answer, /security and recoverability are not established/i);
    assert.match(recovery, /correctly generated RSA public-key cryptography does not reveal the private key/i);
    assert.match(recovery, /does not establish this RSA key's security or recoverability/i);
  });

  it("throws generic errors for missing and oversized artifacts", async () => {
    const workload = WORKLOAD_CATALOG.find((item) => item.executor === "public-key-validator");
    assert.ok(workload);
    await assert.rejects(() => runSafeWorkload(workload), /supplied public-key artifact is required/i);
    await assert.rejects(() => runSafeWorkload(workload, { publicKeyArtifact: "x".repeat(16_385) }), /exceeds the 16 KiB validation bound/i);
  });
});