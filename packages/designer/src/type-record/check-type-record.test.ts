import { describe, expect, it } from "vitest";
import { checkTypeRecord } from "./check-type-record.js";

const GOOD_RECORD = {
  schemaVersion: 1,
  displayFace: "Georgia",
  h1MinimumPx: 48,
  measureCapCh: 60,
  monoReservedFor: ["eyebrow", "data"],
};

describe("checkTypeRecord — record shape", () => {
  it("accepts a valid authored record", () => {
    const result = checkTypeRecord(GOOD_RECORD);
    expect(result.state).toBe("satisfied");
    expect(result.findings).toEqual([]);
  });

  it("reports violated when displayFace is missing", () => {
    const { displayFace: _removed, ...rest } = GOOD_RECORD;
    const result = checkTypeRecord(rest);
    expect(result.state).toBe("violated");
    expect(result.findings.some((f) => f.path === "displayFace")).toBe(true);
  });

  it("treats non-object input as indeterminate", () => {
    expect(checkTypeRecord(null).state).toBe("indeterminate");
    expect(checkTypeRecord("ignoreme").state).toBe("indeterminate");
  });

  it("treats wrong schemaVersion as indeterminate", () => {
    const result = checkTypeRecord({ ...GOOD_RECORD, schemaVersion: 2 });
    expect(result.state).toBe("indeterminate");
  });
});

describe("checkTypeRecord — brand CSS alignment", () => {
  const brandOk = {
    "--font-display": 'Georgia, "Times New Roman", serif',
    "--text-display-l": "48px",
  };

  it("passes when brand CSS matches the record", () => {
    const result = checkTypeRecord(GOOD_RECORD, { brandDeclarations: brandOk });
    expect(result.state).toBe("satisfied");
  });

  it("reports violated when displayFace is not reflected in --font-display", () => {
    const result = checkTypeRecord(GOOD_RECORD, {
      brandDeclarations: {
        ...brandOk,
        "--font-display": "Helvetica, sans-serif",
      },
    });
    expect(result.state).toBe("violated");
    expect(result.findings.some((f) => f.rule === "brand-font-display-mismatch")).toBe(true);
  });

  it("reports violated when --text-display-l is below h1MinimumPx", () => {
    const result = checkTypeRecord(GOOD_RECORD, {
      brandDeclarations: {
        ...brandOk,
        "--text-display-l": "32px",
      },
    });
    expect(result.state).toBe("violated");
    expect(result.findings.some((f) => f.rule === "brand-text-display-l-below-minimum")).toBe(true);
  });
});
