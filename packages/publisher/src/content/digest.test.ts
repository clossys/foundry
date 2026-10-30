import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { candidateRevisionContent, computeContentDigest } from "./digest.js";
import type { CandidateContent } from "./model.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
describe("portable revision digest compatibility", () => {
  it.each(["", "plain", "é العربية 日本語 😀", "x".repeat(1200)])("preserves Node SHA-256 bytes for %j", name => {
    const content: CandidateContent = { name, brief: { audience: "", goal: "", keyMessage: "", callToAction: "", tone: "", constraints: [], sourceAnswers: [], version: 1 }, links: [], typeSettings: {}, openQuestions: [] };
    const expected = createHash("sha256").update(canonical(candidateRevisionContent(content))).digest("hex");
    expect(computeContentDigest(content)).toBe(expected);
  });
});
