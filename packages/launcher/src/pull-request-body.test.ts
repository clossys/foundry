import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildWorld, clone, mutateSet } from "./admission-fixture.js";
import type { Loose } from "./admission-fixture.js";
import type { ApprovalBinding, RepositoryChangeSet } from "./change-set-contract.js";
import { readChangeSetMarker, renderPullRequest } from "./pull-request-body.js";
import type { PullRequestText } from "./pull-request-body.js";

const world = buildWorld();
const APPROVED_APPLY: ApprovalBinding = { kind: "approved", subjectDigest: world.applyBundle.bundleDigest };
const ADMITTED_APPLY: ApprovalBinding = { kind: "admitted", subjectDigest: world.approvedBundle.bundleDigest, setupChangeSet: world.setup.changeSetDigest };
const APPROVED_SETUP: ApprovalBinding = { kind: "approved", subjectDigest: world.approvedBundle.bundleDigest };

const rendered = (set: RepositoryChangeSet, binding: ApprovalBinding, taskRecord = 12): PullRequestText => {
  const result = renderPullRequest({ set, binding, taskRecord });
  if (result.state !== "rendered") throw new Error(`refused: ${result.reason}`);
  return result;
};
const refusal = (set: unknown, binding: unknown, taskRecord: unknown = 12) => renderPullRequest({ set, binding, taskRecord } as never);

const SETUP_DIGEST = "sha256:1ea52995a85df343cada4557cc91a23f9cf210976bf9894b172142a6a234de2c";
const APPLY_DIGEST = "sha256:f85253bd566bfa9a72733fdc9a63f0701b4d42940bd0c4c601d9a3712de9c0d0";
const PLAN_DIGEST = "sha256:834434fb2b492ac904029841194f4cacec1acd4ce4f422c8f87301096d22b414";
const SETUP_BUNDLE = "sha256:b691c17edfebd0845db222af53e88de778d87017d5c10c469a807ab15f8ea43c";
const APPLY_BUNDLE = "sha256:c257dad4e121a84e9d533fc613413f326ddf320c83ca4e781b86faee279adc02";

const APPLY_ITEMS = [
  "- `brief` `write-record`",
  "- `caller-workflow` `add-caller-workflow`",
  "- `ci-template` `add-ci-template`",
  "- `example-owner/site:@example/starter` `pin-starter` `@example/starter@0.9.2`",
  "- `example-owner/site:@example/strategist` `install` `@example/strategist@1.4.0`",
  "- `example-owner/site:@example/writer` `install` `@example/writer@0.7.0`",
  "- `ledger` `write-ledger`",
  "- `path-scope-job` `add-path-scope-job`",
  "- `skills` `compose-skills`",
  "- `starter-request` `write-starter-request`",
];

const applyHead = (binding: string[]): string =>
  [
    `<!-- clossys-change-set: ${APPLY_DIGEST} -->`,
    "",
    "## Change set",
    "",
    "- Repository: `example-owner/site`",
    "- Phase: `apply`",
    `- Change set: \`${APPLY_DIGEST}\``,
    `- Plan: \`${PLAN_DIGEST}\``,
    `- Bundle: \`${APPLY_BUNDLE}\``,
    "",
    "## Binding",
    "",
    ...binding,
    "",
    "## Items",
    "",
    ...APPLY_ITEMS,
    "",
    "## Task record",
    "",
    "- #12",
    "",
  ].join("\n");

describe("renderPullRequest: golden bytes", () => {
  it("renders an approved apply set", () => {
    const out = rendered(world.apply, APPROVED_APPLY);
    expect(out.title).toBe("Clossys: apply plan f85253bd566b");
    expect(out.body).toBe(applyHead(["- Binding: `approved`", `- Approved subject: \`${APPLY_BUNDLE}\``]));
    expect(out.bodySha256).toBe("sha256:3c64caa51a91957723ba34faac759c2546c17ca159c04453c14748ded6cf9309");
  });

  it("renders an admitted apply set", () => {
    const out = rendered(world.apply, ADMITTED_APPLY);
    expect(out.title).toBe("Clossys: apply plan f85253bd566b");
    expect(out.body).toBe(applyHead(["- Binding: `admitted`", `- Admitted subject: \`${SETUP_BUNDLE}\``, `- Setup change set: \`${SETUP_DIGEST}\``]));
    expect(out.bodySha256).toBe("sha256:ee1d8f0a2106fee5e888005c7292fb0b7bfc039d65d67ee847a588ff5b2b07bf");
  });

  it("renders an approved setup set, with what it defers", () => {
    const out = rendered(world.setup, APPROVED_SETUP, 7);
    expect(out.title).toBe("Clossys: apply plan 1ea52995a85d");
    expect(out.body).toBe(
      [
        `<!-- clossys-change-set: ${SETUP_DIGEST} -->`,
        "",
        "## Change set",
        "",
        "- Repository: `example-owner/site`",
        "- Phase: `setup`",
        `- Change set: \`${SETUP_DIGEST}\``,
        `- Plan: \`${PLAN_DIGEST}\``,
        `- Bundle: \`${SETUP_BUNDLE}\``,
        "",
        "## Binding",
        "",
        "- Binding: `approved`",
        `- Approved subject: \`${SETUP_BUNDLE}\``,
        "",
        "## Items",
        "",
        "- `brief` `write-record`",
        "- `caller-workflow` `add-caller-workflow`",
        "- `ci-template` `add-ci-template`",
        "- `example-owner/site:@example/starter` `pin-starter` `@example/starter@0.9.2`",
        "- `ledger` `write-ledger`",
        "- `path-scope-job` `add-path-scope-job`",
        "- `skills` `compose-skills`",
        "- `starter-request` `write-starter-request`",
        "",
        "## Not applied",
        "",
        "- Deferred: `example-owner/site:@example/strategist` `after-setup`",
        "- Deferred: `example-owner/site:@example/writer` `after-setup`",
        "",
        "## Task record",
        "",
        "- #7",
        "",
      ].join("\n"),
    );
    expect(out.bodySha256).toBe("sha256:252542acdbe00ddb86bdf771b0454c2376d0c9217f75b8cb5c603a119f648d1b");
  });

  it("lists a refused entry by item id and reason code only, never by path", () => {
    const set = mutateSet(world.apply, (draft) => {
      draft.files = (draft.files as Loose[]).filter((file) => file.path !== "clossys/brief.json");
      draft.refused = [{ path: "clossys/brief.json", reason: "unowned-existing", item: "brief" }];
    });
    const out = rendered(set, APPROVED_APPLY);
    expect(out.body).toContain("\n## Not applied\n\n- Refused: `brief` `unowned-existing`\n\n## Task record\n");
    expect(out.body).not.toContain("clossys/brief.json");
  });
});

describe("renderPullRequest: supersedes", () => {
  const withSupersedes = (supersedes: unknown, taskRecord = 12) => renderPullRequest({ set: world.apply, binding: APPROVED_APPLY, taskRecord, supersedes } as never);
  const golden = rendered(world.apply, APPROVED_APPLY);

  it("supersedes sorts numerically", () => {
    const out = withSupersedes([10, 9]);
    if (out.state !== "rendered") throw new Error(`refused: ${out.reason}`);
    expect(out.body).toContain("\n- #9\n- #10\n\n## Task record\n");
    expect(out).toEqual(withSupersedes([9, 10]));
  });

  it("supersedes ascending, absent keeps golden bytes", () => {
    const out = withSupersedes([9, 3]);
    if (out.state !== "rendered") throw new Error(`refused: ${out.reason}`);
    expect(out.body).toBe(golden.body.replace("## Task record\n", "## Supersedes\n\n- #3\n- #9\n\n## Task record\n"));
    expect(out.body).toContain("\n- #3\n- #9\n\n## Task record\n\n- #12\n");
    expect(out.bodySha256).toBe(`sha256:${createHash("sha256").update(Buffer.from(out.body, "utf8")).digest("hex")}`);
    expect(readChangeSetMarker(out.body)).toBe(APPLY_DIGEST);
    expect(out.body.endsWith("\n\n")).toBe(false);
    // The order the caller gave never shows.
    expect(withSupersedes([3, 9])).toEqual(out);
    // Numbers sort as numbers, not as text: 9 comes before 10.
    for (const given of [[10, 9], [9, 10]]) {
      const wide = withSupersedes(given);
      if (wide.state !== "rendered") throw new Error(`refused: ${wide.reason}`);
      expect(wide.body).toContain("\n## Supersedes\n\n- #9\n- #10\n\n## Task record\n");
    }

    // Absent, undefined and empty: the golden bytes, and the golden hash.
    for (const supersedes of [undefined, []]) {
      const same = withSupersedes(supersedes);
      expect(same).toEqual(golden);
      if (same.state === "rendered") expect(same.body).not.toContain("Supersedes");
    }
    expect(golden.bodySha256).toBe("sha256:3c64caa51a91957723ba34faac759c2546c17ca159c04453c14748ded6cf9309");
    expect(renderPullRequest({ set: world.apply, binding: APPROVED_APPLY, taskRecord: 12 })).toEqual(golden);
  });

  it("refuses a duplicate, a number that is not a positive safe integer, the task record, and anything that is not a list of numbers", () => {
    const bad: unknown[] = [[3, 3], [0], [-1], [1.5], [2 ** 53], [Number.NaN], [Number.POSITIVE_INFINITY], [-0], [12], [3, 12], ["3"], [null], [[3]], [7n], "3", 3, null, {}, { length: 1, 0: 3 }];
    for (const supersedes of bad) expect(withSupersedes(supersedes), String(supersedes)).toEqual({ state: "refused", reason: "supersedes-invalid" });
    expect(withSupersedes([Number.MAX_SAFE_INTEGER])).toMatchObject({ state: "rendered" });
    expect(withSupersedes([1])).toMatchObject({ state: "rendered" });
    // A supersedes list is judged against the task record it is given.
    expect(withSupersedes([12], 13)).toMatchObject({ state: "rendered" });
    // The task record is judged first.
    expect(withSupersedes([3], 0)).toEqual({ state: "refused", reason: "task-record-invalid" });
  });

  it("reads the list once, so a number that changes between reads cannot split the checks from the text", () => {
    const shifting = [3];
    let reads = 0;
    Object.defineProperty(shifting, 0, { enumerable: true, get: () => (reads++ === 0 ? 3 : 12) });
    const out = withSupersedes(shifting);
    if (out.state !== "rendered") throw new Error(`refused: ${out.reason}`);
    expect(out.body).toContain("## Supersedes\n\n- #3\n\n## Task record");
  });
});

describe("renderPullRequest: shape and purity", () => {
  const cases: [string, RepositoryChangeSet, ApprovalBinding][] = [
    ["approved apply", world.apply, APPROVED_APPLY],
    ["admitted apply", world.apply, ADMITTED_APPLY],
    ["approved setup", world.setup, APPROVED_SETUP],
  ];

  it.each(cases)("gives identical output on two calls, and hashes the returned body: %s", (_name, set, binding) => {
    const first = rendered(set, binding);
    const second = rendered(clone(set), clone(binding));
    expect(second).toEqual(first);
    expect(first.bodySha256).toBe(`sha256:${createHash("sha256").update(Buffer.from(first.body, "utf8")).digest("hex")}`);
    expect(first.title).toBe(set.pullRequest.title);
  });

  it.each(cases)("is LF only, ends in one LF, and has the marker as the first and only marker line: %s", (_name, set, binding) => {
    const { body } = rendered(set, binding);
    expect(body).not.toContain("\r");
    expect(body.endsWith("\n")).toBe(true);
    expect(body.endsWith("\n\n")).toBe(false);
    expect(body).toMatch(/^[\x20-\x7e\n]*$/u);
    const lines = body.split("\n");
    expect(lines[0]).toBe(`<!-- clossys-change-set: ${set.changeSetDigest} -->`);
    expect(lines.filter((line) => line.includes("clossys-change-set"))).toHaveLength(1);
    expect(body.match(/<!--/gu)).toHaveLength(1);
    expect(readChangeSetMarker(body)).toBe(set.changeSetDigest);
  });

  it("carries one line per item, in the set's own order", () => {
    const { body } = rendered(world.apply, APPROVED_APPLY);
    const section = body.slice(body.indexOf("## Items\n\n") + "## Items\n\n".length, body.indexOf("\n\n## Task record"));
    expect(section.split("\n").map((line) => line.split("`")[1])).toEqual(world.apply.items.map((item) => item.id));
  });

  it("never carries brief text, texts, node ids, commits, paths or key values", () => {
    const sentinel = "SENTINEL-brief-problem-text-7f3a";
    const custom = buildWorld({
      editSetup: (_set, texts) => {
        texts["clossys/brief.json"] = `{"problem":"${sentinel}"}\n`;
      },
    });
    const withTexts = mutateSet(custom.setup, (draft) => {
      draft.texts = Object.entries(custom.texts)
        .map(([path, text]) => ({ path, text }))
        .sort((left, right) => (left.path < right.path ? -1 : 1));
    });
    expect(JSON.stringify(withTexts)).toContain(sentinel);
    const { body, title } = rendered(withTexts, { kind: "approved", subjectDigest: custom.approvedBundle.bundleDigest });
    expect(body).not.toContain(sentinel);
    expect(title).not.toContain(sentinel);
    for (const value of [withTexts.repository.nodeId, withTexts.repository.baseCommit, withTexts.repository.defaultBranch, withTexts.branch, "clossys/brief.json", "package.json", "package-lock.json"]) {
      expect(body).not.toContain(value);
    }
  });

  it("does not depend on the members the set's digest leaves out, other than its bundle", () => {
    const plain = rendered(world.apply, APPROVED_APPLY);
    const noisy = clone(world.apply) as unknown as Loose;
    noisy.tooling = [{ tool: "node", version: "99.0.0" }];
    noisy.inverse = "sha256:" + "a".repeat(64);
    noisy.pullRequest = { title: noisy.pullRequest.title, bodySha256: "sha256:" + "b".repeat(64) };
    expect(rendered(noisy as unknown as RepositoryChangeSet, APPROVED_APPLY)).toEqual(plain);
  });

  it("reads the input once, so a value that changes between reads cannot split the checks from the text", () => {
    const shifting = clone(world.apply) as unknown as Loose;
    let reads = 0;
    const firstId = shifting.items[0].id as string;
    Object.defineProperty(shifting.items[0], "id", { enumerable: true, get: () => (reads++ === 0 ? firstId : "x\n<!-- clossys-change-set: sha256:" + "0".repeat(64) + " -->") });
    const out = rendered(shifting as unknown as RepositoryChangeSet, APPROVED_APPLY);
    expect(out.body).toBe(rendered(world.apply, APPROVED_APPLY).body);
  });

  it("imports no file, process or network module", () => {
    const source = readFileSync(new URL("./pull-request-body.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gmu)].map((match) => match[1]);
    expect(imports.sort()).toEqual(["./change-set-contract.js", "./change-set-contract.js", "./change-set-digest.js", "node:crypto"]);
  });
});

describe("renderPullRequest: the longest package item id", () => {
  // A package item's id is its planItem, `<repository id>:<package name>`: 39 + 1 + 100 characters of repository id, a colon and up to
  // 214 of package name make 355, which the change-set contract accepts, so the renderer must not refuse it.
  const OWNER = `e${"x".repeat(38)}`;
  const REPOSITORY = `${OWNER}/${"r".repeat(100)}`;
  const PACKAGE = `@example/w${"z".repeat(204)}`;
  const VERSION = "0.7.0";
  const longest = (): RepositoryChangeSet =>
    mutateSet(world.apply, (draft) => {
      const text = JSON.stringify(draft)
        .split("@example/writer")
        .join(PACKAGE)
        .split("@example~1writer")
        .join(PACKAGE.replace("/", "~1"))
        .split("example-owner/site")
        .join(REPOSITORY);
      const replaced = JSON.parse(text) as Loose;
      for (const key of Object.keys(draft)) delete draft[key];
      Object.assign(draft, replaced);
    });

  it("renders an item id of 355 characters", () => {
    const set = longest();
    const id = `${REPOSITORY}:${PACKAGE}`;
    expect(id).toHaveLength(355);
    expect(set.items.some((item) => item.id === id)).toBe(true);
    const out = rendered(set, APPROVED_APPLY);
    expect(out.body).toContain(`- \`${id}\` \`install\` \`${PACKAGE}@${VERSION}\`\n`);
  });
});

describe("readChangeSetMarker", () => {
  const marker = `<!-- clossys-change-set: ${APPLY_DIGEST} -->`;

  it("round-trips a rendered body", () => {
    expect(readChangeSetMarker(rendered(world.apply, APPROVED_APPLY).body)).toBe(APPLY_DIGEST);
    expect(readChangeSetMarker(rendered(world.setup, APPROVED_SETUP).body)).toBe(SETUP_DIGEST);
  });

  it("reads the digest from any line that is exactly the marker", () => {
    expect(readChangeSetMarker(`intro\n${marker}\nrest\n`)).toBe(APPLY_DIGEST);
    expect(readChangeSetMarker(marker)).toBe(APPLY_DIGEST);
  });

  it("gives null for a second marker line, even the same one", () => {
    expect(readChangeSetMarker(`${marker}\n\n${marker}\n`)).toBeNull();
    expect(readChangeSetMarker(`${marker}\n<!-- clossys-change-set: ${SETUP_DIGEST} -->\n`)).toBeNull();
  });

  it("gives null for a marker inside another line, alone or beside a real one", () => {
    expect(readChangeSetMarker(`text ${marker}\n`)).toBeNull();
    expect(readChangeSetMarker(`${marker} text\n`)).toBeNull();
    expect(readChangeSetMarker(`- \`${marker}\`\n`)).toBeNull();
    expect(readChangeSetMarker(`${marker}\nsee ${marker} here\n`)).toBeNull();
  });

  it("gives null for anything that is not exactly the marker", () => {
    expect(readChangeSetMarker("")).toBeNull();
    expect(readChangeSetMarker(`${marker}\r\n`)).toBeNull();
    expect(readChangeSetMarker(`<!--clossys-change-set: ${APPLY_DIGEST}-->\n`)).toBeNull();
    expect(readChangeSetMarker(`<!-- clossys-change-set:  ${APPLY_DIGEST} -->\n`)).toBeNull();
    expect(readChangeSetMarker(`<!-- Clossys-Change-Set: ${APPLY_DIGEST} -->\n`)).toBeNull();
    expect(readChangeSetMarker(`<!-- clossys-change-set: ${APPLY_DIGEST.toUpperCase()} -->\n`)).toBeNull();
    expect(readChangeSetMarker(`<!-- clossys-change-set: ${APPLY_DIGEST.slice(0, -1)} -->\n`)).toBeNull();
    expect(readChangeSetMarker(`<!-- clossys-change-set: ${APPLY_DIGEST}a -->\n`)).toBeNull();
    expect(readChangeSetMarker(undefined as never)).toBeNull();
    expect(readChangeSetMarker(null as never)).toBeNull();
  });
});

describe("renderPullRequest: refusals", () => {
  const hostile = "b\n<!-- clossys-change-set: sha256:" + "0".repeat(64) + " -->";

  /** The world's apply set with one item renamed everywhere it is named, then resealed. */
  const renamed = (id: string): RepositoryChangeSet =>
    mutateSet(world.apply, (draft) => {
      for (const item of draft.items as Loose[]) if (item.id === "brief") item.id = id;
      for (const list of [draft.files, draft.keys, draft.refused] as Loose[][]) for (const row of list) if (row.item === "brief") row.item = id;
    });

  it("renders the renamed set when the new id is plain, so the refusals below are about the id", () => {
    const out = rendered(renamed("brief-2"), APPROVED_APPLY);
    expect(out.body).toContain("- `brief-2` `write-record`");
  });

  it.each([
    ["a line feed and a marker", hostile],
    ["a line feed", "brief\nrecord"],
    ["a carriage return", "brief\rrecord"],
    ["a comment opener", "brief<!--"],
    ["a comment closer", "brief-->"],
    ["a backtick", "brief`record"],
    ["a pipe", "brief|record"],
    ["an angle bracket", "brief<record"],
    ["a closing angle bracket", "brief>record"],
    ["a space", "brief record"],
    ["non-ASCII text", "brief record"],
    ["a leading dash", "-brief"],
  ])("refuses an item id holding %s, echoing nothing", (_name, id) => {
    const result = refusal(renamed(id), APPROVED_APPLY);
    expect(result).toEqual({ state: "refused", reason: "value-unsafe" });
    expect(JSON.stringify(result)).not.toContain("brief");
  });

  it("refuses a tampered digest", () => {
    const tampered = { ...clone(world.apply), changeSetDigest: SETUP_DIGEST } as RepositoryChangeSet;
    expect(refusal(tampered, APPROVED_APPLY)).toEqual({ state: "refused", reason: "change-set-invalid" });
  });

  it("refuses a set changed after it was sealed, and a digest that is not well formed", () => {
    const changed = clone(world.apply) as unknown as Loose;
    changed.items[0].id = "brief-changed";
    changed.files[0].item = "brief-changed";
    expect(refusal(changed, APPROVED_APPLY)).toEqual({ state: "refused", reason: "change-set-invalid" });
    expect(refusal({ ...clone(world.apply), changeSetDigest: "sha256:zz" }, APPROVED_APPLY)).toEqual({ state: "refused", reason: "change-set-invalid" });
  });

  it("refuses a title that does not follow from the digest", () => {
    const tampered = clone(world.apply) as unknown as Loose;
    tampered.pullRequest = { title: "Clossys: apply plan 000000000000" };
    expect(refusal(tampered, APPROVED_APPLY)).toEqual({ state: "refused", reason: "change-set-invalid" });
    tampered.pullRequest = { title: `Clossys: apply plan ${APPLY_DIGEST.slice(7, 19)} and more` };
    expect(refusal(tampered, APPROVED_APPLY)).toEqual({ state: "refused", reason: "change-set-invalid" });
    tampered.pullRequest = { title: "Clossys: apply plan f85253bd566b\n" };
    expect(refusal(tampered, APPROVED_APPLY)).toEqual({ state: "refused", reason: "change-set-invalid" });
  });

  it("refuses what is not a change set", () => {
    for (const value of [null, undefined, 0, "set", [], {}]) expect(refusal(value, APPROVED_APPLY)).toEqual({ state: "refused", reason: "change-set-invalid" });
    expect(renderPullRequest(undefined as never)).toEqual({ state: "refused", reason: "render-failed" });
  });

  it("refuses an admitted binding on a setup set", () => {
    const admitted: ApprovalBinding = { kind: "admitted", subjectDigest: world.approvedBundle.bundleDigest, setupChangeSet: APPLY_DIGEST };
    expect(refusal(world.setup, admitted)).toEqual({ state: "refused", reason: "binding-phase-mismatch" });
  });

  it.each([
    ["short", "sha256:abc"],
    ["upper case", `sha256:${"A".repeat(64)}`],
    ["without the prefix", "b".repeat(64)],
    ["with a trailing line feed", `${APPLY_BUNDLE}\n`],
    ["holding a backtick", `sha256:${"a".repeat(63)}\``],
    ["not a string", 7],
  ])("refuses a binding digest that is %s", (_name, digest) => {
    expect(refusal(world.apply, { kind: "approved", subjectDigest: digest })).toEqual({ state: "refused", reason: "binding-invalid" });
    expect(refusal(world.apply, { kind: "admitted", subjectDigest: digest, setupChangeSet: SETUP_DIGEST })).toEqual({ state: "refused", reason: "binding-invalid" });
    expect(refusal(world.apply, { kind: "admitted", subjectDigest: SETUP_BUNDLE, setupChangeSet: digest })).toEqual({ state: "refused", reason: "binding-invalid" });
  });

  it("refuses a binding that is malformed in any other way", () => {
    for (const binding of [
      null,
      undefined,
      "approved",
      [],
      {},
      { kind: "approved" },
      { kind: "revoked", subjectDigest: APPLY_BUNDLE },
      { kind: "approved", subjectDigest: APPLY_BUNDLE, setupChangeSet: SETUP_DIGEST },
      { kind: "admitted", subjectDigest: SETUP_BUNDLE },
      { kind: "admitted", subjectDigest: SETUP_BUNDLE, setupChangeSet: SETUP_DIGEST, extra: true },
      { kind: "admitted", subjectDigest: SETUP_BUNDLE, setupChangeSet: APPLY_DIGEST },
      { kind: "admitted", subjectDigest: APPLY_BUNDLE, setupChangeSet: SETUP_DIGEST },
    ]) {
      expect(refusal(world.apply, binding)).toEqual({ state: "refused", reason: "binding-invalid" });
    }
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, -0, "7", null, undefined, 7n, {}, [7]])("refuses task record %s", (taskRecord) => {
    expect(renderPullRequest({ set: world.apply, binding: APPROVED_APPLY, taskRecord } as never)).toEqual({ state: "refused", reason: "task-record-invalid" });
  });

  it("accepts the smallest and the largest task record number", () => {
    expect(rendered(world.apply, APPROVED_APPLY, 1).body).toContain("\n- #1\n");
    expect(rendered(world.apply, APPROVED_APPLY, Number.MAX_SAFE_INTEGER).body).toContain(`\n- #${Number.MAX_SAFE_INTEGER}\n`);
  });

  it("names no value in any refusal", () => {
    const results = [refusal(renamed(hostile), APPROVED_APPLY), refusal(world.apply, { kind: "approved", subjectDigest: "sha256:abc" }), refusal(world.apply, APPROVED_APPLY, 0), refusal(null, APPROVED_APPLY)];
    for (const result of results) {
      expect(Object.keys(result).sort()).toEqual(["reason", "state"]);
      expect(JSON.stringify(result)).not.toMatch(/sha256|clossys|example|brief|<|`/u);
    }
  });
});
