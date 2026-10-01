import { describe, expect, it } from "vitest";
import {
  FRONT_DOOR_COPY_EN,
  FRONT_DOOR_COPY_IDS,
  FRONT_DOOR_NOUNS,
  isFrontDoorCopyId,
  resolveFrontDoorCopy,
} from "./front-door.js";
import type { FrontDoorKey, FrontDoorNouns } from "./front-door.js";
import { checkCopyRecord } from "./checker.js";
import { validateCopyRegistryShape } from "./schema.js";
import type { VoiceRecord } from "./voice/index.js";

// Obviously-fictional fixtures only: "Acme" and the reserved `.test` domain.

const SLOTS = ["title", "description", "label", "primary", "secondary", "notice", "alt"] as const;

const EXPECTED_IDS = [
  "front-door.sign-in.title",
  "front-door.sign-in.description",
  "front-door.sign-in.label",
  "front-door.sign-in.primary",
  "front-door.password.title",
  "front-door.password.description",
  "front-door.password.label",
  "front-door.password.primary",
  "front-door.password.secondary",
  "front-door.identifier-not-found.notice",
] as const;

function tokensIn(text: string): string[] {
  return [...text.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!);
}

function slotOf(id: string): string {
  return id.split(".").at(-1)!;
}

describe("catalog shape", () => {
  it("is a valid registry whose ids are the reserved tuple, in order", () => {
    expect(validateCopyRegistryShape(FRONT_DOOR_COPY_EN)).toEqual([]);
    expect(FRONT_DOOR_COPY_IDS).toEqual(EXPECTED_IDS);
    expect(FRONT_DOOR_COPY_EN.entries.map((entry) => entry.id)).toEqual([...FRONT_DOOR_COPY_IDS]);
    expect(FRONT_DOOR_COPY_EN.entries).toHaveLength(10);
  });

  it("identifies itself as the shipped English revision 1 catalog", () => {
    expect(FRONT_DOOR_COPY_EN.id).toBe("front-door");
    expect(FRONT_DOOR_COPY_EN.locale).toBe("en");
    expect(FRONT_DOOR_COPY_EN.revision).toBe("1");
    expect(FRONT_DOOR_COPY_EN.source).toEqual({ kind: "imported", reference: "@clossys/writer/front-door.en.json" });
  });

  it("gives every entry a listed slot, approved status and a context", () => {
    for (const entry of FRONT_DOOR_COPY_EN.entries) {
      expect(entry.id.startsWith("front-door.")).toBe(true);
      expect(entry.id.split(".")).toHaveLength(3);
      expect(SLOTS).toContain(slotOf(entry.id));
      expect(entry.status).toBe("approved");
      expect(entry.context.trim().length).toBeGreaterThan(0);
    }
  });

  it("declares every {token} as a placeholder and as a closed noun", () => {
    for (const entry of FRONT_DOOR_COPY_EN.entries) {
      const tokens = tokensIn(entry.text);
      expect([...(entry.placeholders ?? [])].sort()).toEqual([...new Set(tokens)].sort());
      for (const token of tokens) expect(FRONT_DOOR_NOUNS).toContain(token);
    }
  });
});

describe("voice", () => {
  const voice: VoiceRecord = {
    id: "front-door-test-voice",
    rules: {
      person: { description: "no pronoun rule", forbiddenPronouns: [] },
      tense: { description: "present tense, no future promises", forbiddenMarkers: ["will"] },
      formality: "neutral",
      tone: ["direct"],
    },
    glossary: ["please", "sorry", "oops", "invalid", "user", "login", "click"].map((term) => ({
      term,
      status: "forbidden" as const,
      reason: "front-door voice",
      caseSensitive: false,
    })),
    claims: [],
  };

  it("has no error finding under the test voice", () => {
    const report = checkCopyRecord(FRONT_DOOR_COPY_EN, voice);
    expect(report.complete).toBe(true);
    expect(report.checkedCount).toBe(10);
    expect(report.findings.filter((finding) => finding.severity === "error")).toEqual([]);
  });

  it("can fail: a forbidden word in a text is an error finding", () => {
    const entries = FRONT_DOOR_COPY_EN.entries.map((entry) =>
      entry.id === "front-door.sign-in.primary" ? { ...entry, text: "Please continue" } : entry,
    );
    const report = checkCopyRecord({ ...FRONT_DOOR_COPY_EN, entries }, voice);
    expect(report.findings.some((finding) => finding.severity === "error" && finding.entryId === "front-door.sign-in.primary")).toBe(true);
  });

  it("uses no exclamation mark and ends sentences only where the slot calls for it", () => {
    for (const entry of FRONT_DOOR_COPY_EN.entries) {
      expect(entry.text).not.toContain("!");
      const endsLikeSentence = /[.?]$/.test(entry.text);
      if (slotOf(entry.id) === "description" || slotOf(entry.id) === "notice") {
        expect(endsLikeSentence, entry.id).toBe(true);
      } else {
        expect(entry.text.endsWith("."), entry.id).toBe(false);
      }
    }
  });
});

describe("isFrontDoorCopyId", () => {
  it("accepts exactly the ten reserved ids", () => {
    for (const id of EXPECTED_IDS) expect(isFrontDoorCopyId(id)).toBe(true);
    expect(isFrontDoorCopyId("front-door.sign-in.heading")).toBe(false);
    expect(isFrontDoorCopyId("sign-in.title")).toBe(false);
    expect(isFrontDoorCopyId(undefined)).toBe(false);
    expect(isFrontDoorCopyId(42)).toBe(false);
  });
});

describe("resolver", () => {
  it("resolves its declared noun and drops the nouns it does not declare", () => {
    const result = resolveFrontDoorCopy("front-door.password.description", { identifier: "ana@example.test", brand: "Acme" });
    expect(result.complete).toBe(true);
    expect(result.text).toBe("Signing in as ana@example.test.");
    expect(result.resolution?.text).toBe("Signing in as ana@example.test.");
    expect(result.resolution?.entryId).toBe("front-door.password.description");
    expect(result.issues).toEqual([]);
  });

  it("resolves every default that needs no noun with an empty noun set", () => {
    expect(resolveFrontDoorCopy("front-door.sign-in.title", {}).text).toBe("Sign in");
    expect(resolveFrontDoorCopy("front-door.password.secondary", {}).text).toBe("Use a different email");
    expect(resolveFrontDoorCopy("front-door.identifier-not-found.notice", {}).text).toBe(
      "We couldn’t find an account for that email. Check it and try again.",
    );
  });

  it("resolves the surface noun", () => {
    expect(resolveFrontDoorCopy("front-door.sign-in.description", { surface: "Acme Console" }).text).toBe("Continue to Acme Console.");
  });

  it("resolves all ten ids when every noun is supplied", () => {
    const nouns: FrontDoorNouns = { brand: "Acme", surface: "Acme Console", identifier: "ana@example.test", digest: "abc123", requestAccessLabel: "Request access" };
    for (const id of FRONT_DOOR_COPY_IDS) {
      const result = resolveFrontDoorCopy(id, nouns);
      expect(result.issues, id).toEqual([]);
      expect(result.complete).toBe(true);
      expect(result.text?.length).toBeGreaterThan(0);
    }
  });

  it("reports missing-noun for an absent or blank noun", () => {
    for (const nouns of [{}, { identifier: "" }, { identifier: "   " }, { identifier: 7 }] as unknown as FrontDoorNouns[]) {
      const result = resolveFrontDoorCopy("front-door.password.description", nouns);
      expect(result.complete).toBe(false);
      expect(result.text).toBeUndefined();
      expect(result.resolution).toBeUndefined();
      expect(result.issues.map((issue) => issue.reason)).toEqual(["missing-noun"]);
      expect(result.issues[0]?.noun).toBe("identifier");
    }
  });

  it("reports unknown-noun for a noun outside the closed set", () => {
    const result = resolveFrontDoorCopy("front-door.sign-in.title", { tenant: "x" } as unknown as FrontDoorNouns);
    expect(result.complete).toBe(false);
    expect(result.issues.map((issue) => issue.reason)).toEqual(["unknown-noun"]);
    expect(result.issues[0]?.noun).toBe("tenant");

    const both = resolveFrontDoorCopy("front-door.password.description", { tenant: "x" } as unknown as FrontDoorNouns);
    expect(both.issues.map((issue) => issue.reason).sort()).toEqual(["missing-noun", "unknown-noun"]);
  });

  it("reports unknown-copy-id for an id outside the catalog", () => {
    const result = resolveFrontDoorCopy("front-door.sign-in.heading" as unknown as FrontDoorKey, {});
    expect(result.complete).toBe(false);
    expect(result.issues.map((issue) => issue.reason)).toEqual(["unknown-copy-id"]);
    expect(result.issues[0]?.id).toBe("front-door.sign-in.heading");
  });

  it("never throws, whatever it is given", () => {
    const hostile = { get identifier(): string { throw new Error("boom"); } };
    const inputs: unknown[] = [undefined, null, 7, "x", [], hostile, Object.create({ identifier: "inherited" })];
    for (const nouns of inputs) {
      expect(() => resolveFrontDoorCopy("front-door.password.description", nouns as FrontDoorNouns)).not.toThrow();
      expect(resolveFrontDoorCopy("front-door.password.description", nouns as FrontDoorNouns).complete).toBe(false);
    }
    for (const key of [undefined, null, 7, {}, "__proto__", "constructor"]) {
      const result = resolveFrontDoorCopy(key as unknown as FrontDoorKey, {});
      expect(result.complete).toBe(false);
      expect(result.issues.map((issue) => issue.reason)).toEqual(["unknown-copy-id"]);
    }
  });

  it("does not modify the nouns it is given", () => {
    const nouns = Object.freeze({ identifier: "ana@example.test", brand: "Acme" });
    expect(resolveFrontDoorCopy("front-door.password.description", nouns).complete).toBe(true);
    expect(nouns).toEqual({ identifier: "ana@example.test", brand: "Acme" });
  });
});
