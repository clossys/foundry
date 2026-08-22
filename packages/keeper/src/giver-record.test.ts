/** The independent retained-grounds JSON seam — behavior and dependency boundary. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GIVER_RETAINED_GROUNDS_SCHEMA_VERSION, validateGiverRetainedGroundsDocument } from "./giver-record.js";

const AT = "2026-08-22T12:00:00.000Z";
const document = { schemaVersion: 1, producedAt: AT, grounds: [{ groundId: "ground_1", subjectId: "sub_1", retainedAt: AT }] };

describe("giver retained-grounds document seam", () => {
  it("reads the agreed JSON shape and rejects an unknown version or a ground without its person", () => {
    expect(validateGiverRetainedGroundsDocument(document)).toMatchObject({ ok: true, value: document });
    expect(validateGiverRetainedGroundsDocument({ ...document, schemaVersion: 2 }).ok).toBe(false);
    expect(validateGiverRetainedGroundsDocument({ ...document, grounds: [{ groundId: "ground_1", retainedAt: AT }] }).ok).toBe(false);
    expect(GIVER_RETAINED_GROUNDS_SCHEMA_VERSION).toBe(1);
  });

  it("does not import giver: the seam is JSON and an independently declared shape", () => {
    const source = readFileSync(fileURLToPath(new URL("./giver-record.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/from\s+["']@vespeneventures\/giver(?:\/|["'])/);
  });
});
