import {
  createHash,
  createPublicKey,
  ECDH,
  type KeyObject,
} from "node:crypto";

type Detail = { label: string; value: string };

export type PublicKeyValidationResult = {
  answer: string;
  details: Detail[];
  evidence: string[];
  artifactDigest: string;
  boundedPartition: string;
};

type DerNode = {
  tag: number;
  value: Buffer;
  end: number;
};

type DecodedArtifact = {
  encoding: "PEM" | "DER (hex)" | "DER (base64)";
  der: Buffer;
};

type ParsedSubjectPublicKeyInfo = {
  algorithmOid: string;
  algorithmParameters?: DerNode;
  subjectPublicKey: Buffer;
  curveOid?: string;
  rsaModulusBits?: number;
  rsaExponent?: bigint;
};

const MAX_ARTIFACT_BYTES = 16_384;
const BOUNDED_PARTITION = "public-key-parser:16KiB:max-one-key";
const RSA_MINIMUM_BITS = 2_048;

const OIDS = {
  rsaEncryption: "1.2.840.113549.1.1.1",
  ecPublicKey: "1.2.840.10045.2.1",
  secp256k1: "1.3.132.0.10",
  prime256v1: "1.2.840.10045.3.1.7",
  ed25519: "1.3.101.112",
  ed448: "1.3.101.113",
} as const;

const CURVE_NAMES: Record<string, string> = {
  [OIDS.secp256k1]: "secp256k1",
  [OIDS.prime256v1]: "prime256v1",
  "1.3.132.0.1": "sect163k1",
  "1.3.132.0.33": "secp224r1",
  "1.3.132.0.34": "secp384r1",
  "1.3.132.0.35": "secp521r1",
};

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const detail = (label: string, value: string): Detail => ({ label, value });

function fail(message: string): never {
  throw new Error(message);
}

function readDerNode(bytes: Uint8Array, offset: number): DerNode {
  if (offset >= bytes.length) fail("DER value is truncated");

  const tag = bytes[offset++];
  // High-tag-number forms are not needed by SPKI and accepting them would
  // make the parser unnecessarily permissive.
  if ((tag & 0x1f) === 0x1f) fail("DER high-tag-number form is not accepted");
  if (offset >= bytes.length) fail("DER length is missing");

  const firstLengthByte = bytes[offset++];
  let length: number;
  if (firstLengthByte < 0x80) {
    length = firstLengthByte;
  } else {
    const lengthBytes = firstLengthByte & 0x7f;
    if (lengthBytes === 0) fail("DER indefinite length is not accepted");
    if (lengthBytes > 4 || offset + lengthBytes > bytes.length) fail("DER length is invalid");
    if (bytes[offset] === 0) fail("DER length is not minimally encoded");
    length = 0;
    for (let index = 0; index < lengthBytes; index += 1) {
      length = length * 256 + bytes[offset++];
    }
    if (length < 0x80) fail("DER length is not minimally encoded");
  }

  const end = offset + length;
  if (end > bytes.length) fail("DER value is truncated");
  return { tag, value: Buffer.from(bytes.subarray(offset, end)), end };
}

function parseSingleDer(bytes: Buffer): DerNode {
  const node = readDerNode(bytes, 0);
  if (node.end !== bytes.length) fail("DER trailing bytes are not accepted");
  return node;
}

function childNodes(node: DerNode): DerNode[] {
  const children: DerNode[] = [];
  let offset = 0;
  while (offset < node.value.length) {
    const child = readDerNode(node.value, offset);
    children.push(child);
    offset = child.end;
  }
  if (offset !== node.value.length) fail("DER child values are truncated");
  return children;
}

function requireTag(node: DerNode, tag: number, label: string): void {
  if (node.tag !== tag) fail(`${label} has an unexpected DER tag`);
}

function parseOid(node: DerNode): string {
  requireTag(node, 0x06, "OID");
  if (node.value.length === 0) fail("OID is empty");

  const arcs: string[] = [];
  let offset = 0;
  const readArc = () => {
    if (offset >= node.value.length) fail("OID arc is truncated");
    const arcStart = offset;
    let value = 0n;
    let byte: number;
    do {
      byte = node.value[offset++];
      if (offset === arcStart + 1 && byte === 0x80) fail("OID arc is not minimally encoded");
      value = (value << 7n) | BigInt(byte & 0x7f);
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("OID arc is too large");
      if (offset > node.value.length) fail("OID arc is truncated");
    } while ((byte & 0x80) !== 0);
    return Number(value);
  };

  const firstArc = readArc();
  if (firstArc < 40) {
    arcs.push("0", String(firstArc));
  } else if (firstArc < 80) {
    arcs.push("1", String(firstArc - 40));
  } else {
    arcs.push("2", String(firstArc - 80));
  }
  while (offset < node.value.length) arcs.push(String(readArc()));
  return arcs.join(".");
}

function parseInteger(node: DerNode, label: string): Buffer {
  requireTag(node, 0x02, label);
  if (node.value.length === 0) fail(`${label} is empty`);
  // SPKI integers used here must be non-negative and minimally encoded DER.
  if (node.value[0] & 0x80) fail(`${label} is negative`);
  if (
    node.value.length > 1
    && node.value[0] === 0
    && (node.value[1] & 0x80) === 0
  ) {
    fail(`${label} is not minimally encoded`);
  }
  return node.value;
}

function parseBitString(node: DerNode): Buffer {
  requireTag(node, 0x03, "subjectPublicKey");
  if (node.value.length === 0 || node.value[0] !== 0) {
    fail("subjectPublicKey must have zero unused bits");
  }
  return node.value.subarray(1);
}

function parseRsaPublicKey(subjectPublicKey: Buffer): {
  modulusBits: number;
  exponent: bigint;
} {
  const rsa = parseSingleDer(subjectPublicKey);
  requireTag(rsa, 0x30, "RSAPublicKey");
  const members = childNodes(rsa);
  if (members.length !== 2) fail("RSAPublicKey must contain two integers");

  const modulus = parseInteger(members[0], "RSA modulus");
  const exponentBytes = parseInteger(members[1], "RSA public exponent");
  const unsignedModulus = modulus[0] === 0 ? modulus.subarray(1) : modulus;
  if (unsignedModulus.length === 0 || (unsignedModulus[unsignedModulus.length - 1] & 1) === 0) {
    fail("RSA modulus must be a positive odd integer");
  }
  const firstModulusByte = unsignedModulus[0];
  const firstBit = 32 - Math.clz32(firstModulusByte);
  const modulusBits = (unsignedModulus.length - 1) * 8 + firstBit;

  if (exponentBytes.length > 9) fail("RSA public exponent is too large");
  let exponent = 0n;
  for (const byte of exponentBytes) exponent = (exponent << 8n) | BigInt(byte);
  if (exponent < 3n || (exponent & 1n) === 0n) {
    fail("RSA public exponent is not a valid odd exponent");
  }
  if (exponent >= (BigInt("0x" + unsignedModulus.toString("hex")))) {
    fail("RSA public exponent is not smaller than the modulus");
  }
  return { modulusBits, exponent };
}

function parseSubjectPublicKeyInfo(der: Buffer): ParsedSubjectPublicKeyInfo {
  const spki = parseSingleDer(der);
  requireTag(spki, 0x30, "SubjectPublicKeyInfo");
  const members = childNodes(spki);
  if (members.length !== 2) fail("SubjectPublicKeyInfo must contain two members");

  requireTag(members[0], 0x30, "AlgorithmIdentifier");
  const algorithmMembers = childNodes(members[0]);
  if (algorithmMembers.length < 1 || algorithmMembers.length > 2) {
    fail("AlgorithmIdentifier has an invalid number of members");
  }
  const algorithmOid = parseOid(algorithmMembers[0]);
  const algorithmParameters = algorithmMembers[1];
  const subjectPublicKey = parseBitString(members[1]);
  const parsed: ParsedSubjectPublicKeyInfo = {
    algorithmOid,
    algorithmParameters,
    subjectPublicKey,
  };

  if (algorithmOid === OIDS.rsaEncryption) {
    if (!algorithmParameters || algorithmParameters.tag !== 0x05 || algorithmParameters.value.length !== 0) {
      fail("RSA AlgorithmIdentifier must contain NULL parameters");
    }
    const rsa = parseRsaPublicKey(subjectPublicKey);
    parsed.rsaModulusBits = rsa.modulusBits;
    parsed.rsaExponent = rsa.exponent;
  } else if (algorithmOid === OIDS.ecPublicKey) {
    if (!algorithmParameters) fail("EC AlgorithmIdentifier must contain named-curve parameters");
    parsed.curveOid = parseOid(algorithmParameters);
    if (subjectPublicKey.length === 0) fail("EC public point is empty");
  } else if (algorithmOid === OIDS.ed25519 || algorithmOid === OIDS.ed448) {
    // RFC 8410 requires absent parameters for the Edwards public-key OIDs.
    if (algorithmParameters) fail("Edwards AlgorithmIdentifier parameters must be absent");
    const expectedLength = algorithmOid === OIDS.ed25519 ? 32 : 57;
    if (subjectPublicKey.length !== expectedLength) {
      fail("Edwards public key has an invalid length");
    }
  }

  return parsed;
}

function decodeBase64(value: string): Buffer {
  if (
    value.length === 0
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    fail("base64 DER must use strict padded encoding");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== value) {
    fail("base64 DER is not canonical");
  }
  return decoded;
}

function decodeArtifact(artifact: string): DecodedArtifact {
  const trimmed = artifact.trim();
  if (trimmed.startsWith("-----BEGIN ")) {
    const match = /^-----BEGIN PUBLIC KEY-----\r?\n([\s\S]*?)\r?\n-----END PUBLIC KEY-----$/.exec(trimmed);
    if (!match) fail("only one PUBLIC KEY PEM block is accepted");
    const lines = match[1].split(/\r?\n/);
    if (
      lines.length === 0
      || lines.some((line) => line.length === 0 || line.length > 64 || !/^[A-Za-z0-9+/=]+$/.test(line))
    ) {
      fail("PEM body is not strict base64");
    }
    return { encoding: "PEM", der: decodeBase64(lines.join("")) };
  }
  if (/^[0-9a-f]+$/i.test(trimmed)) {
    if (trimmed.length % 2 !== 0) fail("DER hex must contain complete bytes");
    const der = Buffer.from(trimmed, "hex");
    if (der.length === 0) fail("DER hex is empty");
    return { encoding: "DER (hex)", der };
  }
  return { encoding: "DER (base64)", der: decodeBase64(trimmed) };
}

function curveName(curveOid: string | undefined): string {
  if (!curveOid) return "not applicable";
  return CURVE_NAMES[curveOid] ?? `OID ${curveOid}`;
}

function keyAlgorithm(
  key: KeyObject,
  parsed: ParsedSubjectPublicKeyInfo,
): { keyType: string; algorithm: string; curve: string } {
  const keyType = key.asymmetricKeyType ?? "unknown";
  const curve = keyType === "ec" ? curveName(parsed.curveOid) : "not applicable";
  if (keyType === "ec") return { keyType, algorithm: `EC / ${curve}`, curve };
  if (keyType === "rsa") {
    const bits = key.asymmetricKeyDetails && "modulusLength" in key.asymmetricKeyDetails
      ? key.asymmetricKeyDetails.modulusLength
      : parsed.rsaModulusBits;
    return {
      keyType,
      algorithm: `RSA / ${bits ? `${bits}-bit` : "modulus length unavailable"}`,
      curve,
    };
  }
  if (keyType === "ed25519") return { keyType, algorithm: keyType, curve };
  if (keyType === "ed448") return { keyType, algorithm: keyType, curve };
  return {
    keyType,
    algorithm: `OID ${parsed.algorithmOid}`,
    curve,
  };
}

function validateEcPoint(parsed: ParsedSubjectPublicKeyInfo, curve: string): void {
  if (curve !== "secp256k1" && curve !== "prime256v1") return;
  // convertKey performs the curve equation/range validation for the encoded
  // point. The result is intentionally discarded; no key material is retained.
  ECDH.convertKey(parsed.subjectPublicKey, curve, undefined, undefined, "uncompressed");
}

function failure(
  artifactDigest: string,
  encoding: string,
  parserEvidence: string,
): PublicKeyValidationResult {
  return {
    answer: "Public-key artifact failed cryptographic parsing; private-key recovery was not attempted",
    details: [
      detail("Artifact SHA-256", artifactDigest),
      detail("Encoding", encoding),
      detail("Key type", "unknown"),
      detail("Algorithm", "unknown"),
      detail("Curve", "unknown"),
      detail("Parser validation", "failed"),
      detail("Recovery conclusion", "Private-key recovery is not performed"),
    ],
    evidence: [
      `artifact_sha256=${artifactDigest}`,
      parserEvidence,
      "private_key_recovery=not_performed",
    ],
    artifactDigest,
    boundedPartition: BOUNDED_PARTITION,
  };
}

export function runPublicKeyValidation(artifact: string | undefined): PublicKeyValidationResult {
  if (!artifact?.trim()) {
    throw new Error("A supplied public-key artifact is required");
  }
  const artifactBytes = Buffer.from(artifact, "utf8");
  if (artifactBytes.length > MAX_ARTIFACT_BYTES) {
    throw new Error("Public-key artifact exceeds the 16 KiB validation bound");
  }
  const artifactDigest = digest(artifactBytes);

  let decoded: DecodedArtifact;
  try {
    decoded = decodeArtifact(artifact);
  } catch {
    return failure(artifactDigest, "unrecognized", "parser=validation-failed");
  }

  let parsed: ParsedSubjectPublicKeyInfo;
  let key: KeyObject;
  let mathematicalValidationAttempted = false;
  try {
    parsed = parseSubjectPublicKeyInfo(decoded.der);
    if (parsed.algorithmOid === OIDS.ecPublicKey) {
      const parsedCurve = curveName(parsed.curveOid);
      if (parsedCurve === "secp256k1" || parsedCurve === "prime256v1") {
        mathematicalValidationAttempted = true;
        validateEcPoint(parsed, parsedCurve);
      }
    }
    // Supplying an explicitly typed DER SPKI object prevents Node from
    // interpreting private-key containers or deriving a public key from one.
    key = createPublicKey({ key: decoded.der, format: "der", type: "spki" });
  } catch {
    return failure(
      artifactDigest,
      decoded.encoding,
      mathematicalValidationAttempted ? "parser=mathematical-validation-failed" : "parser=validation-failed",
    );
  }

  const { keyType, algorithm, curve } = keyAlgorithm(key, parsed);
  let parserValidation = "valid but unsupported algorithm";
  let validationScope = "SPKI structure and cryptographic container parsed";
  let supported = false;
  let weakRsa = false;
  try {
    if (keyType === "ec") {
      supported = curve === "secp256k1" || curve === "prime256v1";
      parserValidation = supported ? "valid and supported" : "valid but unsupported curve";
      validationScope = supported
        ? "SPKI structure and EC point validated with ECDH.convertKey"
        : "SPKI structure parsed; EC point was not independently validated for this unsupported curve";
    } else if (keyType === "rsa") {
      const modulusBits = parsed.rsaModulusBits ?? 0;
      supported = true;
      weakRsa = modulusBits < RSA_MINIMUM_BITS;
      parserValidation = weakRsa
        ? `valid but weak RSA parameters (${modulusBits}-bit modulus; ${RSA_MINIMUM_BITS}-bit policy minimum)`
        : "valid and supported";
      validationScope = "SPKI structure, RSA integer shape, odd modulus, and exponent sanity checked; primality and security strength were not proven";
    } else if (keyType === "ed25519") {
      supported = true;
      parserValidation = "valid and supported";
      validationScope = "SPKI structure and Ed25519 key length checked; independent point-equation validation is not claimed";
    }
  } catch {
    return failure(artifactDigest, decoded.encoding, "parser=mathematical-validation-failed");
  }

  let exported: string | Buffer;
  try {
    exported = key.export({ format: "der", type: "spki" });
  } catch {
    return failure(artifactDigest, decoded.encoding, "parser=validation-failed");
  }
  const fingerprint = digest(exported);
  const recoveryConclusion = keyType === "rsa"
    ? "General secure correctly generated RSA public-key cryptography does not reveal the private key; this assessment checked only structure and size and does not establish this RSA key's security or recoverability"
    : supported
      ? "Secure public-key cryptography does not reveal the private key; recovery is not feasible from this artifact alone"
      : "Private-key recovery is not attempted for unsupported algorithms";
  const answer = keyType === "rsa"
    ? weakRsa
      ? `RSA public key parsed structurally, but its modulus is below the ${RSA_MINIMUM_BITS}-bit size policy; security and recoverability are not established`
      : "RSA public key parsed; structure and size checks passed, but this artifact's security and recoverability are not established"
    : supported
      ? "Public key parsed and validated; private-key recovery is not feasible"
      : "Public key parsed, but the algorithm is unsupported by this validator";
  const validationEvidence = weakRsa
    ? "validation=valid_but_weak"
    : `validation=${parserValidation}`;

  return {
    answer,
    details: [
      detail("Artifact SHA-256", artifactDigest),
      detail("Encoding", decoded.encoding),
      detail("Key type", keyType),
      detail("Algorithm", algorithm),
      detail("Curve", curve),
      detail("Parser validation", parserValidation),
      detail("Validation scope", validationScope),
      detail("Public-key fingerprint", fingerprint),
      detail("Recovery conclusion", recoveryConclusion),
    ],
    evidence: [
      `artifact_sha256=${artifactDigest}`,
      `public_key_fingerprint=${fingerprint}`,
      "parser=validated",
      `algorithm=${algorithm}`,
      validationEvidence,
      "private_key_recovery=not_performed",
    ],
    artifactDigest,
    boundedPartition: BOUNDED_PARTITION,
  };
}