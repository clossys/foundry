import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeCopyFingerprint } from "./fingerprint.js";
import { canonicalJson, digestOfValidPlan } from "./plan-digest.js";
import { sha256 } from "./sha256.js";

const nodeHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("platform-neutral SHA-256 byte compatibility", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"],
    ["a".repeat(1_000_000), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"],
  ])("matches a published SHA-256 vector (%#)", (text, digest) => {
    expect(sha256(text)).toBe(digest);
  });

  it("preserves Node UTF-8 encoding for Unicode, lone surrogates and padding boundaries", () => {
    const texts = ["مرحبا", "こんにちは", "é", "e\u0301", "😀", "\ud800", "\udfff", "a\ud800b\udfff", "\ud800\ud800\udc00", "\0\r\n"];
    for (const length of [1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 4096]) {
      texts.push("a".repeat(length), "😀é".repeat(length));
    }
    for (const text of texts) {
      expect(sha256(text)).toBe(nodeHash(text));
      expect(computeCopyFingerprint(text)).toBe(nodeHash(text));
    }
  });

  it("hashes exactly the unchanged canonical plan bytes and excluded fields", () => {
    const subject = { unicode: ["😀", "e\u0301", "مرحبا"], z: -0, a: { b: 1e30, a: "\0\n" } };
    const expected = `sha256:${nodeHash(canonicalJson(subject))}`;
    expect(digestOfValidPlan({ ...subject, asOf: "ignored", decisions: ["ignored"] })).toBe(expected);
    expect(() => canonicalJson({ text: "\ud800" })).toThrow(/lone surrogate/);
  });
});
