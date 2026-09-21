import { describe, expect, it } from "vitest";
import { checkTypeRecord, parseTypeRecord } from "./check-type-record.js";

const green = {
  schemaVersion: 1,
  displayFace: "Display Sans",
  h1Minimum: "56px",
  measureCap: "48rem",
  monoReservedFor: ["eyebrow", "data", "code"],
  wrap: { orphanWords: "forbid-single" },
};

describe("parseTypeRecord", () => {
  it("accepts a valid record object", () => {
    expect(parseTypeRecord(green).ok).toBe(true);
  });

  it("rejects a non-object root", () => {
    const result = parseTypeRecord(null);
    expect(result.ok).toBe(false);
  });

  it("rejects wrong types on present fields", () => {
    const result = parseTypeRecord({ ...green, schemaVersion: "1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("invalid-type");
  });
});

describe("checkTypeRecord", () => {
  it("returns no findings for a green fixture", () => {
    const parsed = parseTypeRecord(green);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(checkTypeRecord(parsed.raw)).toEqual([]);
  });

  it("flags missing displayFace", () => {
    const { displayFace: _removed, ...rest } = green;
    const parsed = parseTypeRecord(rest);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(checkTypeRecord(parsed.raw).some((f) => f.message.includes("displayFace"))).toBe(true);
  });

  it("flags invalid monoReservedFor entry", () => {
    const parsed = parseTypeRecord({ ...green, monoReservedFor: ["body"] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(checkTypeRecord(parsed.raw).some((f) => f.rule === "type:mono-reserved-invalid")).toBe(true);
  });

  it("flags placeholder displayFace", () => {
    const parsed = parseTypeRecord({ ...green, displayFace: "REPLACE_ME" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(checkTypeRecord(parsed.raw).some((f) => f.rule === "type:placeholder-value")).toBe(true);
  });
});
