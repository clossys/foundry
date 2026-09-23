import { describe, expect, it } from "vitest";
import { buildCheckOutputEnvelope, envelopeToExitCode } from "./envelope.js";

describe("buildCheckOutputEnvelope", () => {
  it("builds a satisfied envelope with no findings", () => {
    const envelope = buildCheckOutputEnvelope({
      package: "@clossys/controller",
      version: "0.9.16",
      verdict: "satisfied",
      summary: "Every record is current.",
    });
    expect(envelope).toEqual({
      package: "@clossys/controller",
      version: "0.9.16",
      verdict: "satisfied",
      summary: "Every record is current.",
      findings: [],
    });
  });

  it("throws when verdict is not satisfied and findings is empty", () => {
    expect(() =>
      buildCheckOutputEnvelope({ package: "@clossys/controller", version: "0.9.16", verdict: "violated", summary: "x" }),
    ).toThrow(/requires at least one finding/);
  });

  it("throws on an empty summary", () => {
    expect(() =>
      buildCheckOutputEnvelope({ package: "@clossys/controller", version: "0.9.16", verdict: "satisfied", summary: "   " }),
    ).toThrow(/summary is required/);
  });

  it("carries optional metric and nextAction only when supplied", () => {
    const withExtras = buildCheckOutputEnvelope({
      package: "@clossys/controller",
      version: "0.9.16",
      verdict: "indeterminate",
      summary: "One record could not be classified.",
      findings: [{ rule: "record-indeterminate", severity: "error", message: "bad record", path: "clossys/x.json" }],
      metric: { name: "current-records", value: 3, direction: "increase" },
      nextAction: "Add the missing migration step.",
    });
    expect(withExtras.metric).toEqual({ name: "current-records", value: 3, direction: "increase" });
    expect(withExtras.nextAction).toBe("Add the missing migration step.");

    const withoutExtras = buildCheckOutputEnvelope({
      package: "@clossys/controller",
      version: "0.9.16",
      verdict: "satisfied",
      summary: "clean",
    });
    expect("metric" in withoutExtras).toBe(false);
    expect("nextAction" in withoutExtras).toBe(false);
  });

  it("is frozen and defensively copies findings", () => {
    const findings = [{ rule: "r", severity: "error" as const, message: "m" }];
    const envelope = buildCheckOutputEnvelope({ package: "p", version: "1.0.0", verdict: "violated", summary: "s", findings });
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.findings)).toBe(true);
    expect(envelope.findings).not.toBe(findings);
  });
});

describe("envelopeToExitCode", () => {
  it("maps every verdict to the 0/1/2 exit-code convention", () => {
    const base = { package: "p", version: "1.0.0", findings: [] as const };
    expect(envelopeToExitCode({ ...base, verdict: "satisfied", summary: "s" })).toBe(0);
    expect(envelopeToExitCode({ ...base, verdict: "violated", summary: "s", findings: [{ rule: "r", severity: "error", message: "m" }] })).toBe(1);
    expect(envelopeToExitCode({ ...base, verdict: "indeterminate", summary: "s", findings: [{ rule: "r", severity: "error", message: "m" }] })).toBe(2);
  });
});
