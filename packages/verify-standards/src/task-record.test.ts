import { describe, expect, it } from "vitest";
import { gateResultToExitCode } from "@vespeneventures/governance/gates";
import { checkTaskRecord, extractTaskReferenceText, parseTaskReference } from "./task-record.js";
import type { TaskRecordObservation, TaskRecordPolicy } from "./task-record.js";

const policy: TaskRecordPolicy = {
  applicableEventKinds: ["proposed-change"],
  exemptLabels: ["record-exempt"],
  exemptAuthorSuffixes: ["[bot]"],
  exemptHeadRefPrefixes: ["release-automation/"],
  recordLabels: ["Work item"],
  requireResolvedItem: true,
};

function change(overrides: Partial<TaskRecordObservation> = {}): TaskRecordObservation {
  return {
    eventKind: "proposed-change",
    description: "Work item: #42\n\nSome explanation.",
    authorId: "a-person",
    headRef: "topic/thing",
    labels: [],
    trackerScope: "a-scope/a-project",
    item: { outcome: "resolved", title: "Do the thing" },
    ...overrides,
  };
}

describe("extractTaskReferenceText", () => {
  it.each([
    ["Work item: #12", "#12"],
    ["**Work item:** #12", "#12"],
    ["Work item #12", "#12"],
    ["work ITEM: a-scope/a-project#12", "a-scope/a-project#12"],
    ["Preamble.\nWork item: #12.", "#12"],
    ["Work item: (#12)", "(#12"],
  ])("reads %s", (description, expected) => {
    expect(extractTaskReferenceText(description, ["Work item"])).toBe(expected);
  });

  it("finds nothing when no declared label appears", () => {
    expect(extractTaskReferenceText("Just a description.", ["Work item"])).toBeUndefined();
  });

  it("treats a caller's label as a literal, not as pattern syntax", () => {
    // A label containing regex metacharacters must match itself and nothing
    // else — otherwise a caller's data silently becomes a pattern nobody wrote.
    expect(extractTaskReferenceText("Ticket (id): #7", ["Ticket (id)"])).toBe("#7");
    expect(extractTaskReferenceText("Ticket xid: #7", ["Ticket (id)"])).toBeUndefined();
  });
});

describe("parseTaskReference", () => {
  it.each([
    ["#12", { scope: "fallback/scope", number: "12" }],
    ["12", { scope: "fallback/scope", number: "12" }],
    ["a-scope/a-project#12", { scope: "a-scope/a-project", number: "12" }],
    ["https://tracker.example/a-scope/a-project/issues/12", { scope: "a-scope/a-project", number: "12" }],
  ])("parses %s", (raw, expected) => {
    expect(parseTaskReference(raw, "fallback/scope")).toMatchObject(expected);
  });

  it.each(["not-a-reference", "#", "a-scope/a-project", "https://tracker.example/a-scope/a-project/pulls/12"])(
    "refuses %s",
    (raw) => {
      expect(parseTaskReference(raw, "fallback/scope")).toBeUndefined();
    },
  );
});

describe("checkTaskRecord", () => {
  it("is satisfied when a resolvable work item is referenced", () => {
    const report = checkTaskRecord(change(), policy);
    expect(report.result).toMatchObject({ verdict: "satisfied", evaluated: 2 });
    expect(report.reference).toMatchObject({ scope: "a-scope/a-project", number: "42" });
    expect(gateResultToExitCode(report.result)).toBe(0);
  });

  it("is violated when the description names no work item", () => {
    const report = checkTaskRecord(change({ description: "No reference here." }), policy);
    expect(report.result.verdict).toBe("violated");
    if (report.result.verdict !== "violated") throw new Error("unreachable");
    expect(report.result.findings[0]?.rule).toBe("task-record-missing");
    expect(gateResultToExitCode(report.result)).toBe(1);
  });

  it("is violated when the reference is not a recognisable shape", () => {
    const report = checkTaskRecord(change({ description: "Work item: soon" }), policy);
    if (report.result.verdict !== "violated") throw new Error("expected violated");
    expect(report.result.findings[0]?.rule).toBe("task-record-unparseable");
  });

  it("is violated when the reference resolves to something that is not a work item", () => {
    const report = checkTaskRecord(
      change({ item: { outcome: "resolved-wrong-kind", detail: "it is another proposed change" } }),
      policy,
    );
    if (report.result.verdict !== "violated") throw new Error("expected violated");
    expect(report.result.findings[0]?.rule).toBe("task-record-wrong-kind");
  });

  describe("structural exemptions", () => {
    it.each([
      ["an automation author", { authorId: "dependency-updater[bot]" }, "author"],
      ["a release-automation branch", { headRef: "release-automation/v2" }, "head-ref"],
      ["a declared label", { labels: ["record-exempt"] }, "label"],
    ])("exempts %s, and names the exemption", (_label, overrides, kind) => {
      const report = checkTaskRecord(change({ description: "No reference.", ...overrides }), policy);
      expect(report.result.verdict).toBe("satisfied");
      expect(report.exemption).toMatchObject({ kind });
    });

    it("refuses a policy whose exemption list would match everything", () => {
      const report = checkTaskRecord(change(), { ...policy, exemptAuthorSuffixes: [""] });
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "policy-invalid" });
    });
  });

  describe("things that are unevaluable rather than wrong", () => {
    it("declines an event kind the policy does not cover", () => {
      const report = checkTaskRecord(change({ eventKind: "scheduled" }), policy);
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "not-applicable-event" });
      expect(gateResultToExitCode(report.result)).toBe(2);
    });

    it("declines a reference outside the scope the credential can read", () => {
      const report = checkTaskRecord(change({ description: "Work item: elsewhere/other#3" }), policy);
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "item-outside-tracker-scope" });
    });

    it("declines a lookup that was never attempted", () => {
      const report = checkTaskRecord(change({ item: { outcome: "not-attempted" } }), policy);
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "item-lookup-not-attempted" });
    });

    it("declines a tracker that could not answer", () => {
      const report = checkTaskRecord(change({ item: { outcome: "unavailable", detail: "rate limited" } }), policy);
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "item-lookup-unavailable" });
    });

    it("does not treat invisibility as proof of absence", () => {
      // A scoped credential answers identically for an item that is absent and
      // one it may not read. Failing the change would blame the change for a
      // fact about the credential.
      const report = checkTaskRecord(change({ item: { outcome: "not-visible" } }), policy);
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "item-not-visible" });
    });

    it("declines when no observation or no policy was supplied", () => {
      expect(checkTaskRecord(undefined, policy).result).toMatchObject({ reason: "no-observation-supplied" });
      expect(checkTaskRecord(change(), undefined).result).toMatchObject({ reason: "no-policy-supplied" });
    });
  });

  it("checks shape only, and says so, when the policy does not require resolution", () => {
    const report = checkTaskRecord(change({ item: undefined }), { ...policy, requireResolvedItem: false });
    expect(report.result).toMatchObject({ verdict: "satisfied", evaluated: 1 });
  });

  it("is indeterminate for a lookup outcome this build does not recognise", () => {
    // The satisfied branch is the last one in the check. An unrecognised
    // outcome used to fall past every branch that names one and land on it,
    // so a caller's typo read as a resolved work item.
    const report = checkTaskRecord(
      change({ item: { outcome: "unknown" } as unknown as { outcome: "resolved" } }),
      policy,
    );
    expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "observation-invalid" });
    expect(gateResultToExitCode(report.result)).toBe(2);
  });

  it.each([
    ["applicableEventKinds", { applicableEventKinds: null }],
    ["exemptLabels", { exemptLabels: null }],
    ["recordLabels", { recordLabels: 7 }],
  ])("is indeterminate rather than throwing when policy.%s is not a list", (_name, broken) => {
    const report = checkTaskRecord(change(), { ...policy, ...broken } as unknown as TaskRecordPolicy);
    expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "policy-invalid" });
  });

  it.each([
    ["labels", { labels: null }],
    ["authorId", { authorId: null }],
    ["headRef", { headRef: 7 }],
    ["description", { description: null }],
  ])("is indeterminate rather than throwing when observation.%s is malformed", (_name, broken) => {
    const report = checkTaskRecord({ ...change(), ...broken } as unknown as TaskRecordObservation, policy);
    expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "observation-invalid" });
  });

  it.each([[null], [42], ["a-string"]])("is indeterminate when the observation itself is %s", (record) => {
    const report = checkTaskRecord(record as unknown as TaskRecordObservation, policy);
    expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "no-observation-supplied" });
  });

  it("never reports satisfied on a path that evaluated nothing", () => {
    for (const input of [
      undefined,
      change({ eventKind: "scheduled" }),
      change({ item: { outcome: "not-attempted" } }),
    ]) {
      expect(checkTaskRecord(input, policy).result.verdict).not.toBe("satisfied");
    }
  });
});
