import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { latestDecisionIndices, planDelegateCopyAuthority } from "./plan-authority.js";
import { planDigest } from "./plan-digest.js";
import type { PlanDelegateCopyAuthority, PlanDelegateCopyRefusal } from "./plan-authority.js";

/*
 * Issue #1586. planDelegateCopyAuthority() against the plans of the shared
 * digest corpus, whose approving decisions already name their own digest,
 * and against plans this file edits. Reading the repository's docs here is
 * test-only: nothing at runtime leaves this package.
 */
type Plan = Record<string, any>;
interface DigestCorpus {
  plans: { name: string; plan: Plan; digest: string }[];
}
const CORPUS = JSON.parse(readFileSync(new URL("../../../docs/contracts/advisor-plan-digest.fixture.json", import.meta.url), "utf8")) as DigestCorpus;
const entry = (name: string) => CORPUS.plans.find((candidate) => candidate.name === name)!;
const plan = (name: string): Plan => structuredClone(entry(name).plan);
const digestOf = (name: string): string => entry(name).digest;

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const decide = (at: string, chosen: string, subjectDigest?: string) => ({
  at,
  recommended: "compose from confirmed problems",
  chosen,
  by: "sponsor",
  ...(subjectDigest === undefined ? {} : { subjectDigest }),
});
const withDecisions = (name: string, ...decisions: unknown[]): Plan => ({ ...plan(name), decisions });

const SCOPED = digestOf("delegated-copy-approval-scoped");
const OTHER = digestOf("blockers-without-due");
const T1 = "2026-09-21T00:00:00Z";
const T2 = "2026-09-22T00:00:00Z";

function refusal(input: unknown): PlanDelegateCopyRefusal {
  const result = planDelegateCopyAuthority(input);
  if (result.authorized) throw new Error("expected a refusal");
  return result.refusal;
}
function authorized(input: unknown): Extract<PlanDelegateCopyAuthority, { authorized: true }> {
  const result = planDelegateCopyAuthority(input);
  if (!result.authorized) throw new Error(`expected authority, got ${result.refusal}`);
  return result;
}

describe("planDelegateCopyAuthority: what authorizes", () => {
  it("authorizes the scoped corpus plan, naming its digest and scopes", () => {
    const result = authorized(encode(plan("delegated-copy-approval-scoped")));
    expect(result).toEqual({ authorized: true, planDigest: SCOPED, scopes: ["home", "site.pricing"] });
  });

  it("authorizes the unscoped corpus plan with no scopes key at all", () => {
    const result = authorized(encode(plan("delegated-copy-approval-unscoped")));
    expect(result.planDigest).toBe(digestOf("delegated-copy-approval-unscoped"));
    expect(Object.hasOwn(result, "scopes")).toBe(false);
  });

  it("authorizes the keys-reversed corpus plan, which is the same plan", () => {
    expect(authorized(encode(plan("delegated-copy-approval-scoped-keys-reversed"))).planDigest).toBe(SCOPED);
  });

  it("accepts a Node Buffer, a subarray view into a larger buffer, and pretty-printed bytes", () => {
    const json = JSON.stringify(plan("delegated-copy-approval-scoped"), null, 2);
    expect(authorized(Buffer.from(json, "utf8")).planDigest).toBe(SCOPED);
    const padded = new Uint8Array(Buffer.from(`   ${json}   `, "utf8"));
    expect(authorized(padded.subarray(3, padded.length - 3)).planDigest).toBe(SCOPED);
  });

  it("authorizes a repeated scope item (redundant, not refused)", () => {
    const repeated = { ...plan("delegated-copy-approval-scoped"), delegatedCopyApproval: { target: "production", scopes: ["home", "home"] } };
    const own = planDigest(repeated);
    expect(authorized(encode({ ...repeated, decisions: [decide(T1, "approved", own)] })).scopes).toEqual(["home", "home"]);
  });

  it("finds the latest decision by time, not by array position", () => {
    expect(authorized(encode(withDecisions("delegated-copy-approval-scoped", decide(T2, "approved", SCOPED), decide(T1, "deferred")))).planDigest).toBe(SCOPED);
    expect(refusal(encode(withDecisions("delegated-copy-approval-scoped", decide(T2, "deferred"), decide(T1, "approved", SCOPED))))).toBe("latest-decision-not-approved");
    expect(refusal(encode(withDecisions("delegated-copy-approval-scoped", decide(T1, "approved", SCOPED), decide(T2, "deferred"))))).toBe("latest-decision-not-approved");
  });

  it("ties decisions by instant, so different offsets and fractions for one instant tie", () => {
    const early = "2026-09-21T00:00:00Z";
    const sameInstant = "2026-09-21T02:00:00+02:00";
    const withFraction = "2026-09-21T00:00:00.000Z";
    expect(authorized(encode(withDecisions("delegated-copy-approval-scoped", decide(early, "approved", SCOPED), decide(sameInstant, "approved", SCOPED)))).planDigest).toBe(SCOPED);
    expect(authorized(encode(withDecisions("delegated-copy-approval-scoped", decide(withFraction, "approved", SCOPED), decide(early, "approved", SCOPED)))).planDigest).toBe(SCOPED);
    for (const order of [[early, sameInstant], [sameInstant, early]] as const) {
      expect(refusal(encode(withDecisions("delegated-copy-approval-scoped", decide(order[0], "approved", SCOPED), decide(order[1], "rejected")))), order.join(" ")).toBe("latest-decision-not-approved");
      expect(refusal(encode(withDecisions("delegated-copy-approval-scoped", decide(order[0], "approved", SCOPED), decide(order[1], "approved", OTHER)))), order.join(" ")).toBe("latest-decisions-disagree");
    }
  });
});

describe("planDelegateCopyAuthority: refusals, in the order the checks run", () => {
  it("refuses anything that is not a Uint8Array view, before reading it", () => {
    const bytes = encode(plan("delegated-copy-approval-scoped"));
    const proxied = new Proxy(new Uint8Array(bytes), {});
    const revoked = Proxy.revocable(new Uint8Array(bytes), {});
    revoked.revoke();
    const values = [undefined, null, {}, "{}", 5, [], [...bytes], new DataView(bytes.buffer as ArrayBuffer), new Uint16Array(4), bytes.buffer, proxied, revoked.proxy, () => bytes];
    values.forEach((value, index) => {
      expect(refusal(value), `value ${index}`).toBe("plan-not-bytes");
    });
  });

  it("refuses bytes that are not strict JSON as plan-unreadable", () => {
    const text = JSON.stringify(plan("delegated-copy-approval-scoped"));
    const bytes = (input: string) => new TextEncoder().encode(input);
    const duplicateTarget = text.replace('"target":"production"', '"target":"production","target":"production"');
    expect(duplicateTarget).not.toBe(text);
    const nestedDuplicate = text.replace('"problem":', '"problem":"x","problem":');
    expect(nestedDuplicate).not.toBe(text);
    const cases: [string, Uint8Array][] = [
      ["a repeated key", bytes(duplicateTarget)],
      ["a repeated key in a nested object", bytes(nestedDuplicate)],
      ["a repeated key spelled with an escape", bytes(text.replace('"target":"production"', '"target":"production","\\u0074arget":"production"'))],
      ["invalid UTF-8", new Uint8Array([0xff, 0xfe, 0x7b, 0x7d])],
      ["a truncated multi-byte sequence", new Uint8Array([...bytes(text), 0xc3])],
      ["a byte order mark", new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(text)])],
      ["a syntax error", bytes(`${text}}`)],
      ["empty bytes", new Uint8Array(0)],
      ["a trailing comma", bytes(text.replace(/\}$/, ",}"))],
    ];
    for (const [name, value] of cases) expect(refusal(value), name).toBe("plan-unreadable");
  });

  it("refuses a value that is not a valid plan as plan-invalid, naming each violation by rule and position only", () => {
    for (const value of [5, [], null, "plan", {}]) expect(refusal(encode(value)), JSON.stringify(value)).toBe("plan-invalid");
    const unknownKey = planDelegateCopyAuthority(encode({ ...plan("delegated-copy-approval-scoped"), extra: true }));
    expect(unknownKey).toEqual({ authorized: false, refusal: "plan-invalid", violations: [{ rule: "schema", path: "" }] });
  });

  it("reports a code-rule failure of the plan (R9) by rule and position, and a schema failure of a decision time", () => {
    const base = plan("delegated-copy-approval-scoped");
    const repeatedRole = planDelegateCopyAuthority(encode({ ...base, mandate: { ...base.mandate, roles: ["strategist", "writer", "strategist"] } }));
    expect(repeatedRole).toEqual({ authorized: false, refusal: "plan-invalid", violations: [{ rule: "R9", path: "mandate.roles[2]" }] });
    const badTime = planDelegateCopyAuthority(encode(withDecisions("delegated-copy-approval-scoped", decide("yesterday", "approved", SCOPED))));
    expect(badTime).toEqual({ authorized: false, refusal: "plan-invalid", violations: [{ rule: "schema", path: "decisions[0].at" }] });
  });

  it("refuses a plan that fails validation even when its approval and field would otherwise authorize", () => {
    const base = plan("delegated-copy-approval-scoped");
    const invalid = { ...base, delegatedCopyApproval: { target: "production", scopes: [] } };
    expect(refusal(encode(invalid))).toBe("plan-invalid");
    expect(refusal(encode({ ...base, delegatedCopyApproval: { target: "preview" } }))).toBe("plan-invalid");
    expect(refusal(encode({ ...base, delegatedCopyApproval: { target: "production", scopes: ["home.*"] } }))).toBe("plan-invalid");
  });

  it("never carries plan text in a refusal", () => {
    const base = plan("delegated-copy-approval-scoped");
    const result = planDelegateCopyAuthority(encode({ ...base, mandate: { ...base.mandate, problem: "", roles: ["strategist", "strategist"] } }));
    const text = JSON.stringify(result);
    expect(text).not.toContain("Our site");
    expect(text).not.toContain("strategist");
  });

  it("refuses a valid plan that does not declare delegatedCopyApproval, whatever its approval names", () => {
    expect(refusal(encode(plan("delegated-copy-approval-removed")))).toBe("delegated-copy-approval-absent");
    const other = withDecisions("blockers-without-due", decide(T1, "approved", OTHER));
    expect(refusal(encode(other))).toBe("delegated-copy-approval-absent");
  });

  it("refuses a plan with no decisions", () => {
    expect(refusal(encode(withDecisions("delegated-copy-approval-scoped")))).toBe("no-decisions");
  });

  it("refuses when the latest decision is not an approval", () => {
    expect(refusal(encode(withDecisions("delegated-copy-approval-scoped", decide(T1, "deferred", SCOPED))))).toBe("latest-decision-not-approved");
    expect(refusal(encode(withDecisions("delegated-copy-approval-scoped", decide(T1, "Approved", SCOPED))))).toBe("latest-decision-not-approved");
    expect(refusal(encode(plan("delegated-copy-approval-scoped-new-decisions")))).toBe("latest-decision-not-approved");
  });

  it("refuses an approval that names no digest, or a malformed one", () => {
    expect(refusal(encode(withDecisions("delegated-copy-approval-scoped", decide(T1, "approved"))))).toBe("approval-without-subject-digest");
    for (const bad of ["sha256:ABCD", "sha256:abc", `sha1:${"a".repeat(64)}`, `sha256:${"A".repeat(64)}`]) {
      // The schema's digest pattern refuses a malformed digest before the authority reads it.
      expect(refusal(encode(withDecisions("delegated-copy-approval-scoped", decide(T1, "approved", bad)))), bad).toBe("plan-invalid");
    }
  });

  it("checks the whole latest set: a tie with an approval that names no digest is refused in either order", () => {
    for (const decisions of [[decide(T1, "approved", SCOPED), decide(T1, "approved")], [decide(T1, "approved"), decide(T1, "approved", SCOPED)]]) {
      expect(refusal(encode(withDecisions("delegated-copy-approval-scoped", ...decisions)))).toBe("approval-without-subject-digest");
    }
  });

  it("refuses tied approvals that name different digests, in both array orders", () => {
    for (const decisions of [[decide(T1, "approved", SCOPED), decide(T1, "approved", OTHER)], [decide(T1, "approved", OTHER), decide(T1, "approved", SCOPED)]]) {
      expect(refusal(encode(withDecisions("delegated-copy-approval-scoped", ...decisions)))).toBe("latest-decisions-disagree");
    }
  });

  it("refuses a tie between an approval and a non-approval in both orders, before looking at digests", () => {
    for (const decisions of [[decide(T1, "approved", OTHER), decide(T1, "rejected")], [decide(T1, "rejected"), decide(T1, "approved", OTHER)]]) {
      expect(refusal(encode(withDecisions("delegated-copy-approval-scoped", ...decisions)))).toBe("latest-decision-not-approved");
    }
  });

  it("refuses an approval that names another plan's digest", () => {
    expect(refusal(encode(withDecisions("delegated-copy-approval-scoped", decide(T1, "approved", OTHER))))).toBe("subject-digest-mismatch");
    expect(refusal(encode(withDecisions("delegated-copy-approval-scoped", decide(T1, "approved", `sha256:${"0".repeat(64)}`))))).toBe("subject-digest-mismatch");
  });

  it("refuses a plan whose field was edited after the approval, by digest mismatch", () => {
    expect(refusal(encode(plan("delegated-copy-approval-scopes-reordered")))).toBe("subject-digest-mismatch");
    expect(refusal(encode(plan("delegated-copy-approval-scope-widened")))).toBe("subject-digest-mismatch");
    const unscoped = { ...plan("delegated-copy-approval-unscoped"), delegatedCopyApproval: { target: "production", scopes: ["home"] } };
    expect(refusal(encode(unscoped))).toBe("subject-digest-mismatch");
  });

  it("refuses a plan whose field was added after an approval of the plan without it", () => {
    const added = { ...plan("delegated-copy-approval-scoped"), decisions: [decide(T1, "approved", OTHER)] };
    expect(refusal(encode(added))).toBe("subject-digest-mismatch");
  });

  it("does not use the clock: the approval has no expiry of its own", () => {
    expect(authorized(encode(withDecisions("delegated-copy-approval-scoped", decide("2001-01-01T00:00:00Z", "approved", SCOPED)))).planDigest).toBe(SCOPED);
    expect(authorized(encode(withDecisions("delegated-copy-approval-scoped", decide("2999-01-01T00:00:00Z", "approved", SCOPED)))).planDigest).toBe(SCOPED);
  });

  it("never throws, whatever the bytes", () => {
    for (const value of [new Uint8Array(0), new Uint8Array([0]), encode("x"), encode(null), Buffer.from("[[[[")]) expect(() => planDelegateCopyAuthority(value)).not.toThrow();
  });
});

describe("planDelegateCopyAuthority: the result", () => {
  it("is frozen, with a frozen fresh copy of the scopes", () => {
    const result = authorized(encode(plan("delegated-copy-approval-scoped")));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.scopes)).toBe(true);
    expect(authorized(encode(plan("delegated-copy-approval-scoped"))).scopes).not.toBe(result.scopes);
    expect(() => {
      (result as { planDigest: string }).planDigest = "x";
    }).toThrow(TypeError);
  });

  it("freezes a refusal and its violations", () => {
    const result = planDelegateCopyAuthority(encode({ ...plan("delegated-copy-approval-scoped"), extra: true }));
    expect(Object.isFrozen(result)).toBe(true);
    if (result.authorized) throw new Error("expected a refusal");
    expect(Object.isFrozen(result.violations)).toBe(true);
    expect(result.violations?.every((violation) => Object.isFrozen(violation))).toBe(true);
    expect(Object.isFrozen(planDelegateCopyAuthority(undefined))).toBe(true);
  });

  it("is not changed by the caller mutating its bytes afterward", () => {
    const bytes = encode(plan("delegated-copy-approval-scoped"));
    const result = authorized(bytes);
    const snapshot = JSON.stringify(result);
    bytes.fill(0);
    expect(JSON.stringify(result)).toBe(snapshot);
    expect(refusal(bytes)).toBe("plan-unreadable");
  });

  it("never reads a getter-bearing input as bytes", () => {
    let reads = 0;
    const trap = { get length() { reads += 1; return 0; } };
    expect(refusal(trap)).toBe("plan-not-bytes");
    expect(reads).toBe(0);
  });
});

describe("latestDecisionIndices", () => {
  const at = (...times: string[]) => times.map((time) => ({ at: time }));

  it("returns the indices at the greatest instant, in array order", () => {
    expect(latestDecisionIndices(at(T1, T2, T2))).toEqual([1, 2]);
    expect(latestDecisionIndices(at(T2, T1))).toEqual([0]);
    expect(latestDecisionIndices(at("2026-09-21T00:00:00Z", "2026-09-21T02:00:00+02:00"))).toEqual([0, 1]);
  });

  it("returns null for no decisions or a time that does not parse", () => {
    expect(latestDecisionIndices([])).toBeNull();
    expect(latestDecisionIndices(at(T1, "yesterday"))).toBeNull();
  });

  it("copes with a very long list", () => {
    const many = Array.from({ length: 200_000 }, () => ({ at: T1 }));
    expect(latestDecisionIndices(many)).toHaveLength(200_000);
  });
});
