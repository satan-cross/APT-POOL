import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { runMnemonicFixture } from "./mnemonic-fixture";

describe("BIP39 mnemonic fixture", () => {
  for (const wordCount of [12, 24] as const) {
    it(`generates and returns a valid ${wordCount}-word phrase`, () => {
      const result = runMnemonicFixture(wordCount);
      const words = result.mnemonic.trim().split(/\s+/);

      assert.equal(words.length, wordCount);
      assert.equal(validateMnemonic(result.mnemonic, wordlist), true);
      assert.match(result.answer, new RegExp(`${wordCount}-word BIP39 mnemonic`));
      assert.ok(result.details.some(({ label, value }) =>
        label === "PBKDF2 derivation" && value.includes("64-byte seed"),
      ));
      assert.ok(result.details.some(({ label, value }) =>
        label === "secp256k1 public key" && value.length === 66,
      ));
      assert.equal(result.details.some(({ value }) => value.includes(result.mnemonic)), false);
      assert.equal(result.evidence.some((item) => item.includes(result.mnemonic)), false);
    });
  }
});
