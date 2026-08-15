import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  COMPOSITION_SCHEMA_VERSION,
  evaluateComposition,
  validateCompositionEvaluationInput,
} from "./index.js";
import type { CompositionEvaluationInput } from "./index.js";

const instant = "2026-08-15T00:00:00.000Z";
const scope = { plane: "machine", id: "member-machine" } as const;

function provenance(id: string) {
  return { source: `source:${id}`, reference: `urn:example:${id}` };
}

function baseInput(): CompositionEvaluationInput {
  return {
    schemaVersion: COMPOSITION_SCHEMA_VERSION,
    evaluatedAt: instant,
    declarations: [
      {
        kind: "requirement",
        id: "requirement.runtime",
        capability: "runtime.javascript",
        scope: { ...scope },
        constraint: { kind: "one-of", values: ["stable", "preview"] },
        provenance: provenance("requirement"),
      },
      {
        kind: "policy",
        id: "policy.runtime",
        capability: "runtime.javascript",
        scope: { ...scope },
        constraint: { kind: "one-of", values: ["stable"] },
        provenance: provenance("policy"),
      },
      {
        kind: "preference",
        id: "preference.runtime",
        capability: "runtime.javascript",
        scope: { ...scope },
        value: "stable",
        provenance: provenance("preference"),
      },
    ],
    supplies: [
      {
        id: "supply.runtime",
        capability: "runtime.javascript",
        scope: { ...scope },
        state: "available",
        values: ["preview", "stable"],
        provenance: provenance("supply"),
      },
    ],
    decisions: [],
    exceptions: [],
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}

describe("evaluateComposition", () => {
  it("selects the sole compatible supplied value and retains complete provenance", () => {
    expect(evaluateComposition(baseInput())).toEqual({
      ok: true,
      status: "effective",
      resolutions: [{
        capability: "runtime.javascript",
        scope,
        status: "effective",
        selectedValue: "stable",
        compatibleValues: ["stable"],
        constraints: [
          {
            declarationId: "policy.runtime",
            kind: "policy",
            status: "satisfied",
            exceptionIds: [],
            provenance: provenance("policy"),
          },
          {
            declarationId: "requirement.runtime",
            kind: "requirement",
            status: "satisfied",
            exceptionIds: [],
            provenance: provenance("requirement"),
          },
        ],
        provenance: [
          { role: "policy", id: "policy.runtime", ...provenance("policy") },
          { role: "preference", id: "preference.runtime", ...provenance("preference") },
          { role: "requirement", id: "requirement.runtime", ...provenance("requirement") },
          { role: "supply", id: "supply.runtime", ...provenance("supply") },
        ],
      }],
      findings: [],
    });
  });

  it("is order-independent across declaration, supply, decision-reference, exception-target, and value permutations", () => {
    const input: CompositionEvaluationInput = {
      ...baseInput(),
      decisions: [{
        id: "decision.runtime",
        capability: "runtime.javascript",
        scope,
        selectedValue: "preview",
        exceptionIds: ["exception.secondary", "exception.primary"],
        provenance: provenance("decision"),
      }],
      exceptions: [
        {
          id: "exception.primary",
          scope,
          targetDeclarationIds: ["policy.runtime", "requirement.runtime"],
          allowedValues: ["preview", "stable"],
          reason: "Temporary compatibility window.",
          reviewBy: "2026-08-20T00:00:00.000Z",
          expiresAt: "2026-09-01T00:00:00.000Z",
          provenance: provenance("exception.primary"),
        },
        {
          id: "exception.secondary",
          scope,
          targetDeclarationIds: ["requirement.runtime"],
          allowedValues: ["stable"],
          reason: "Separate bounded record.",
          reviewBy: "2026-08-20T00:00:00.000Z",
          expiresAt: "2026-09-01T00:00:00.000Z",
          provenance: provenance("exception.secondary"),
        },
      ],
    };
    const permuted: CompositionEvaluationInput = {
      ...input,
      declarations: [...input.declarations].reverse(),
      supplies: [{ ...input.supplies[0]!, values: ["stable", "preview"] }],
      decisions: [{ ...input.decisions[0]!, exceptionIds: ["exception.primary", "exception.secondary"] }],
      exceptions: input.exceptions.map((exception) => ({
        ...exception,
        targetDeclarationIds: [...exception.targetDeclarationIds].reverse(),
        allowedValues: [...exception.allowedValues].reverse(),
      })).reverse(),
    };
    expect(evaluateComposition(permuted)).toEqual(evaluateComposition(input));
  });

  it("never lets order or preference weaken a requirement or policy", () => {
    const input = baseInput();
    const result = evaluateComposition({
      ...input,
      declarations: [
        { ...input.declarations[0]!, constraint: { kind: "one-of", values: ["preview"] } },
        { ...input.declarations[1]!, constraint: { kind: "one-of", values: ["stable"] } },
        { ...input.declarations[2]!, value: "preview" },
      ],
    });
    expect(result.status).toBe("conflicting");
    expect(result.resolutions[0]?.selectedValue).toBeUndefined();
  });

  it("allows only an explicit decision plus an active targeted exception to mediate a hard conflict", () => {
    const input = baseInput();
    const result = evaluateComposition({
      ...input,
      decisions: [{
        id: "decision.runtime",
        capability: "runtime.javascript",
        scope,
        selectedValue: "preview",
        exceptionIds: ["exception.runtime"],
        provenance: provenance("decision"),
      }],
      exceptions: [{
        id: "exception.runtime",
        scope,
        targetDeclarationIds: ["policy.runtime"],
        allowedValues: ["preview"],
        reason: "Temporary compatibility window.",
        reviewBy: "2026-08-20T00:00:00.000Z",
        expiresAt: "2026-09-01T00:00:00.000Z",
        provenance: provenance("exception"),
      }],
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("exception-mediated");
    expect(result.resolutions[0]).toMatchObject({
      status: "exception-mediated",
      selectedValue: "preview",
      constraints: [
        { declarationId: "policy.runtime", status: "excepted", exceptionIds: ["exception.runtime"] },
        { declarationId: "requirement.runtime", status: "satisfied", exceptionIds: [] },
      ],
    });
    expect(result.resolutions[0]?.provenance.map((entry) => entry.role)).toEqual([
      "decision", "exception", "policy", "preference", "requirement", "supply",
    ]);
  });

  it("fails closed when a referenced exception reaches its review or expiry bound", () => {
    const input = baseInput();
    const decision = {
      id: "decision.runtime",
      capability: "runtime.javascript",
      scope,
      selectedValue: "preview",
      exceptionIds: ["exception.runtime"],
      provenance: provenance("decision"),
    } as const;
    const exception = {
      id: "exception.runtime",
      scope,
      targetDeclarationIds: ["policy.runtime"],
      allowedValues: ["preview"],
      reason: "Bounded compatibility window.",
      reviewBy: instant,
      expiresAt: "2026-09-01T00:00:00.000Z",
      provenance: provenance("exception"),
    } as const;
    const result = evaluateComposition({ ...input, decisions: [decision], exceptions: [exception] });
    expect(result.status).toBe("conflicting");
    expect(result.resolutions[0]?.constraints.find((entry) => entry.declarationId === "policy.runtime")?.status).toBe("violated");
  });

  it("requires explicit capability supply even when an operator selected a value", () => {
    const input = baseInput();
    const result = evaluateComposition({
      ...input,
      supplies: [{ ...input.supplies[0]!, state: "available", values: ["stable"] }],
      decisions: [{
        id: "decision.runtime",
        capability: "runtime.javascript",
        scope,
        selectedValue: "preview",
        exceptionIds: [],
        provenance: provenance("decision"),
      }],
    });
    expect(result.status).toBe("conflicting");
    expect(result.resolutions[0]?.selectedValue).toBeUndefined();
  });

  it("distinguishes conclusive unavailable supply from unknown supply", () => {
    const input = baseInput();
    const unavailable = evaluateComposition({ ...input, supplies: [{ ...input.supplies[0]!, state: "unavailable", values: undefined }] });
    const unknown = evaluateComposition({ ...input, supplies: [{ ...input.supplies[0]!, state: "unknown", values: undefined }] });
    expect(unavailable.status).toBe("invalid");
    expect(unknown.status).toBe("invalid");

    const stripValues = (state: "unavailable" | "unknown") => ({
      id: "supply.runtime", capability: "runtime.javascript", scope, state, provenance: provenance("supply"),
    });
    expect(evaluateComposition({ ...input, supplies: [stripValues("unavailable")] }).status).toBe("conflicting");
    expect(evaluateComposition({ ...input, supplies: [stripValues("unknown")] }).status).toBe("unknown");
  });

  it("does not mutate deeply frozen input and returns detached normalized output", () => {
    const input = deepFreeze(structuredClone(baseInput()));
    const before = JSON.stringify(input);
    const result = evaluateComposition(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(result.status).toBe("effective");
    expect(result.resolutions[0]?.scope).not.toBe(input.declarations[0]?.scope);
    expect(result.resolutions[0]?.provenance[0]).not.toBe(input.declarations[1]?.provenance);
  });
});

describe("validateCompositionEvaluationInput", () => {
  it("rejects unknown fields at every contract level", () => {
    const input = baseInput() as unknown as Record<string, unknown>;
    const declarations = (input.declarations as Array<Record<string, unknown>>);
    input.precedence = "last-wins";
    declarations[0]!.override = true;
    (declarations[0]!.scope as Record<string, unknown>).rank = 1;
    (declarations[0]!.provenance as Record<string, unknown>).path = "/opaque";
    expect(validateCompositionEvaluationInput(input).filter((entry) => entry.rule === "unknown-field").map((entry) => entry.path)).toEqual([
      "$.precedence",
      "declarations[0].override",
      "declarations[0].scope.rank",
      "declarations[0].provenance.path",
    ]);
  });

  it("rejects accessors without invoking them", () => {
    const getter = vi.fn(() => "requirement");
    const declaration = { ...baseInput().declarations[0] };
    Object.defineProperty(declaration, "kind", { enumerable: true, get: getter });
    const findings = validateCompositionEvaluationInput({ ...baseInput(), declarations: [declaration] });
    expect(findings.some((entry) => entry.rule === "entry-shape")).toBe(true);
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects polluted prototypes, symbols, sparse arrays, and behavior-shadowing array fields", () => {
    const polluted = Object.assign(Object.create({ elevated: true }), baseInput().declarations[0]);
    const withSymbol = { ...baseInput().declarations[0], [Symbol("hidden")]: true };
    const sparse = new Array(1);
    const shadowed = [...baseInput().declarations];
    Object.defineProperty(shadowed, "map", { value: () => [], enumerable: false });
    expect(validateCompositionEvaluationInput({ ...baseInput(), declarations: [polluted] })[0]?.rule).toBe("entry-shape");
    expect(validateCompositionEvaluationInput({ ...baseInput(), declarations: [withSymbol] })[0]?.rule).toBe("entry-shape");
    expect(validateCompositionEvaluationInput({ ...baseInput(), declarations: sparse })[0]?.rule).toBe("collection-shape");
    expect(validateCompositionEvaluationInput({ ...baseInput(), declarations: shadowed })[0]?.rule).toBe("collection-shape");
  });

  it("accepts data-only objects from another realm while rejecting malformed provenance", () => {
    const crossRealm = runInNewContext(`(${JSON.stringify(baseInput())})`) as unknown;
    expect(validateCompositionEvaluationInput(crossRealm)).toEqual([]);
    const input = baseInput();
    expect(validateCompositionEvaluationInput({
      ...input,
      declarations: [{ ...input.declarations[0]!, provenance: { source: "", reference: "bad\nreference" } }],
    }).map((entry) => entry.rule)).toEqual(["provenance-source", "provenance-reference"]);
  });

  it("rejects malformed exception targets, cross-scope references, duplicate decisions, and orphan evidence", () => {
    const input = baseInput();
    const otherScope = { plane: "workspace", id: "workspace-a" } as const;
    const result = validateCompositionEvaluationInput({
      ...input,
      supplies: [{ ...input.supplies[0]!, capability: "undeclared.capability" }],
      decisions: [
        { id: "decision.one", capability: "runtime.javascript", scope, selectedValue: "stable", exceptionIds: ["exception.runtime"], provenance: provenance("decision-one") },
        { id: "decision.two", capability: "runtime.javascript", scope, selectedValue: "stable", exceptionIds: [], provenance: provenance("decision-two") },
      ],
      exceptions: [{
        id: "exception.runtime",
        scope: otherScope,
        targetDeclarationIds: ["preference.runtime", "missing.target"],
        allowedValues: ["stable"],
        reason: "Invalid on purpose.",
        provenance: provenance("exception"),
      }],
    });
    expect(result.map((entry) => entry.rule)).toEqual(expect.arrayContaining([
      "orphan-supply", "duplicate-decision", "exception-scope", "exception-target-kind", "exception-target",
    ]));
  });
});
