import { describe, expect, it } from "vitest";
import { gateResultToExitCode } from "@clossys/controller/gates";
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

  it("does not let prose containing the label win over the real record", () => {
    // The label is matched case-insensitively, so ordinary prose contains it.
    // The earlier arrangement returned the token after the FIRST match — "at"
    // — and never reached the reference sitting three lines below it.
    const description = "There is no work item at all in the linked change.\n\nWork item: #42";
    expect(extractTaskReferenceText(description, ["Work item"])).toBe("#42");
  });

  it("consults every configured label, not only the first", () => {
    // A description whose reference is introduced by the SECOND declared
    // label, with prose matching the first, was previously unreachable.
    const description = "No work item at all for this one.\n\nIssue: #7";
    expect(extractTaskReferenceText(description, ["Work item", "Issue"])).toBe("#7");
  });

  it("still reports a malformed reference rather than downgrading it to absent", () => {
    // Preferring a parseable candidate must not collapse "the reference is
    // wrong" into "there is no reference" — they are different findings.
    expect(extractTaskReferenceText("Work item: banana", ["Work item"])).toBe("banana");
  });

  it("reads a reference written inside a code span", () => {
    expect(extractTaskReferenceText("`Work item: #12`", ["Work item"])).toBe("#12`");
    expect(extractTaskReferenceText("Work item: `#12`", ["Work item"])).toBe("`#12`");
  });

  it("does not match a label embedded inside a longer word", () => {
    // Without a word boundary, the label "Refs" matches the "Refs" hiding
    // inside "Prefs" and "Underrefs" — neither is the label. The genuine
    // "Refs" is on its own anchored line, so it is still found.
    expect(extractTaskReferenceText("Check the user prefs 2024 config.", ["Refs"])).toBeUndefined();
    expect(extractTaskReferenceText("An underrefs situation.\n\nRefs #9", ["Refs"])).toBe("#9");
  });

  it("still matches a label ending in punctuation, which plain \\b cannot", () => {
    // `\b` requires a word/non-word transition at the label's own edge. A
    // label ending in ")" immediately followed by ":" is two non-word
    // characters in a row — a real boundary, but not one `\b` can see. The
    // guard here must not regress the already-passing "Ticket (id)" case.
    expect(extractTaskReferenceText("Ticket (id): #7", ["Ticket (id)"])).toBe("#7");
  });

  it("prefers a hash-marked reference over an earlier naked number found in prose", () => {
    // The exact case from the filed defect: "Refs" is matched case-
    // insensitively, so the prose "that Refs 2024 baseline" matches the
    // configured label "Refs" and yields the bare, shape-valid candidate
    // "2024" — which used to win outright because the earlier fix only
    // preferred "shaped" over "unshaped", and a naked number is shaped.
    // "2024" would resolve the gate against the wrong issue entirely.
    const description = "This change follows on from work that Refs 2024 baseline of the standards document.\n\nRefs #12";
    expect(extractTaskReferenceText(description, ["Refs"])).toBe("#12");
  });

  it("finds nothing in a description whose only label occurrence is mid-sentence", () => {
    // "Refs" here sits after real words on the same line ("work that "),
    // which is structurally the same shape as the confirmed false match
    // "already fixes for" — a label trailing ordinary prose, not
    // introducing a record. Anchoring now excludes it as a candidate
    // outright, rather than falling back to it as an ambiguous last resort.
    const description = "This change follows on from work that Refs 2024 baseline of the standards document.";
    expect(extractTaskReferenceText(description, ["Refs"])).toBeUndefined();
  });

  it("prefers a marked, anchored reference over an earlier mid-sentence naked number", () => {
    // The mid-sentence "Refs 2024" is excluded outright by anchoring; the
    // anchored "Refs `#12`" on its own line is the only real candidate.
    const description = "Work that Refs 2024 baseline.\n\nRefs `#12`.";
    expect(extractTaskReferenceText(description, ["Refs"])).toBe("`#12`");
  });

  it("prefers a shaped anchored candidate over an earlier unshaped anchored one", () => {
    // Two genuinely anchored lines can still disagree — a placeholder line
    // above the real one. The shaped candidate still wins.
    expect(extractTaskReferenceText("Closes: soon\n\nCloses: #12", ["Closes"])).toBe("#12");
  });

  it("does not match a label anchored at line start but embedded in a real word before it", () => {
    // The exact shape of the confirmed generated-heading failure: "Fixes" is
    // preceded on its line only by decoration (bullet, emphasis) EXCEPT for
    // the real word "Bug", so it is not a candidate at all.
    const description = "* **Bug Fixes**\n  * Updated the check to use the latest compatible patch release.";
    expect(extractTaskReferenceText(description, ["Fixes"])).toBeUndefined();
  });

  it("does not match a label trailing ordinary prose on the same line", () => {
    // The exact shape of the confirmed author-prose failure.
    const description = "...the header comment describes and already fixes for every other root-install caller";
    expect(extractTaskReferenceText(description, ["Fixes"])).toBeUndefined();
  });

  it("does not capture across a line break when a heading label has nothing after it", () => {
    // A bare generated heading with the real content on the FOLLOWING line
    // must not have that line's content read as its value.
    expect(extractTaskReferenceText("## Fixes\n* Updated a dependency.", ["Fixes"])).toBeUndefined();
  });

  it("still finds an anchored label immediately followed by a value on the same line", () => {
    expect(extractTaskReferenceText("## Fixes #12", ["Fixes"])).toBe("#12");
  });

  it("ignores a record-shaped label inside a generated-content HTML comment", () => {
    const description = "Some real prose about the change.\n\n<!--\nCloses: #99\n-->\n\nCloses: #12";
    expect(extractTaskReferenceText(description, ["Closes"])).toBe("#12");
  });

  it("would otherwise have matched the same label were it not fenced in a comment", () => {
    // Demonstrates the comment-stripping is actually doing something: the
    // identical text, unfenced, is found.
    expect(extractTaskReferenceText("Closes: #99", ["Closes"])).toBe("#99");
  });

  it("finds nothing when the only anchored-looking label sits entirely inside a generated comment block", () => {
    const description = "No record from the author here.\n\n<!--\n* **Bug Fixes**\n  * Updated a dependency.\n-->";
    expect(extractTaskReferenceText(description, ["Fixes"])).toBeUndefined();
  });

  it("handles long generated regions without regex backtracking", () => {
    const generated = "x".repeat(250_000);
    const description = `<!--${generated}Work item: #99-->\nWork item: #12`;
    expect(extractTaskReferenceText(description, ["Work item"])).toBe("#12");
  });

  it("retains a long unterminated generated-region marker as ordinary text", () => {
    const description = `<!--${"x".repeat(250_000)}\nWork item: #12`;
    expect(extractTaskReferenceText(description, ["Work item"])).toBe("#12");
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

  it.each([
    ["#12`", { scope: "fallback/scope", number: "12" }],
    ["`#12`", { scope: "fallback/scope", number: "12" }],
    ["`a-scope/a-project#12`", { scope: "a-scope/a-project", number: "12" }],
  ])("strips the code-span delimiters around %s", (raw, expected) => {
    // A description is Markdown. A reference in a code span is correct
    // authoring, and the whitespace-split extraction leaves the delimiter
    // attached to the token, so the anchored pattern used to reject a
    // reference that was plainly there.
    expect(parseTaskReference(raw, "fallback/scope")).toMatchObject(expected);
  });

  it("keeps raw exactly as it was written, delimiters and all", () => {
    // The report shows a human what the description actually said.
    expect(parseTaskReference("`#12`", "fallback/scope")?.raw).toBe("`#12`");
  });

  it("still refuses a backticked value that is not a reference", () => {
    expect(parseTaskReference("`banana`", "fallback/scope")).toBeUndefined();
  });

  it("parses long valid references in linear time", () => {
    const owner = "o".repeat(100_000);
    const name = "n".repeat(100_000);
    expect(parseTaskReference(`${owner}/${name}#123`, "fallback/scope")).toMatchObject({
      scope: `${owner}/${name}`,
      number: "123",
    });
  });

  it("rejects long adversarial URL and qualified-reference tails without backtracking", () => {
    const tail = "/segment".repeat(30_000);
    expect(parseTaskReference(`https://tracker.example/owner/name/issues/12${tail}`, "fallback/scope")).toBeUndefined();
    expect(parseTaskReference(`owner/name#${"1".repeat(200_000)}x`, "fallback/scope")).toBeUndefined();
    expect(parseTaskReference(`x${"`".repeat(200_000)}y`, "fallback/scope")).toBeUndefined();
  });
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

  describe("false matches from generated content and mid-sentence prose", () => {
    // Both scenarios reproduce the confirmed occurrences: a review bot's
    // appended "Bug Fixes" heading, and a label trailing ordinary author
    // prose. Neither is a genuine record, so the label must never become a
    // candidate at all — the verdict is "missing", never "unparseable"
    // reporting a garbage token like "*" or "for".

    it("does not report a generated 'Bug Fixes' heading as an unparseable record", () => {
      const description =
        "Some real prose explaining the change.\n\n" +
        "## Summary by an automated reviewer\n\n" +
        "* **Bug Fixes**\n" +
        "  * Updated a dependency to the latest compatible patch release.\n";
      const report = checkTaskRecord(change({ description }), { ...policy, recordLabels: ["Work item", "Fixes"] });
      expect(report.result.verdict).toBe("violated");
      if (report.result.verdict !== "violated") throw new Error("unreachable");
      expect(report.result.findings[0]?.rule).toBe("task-record-missing");
    });

    it("still finds a real record above a generated 'Bug Fixes' heading", () => {
      // The author's genuine record must survive even when a bot appends a
      // heading that would otherwise be misread as one.
      const description =
        "Work item: #42\n\n" +
        "## Summary by an automated reviewer\n\n" +
        "* **Bug Fixes**\n" +
        "  * Updated a dependency to the latest compatible patch release.\n";
      const report = checkTaskRecord(change({ description }), { ...policy, recordLabels: ["Work item", "Fixes"] });
      expect(report.result).toMatchObject({ verdict: "satisfied", evaluated: 2 });
      expect(report.reference).toMatchObject({ number: "42" });
    });

    it("does not report a label trailing author prose as an unparseable record", () => {
      const description =
        "This removes the redundant wrapper; the header comment describes and " +
        "already fixes for every other root-install caller.";
      const report = checkTaskRecord(change({ description }), { ...policy, recordLabels: ["Work item", "Fixes"] });
      expect(report.result.verdict).toBe("violated");
      if (report.result.verdict !== "violated") throw new Error("unreachable");
      expect(report.result.findings[0]?.rule).toBe("task-record-missing");
    });

    it("ignores a record-shaped label fenced inside a generated HTML comment", () => {
      const description = "Work item: #42\n\n<!--\nWork item: #99\n-->\n";
      const report = checkTaskRecord(change({ description }), policy);
      expect(report.result).toMatchObject({ verdict: "satisfied", evaluated: 2 });
      expect(report.reference).toMatchObject({ number: "42" });
    });
  });

  it.each([
    ["`Work item: #42`", "the whole line in a code span"],
    ["Work item: `#42`", "only the reference in a code span"],
    ["Work item: `a-scope/a-project#42`", "a qualified reference in a code span"],
  ])("is satisfied for %s (%s)", (description) => {
    // These are real descriptions, correctly authored. Failing them is a
    // wrong verdict about a change that did everything right.
    const report = checkTaskRecord(change({ description }), policy);
    expect(report.result).toMatchObject({ verdict: "satisfied", evaluated: 2 });
    expect(report.reference).toMatchObject({ scope: "a-scope/a-project", number: "42" });
    expect(gateResultToExitCode(report.result)).toBe(0);
  });

  it("is satisfied when prose above the record also contains the label", () => {
    const report = checkTaskRecord(
      change({ description: "There is no work item at all in the upstream fix.\n\nWork item: #42" }),
      policy,
    );
    expect(report.result).toMatchObject({ verdict: "satisfied", evaluated: 2 });
    expect(gateResultToExitCode(report.result)).toBe(0);
  });

  it("is satisfied when the record uses a later configured label than the prose match", () => {
    const report = checkTaskRecord(
      change({ description: "No work item at all upstream.\n\nIssue: #42" }),
      { ...policy, recordLabels: ["Work item", "Issue"] },
    );
    expect(report.result).toMatchObject({ verdict: "satisfied", evaluated: 2 });
  });

  it("resolves against the real record, not a naked number sitting in prose", () => {
    // The exact scenario from the filed defect, run end to end: the label
    // "Refs" matches inside ordinary prose ("that Refs 2024 baseline") and
    // yields the shape-valid but wrong candidate "2024". Without the
    // naked-number tie-break, this would resolve the gate against issue
    // #2024 rather than the real #12 further down the description.
    const report = checkTaskRecord(
      change({
        description:
          "This change follows on from work that Refs 2024 baseline of the standards document.\n\nRefs #12",
        item: { outcome: "resolved", title: "The real work item" },
      }),
      { ...policy, recordLabels: ["Refs"] },
    );
    expect(report.result).toMatchObject({ verdict: "satisfied", evaluated: 2 });
    expect(report.reference).toMatchObject({ number: "12" });
  });

  it("does not match a configured label embedded inside an unrelated word", () => {
    const report = checkTaskRecord(
      change({ description: "Check the user prefs 2024 config. No other reference here." }),
      { ...policy, recordLabels: ["Refs"] },
    );
    expect(report.result.verdict).toBe("violated");
    if (report.result.verdict !== "violated") throw new Error("unreachable");
    expect(report.result.findings[0]?.rule).toBe("task-record-missing");
  });

  it("does not turn a prose-only description into a pass", () => {
    // The fixes above must never manufacture a satisfied verdict: a
    // description with no reference in it is still violated.
    const report = checkTaskRecord(change({ description: "There is no work item at all." }), policy);
    expect(report.result.verdict).toBe("violated");
    expect(gateResultToExitCode(report.result)).toBe(1);
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
