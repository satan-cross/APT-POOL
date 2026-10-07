import { createECDH, createHash, createHmac, randomBytes } from "node:crypto";
import { entropyToMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

export type MnemonicFixtureResult = {
  answer: string;
  mnemonic: string;
  details: Array<{ label: string; value: string }>;
  evidence: string[];
};
export type MnemonicWordCount = 12 | 24;

const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

const detail = (label: string, value: string) => ({ label, value });

/**
 * Generate fresh lab-only BIP39 material and derive a public secp256k1 key.
 * The generated mnemonic is returned for the immediate demo response; the
 * entropy, BIP39 seed, and private derivation material are discarded.
 */
export function runMnemonicFixture(wordCount: MnemonicWordCount = 24): MnemonicFixtureResult {
  const entropy = randomBytes(wordCount === 24 ? 32 : 16);
  const mnemonic = entropyToMnemonic(entropy, wordlist);
  const mnemonicValid = validateMnemonic(mnemonic, wordlist);
  const mnemonicWordCount = mnemonic.trim().split(/\s+/).length;
  const seed = Buffer.from(mnemonicToSeedSync(mnemonic, "ARGUS-LAB"));
  const master = createHmac("sha512", "Bitcoin seed").update(seed).digest();
  const ecdh = createECDH("secp256k1");
  ecdh.setPrivateKey(master.subarray(0, 32));
  const publicKey = ecdh.getPublicKey("hex", "compressed");
  const publicKeyFingerprint = hash(publicKey).slice(0, 16);
  const verified =
    wordCount === mnemonicWordCount &&
    mnemonicValid &&
    seed.length === 64 &&
    publicKey.length === 66;

  // Do not retain seed or private derivation material in the result.
  entropy.fill(0);
  seed.fill(0);
  master.fill(0);

  return {
    answer: verified
      ? `Fresh ${mnemonicWordCount}-word BIP39 mnemonic and public secp256k1 derivation verified`
      : "Mnemonic derivation fixture failed validation",
    mnemonic,
    details: [
      detail(
        "Fixture",
        `Fresh ${wordCount === 24 ? 256 : 128}-bit local entropy; ${mnemonicWordCount}-word BIP39 mnemonic`,
      ),
      detail("Mnemonic length", `${mnemonicWordCount} words`),
      detail("Mnemonic checksum", mnemonicValid ? "valid" : "invalid"),
      detail("PBKDF2 derivation", "HMAC-SHA512 / 2,048 rounds / 64-byte seed"),
      detail("Derived key", "secp256k1 public key generated; private scalar discarded"),
      detail("secp256k1 public key", publicKey),
      detail("Public-key fingerprint", publicKeyFingerprint),
      detail(
        "Seed recovery",
        "No existing wallet seed is tested or recovered. The generated phrase is shown only in this response.",
      ),
    ],
    evidence: [
      `mnemonic_words=${mnemonicWordCount}`,
      `mnemonic_checksum=${mnemonicValid ? "valid" : "invalid"}`,
      `public_key_fingerprint=${publicKeyFingerprint}`,
      "mnemonic_recovery=not_performed",
    ],
  };
}