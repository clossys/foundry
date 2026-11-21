import assert from "node:assert/strict";
import { test } from "node:test";
import { collapse, frozenReason, groupOf, outcome, parseDetail, planFinding, rewriteFile, vendoredFromNotices } from "./codemod-contam-u4.mjs";

const unreachable = (cited, where) => `cites "${cited}" — the nearest real file is "${where}", which is NOT in this package's published file set`;
const rot = cited => `cites "${cited}" — no such path in this package or the repository`;
const names = { designer: "@clossys/designer", producer: "@clossys/producer", publisher: "@clossys/publisher", writer: "@clossys/writer" };
const tracked = [
  "packages/producer/src/records/pin.ts",
  "packages/designer/src/catalog/retired.json",
  "packages/writer/src/catalog/retired.json",
  "packages/designer/src/read/theme.ts",
];
const plan = (pkg, file, line, detail, extra = {}) =>
  planFinding({ line: extra.at ?? 1, detail }, { pkg, file, lines: extra.lines ?? [line], tracked, names });

test("parseDetail reads the cited path, the resolver's file and rot", () => {
  assert.deepEqual(parseDetail(unreachable("a/b.ts", "packages/x/a/b.ts")), { cited: "a/b.ts", where: "packages/x/a/b.ts", rot: false });
  assert.deepEqual(parseDetail(rot("gone/file.md")), { cited: "gone/file.md", where: undefined, rot: true });
});

test("groupOf sorts findings into the CONTAM groups", () => {
  assert.equal(groupOf("designer", parseDetail(rot("x/y.ts"))), "G17");
  assert.equal(groupOf("designer", parseDetail(unreachable("packages/designer/a.ts", "packages/designer/a.ts"))), "G13");
  assert.equal(groupOf("designer", parseDetail(unreachable("clossys/x.md", "x"))), "G14");
  assert.equal(groupOf("designer", parseDetail(unreachable("src/a.test.ts", "packages/designer/src/a.test.ts"))), "G16");
  assert.equal(groupOf("designer", parseDetail(unreachable("records/pin.ts", "packages/producer/src/records/pin.ts"))), "G15");
  assert.equal(groupOf("designer", parseDetail(unreachable("docs/x.md", "docs/x.md"))), "G16");
});

test("G15: another package's file becomes the owning package name, keeping backticks", () => {
  const out = plan("designer", "src/a.ts", " * pins live in `records/pin.ts` today", unreachable("records/pin.ts", "packages/producer/src/records/pin.ts"));
  assert.equal(out.edit.text, " * pins live in `@clossys/producer` today");
});

test("G15: a possessive naming the same package is dropped", () => {
  const out = plan("designer", "src/a.ts", " * read by the Producer's records/pin.ts here", unreachable("records/pin.ts", "packages/producer/src/records/pin.ts"));
  assert.equal(out.edit.text, " * read by @clossys/producer here");
});

test("collapse says a repeated package name once", () => {
  const n = "@clossys/producer";
  assert.equal(collapse("in `@clossys/producer` (`@clossys/producer`)", n, "producer"), "in `@clossys/producer`");
  assert.equal(collapse("(@clossys/producer @clossys/producer)", n, "producer"), "(@clossys/producer)");
  assert.equal(collapse("(packages/producer @clossys/producer)", n, "producer"), "(@clossys/producer)");
  assert.equal(collapse("`@clossys/producer` and `@clossys/producer`.", n, "producer"), "`@clossys/producer`.");
  assert.equal(collapse("@clossys/producer in @clossys/producer", n, "producer"), "@clossys/producer");
  assert.equal(collapse("@clossys/producer/core", n, "producer"), "@clossys/producer/core");
});

test("G16: an unshipped file keeps its path and gains the inline qualifier", () => {
  const bare = plan("producer", "src/a.ts", " * see docs/engine.md for the log", unreachable("docs/engine.md", "docs/engine.md"));
  assert.equal(bare.edit.text, " * see docs/engine.md (not shipped) for the log");
  const ticked = plan("producer", "src/a.ts", " * pinned by `src/a.test.ts`.", unreachable("src/a.test.ts", "packages/producer/src/a.test.ts"));
  assert.equal(ticked.edit.text, " * pinned by `src/a.test.ts` (not shipped).");
  const again = plan("producer", "src/a.ts", " * see docs/engine.md (not shipped)", unreachable("docs/engine.md", "docs/engine.md"));
  assert.match(again.refuse, /already carries the qualifier/);
});

test("own file: a misspelled own path is respelled relative to the citing file", () => {
  const out = plan("designer", "src/builder/x.ts", " * as src/read/theme.ts does", unreachable("src/read/theme.ts", "packages/designer/src/read/theme.ts"));
  assert.equal(out.edit.text, " * as ../read/theme.ts does");
});

test("refusals: rot, forbidden scope, generated region, ambiguity and a conflicting owner", () => {
  assert.match(plan("designer", "src/a.ts", " * x/gone.md", rot("x/gone.md")).refuse, /ROT/);
  assert.match(plan("designer", "src/components/partners/magicui/p.tsx", " * registry/magicui/p.tsx", unreachable("registry/magicui/p.tsx", "packages/designer/src/components/partners/magicui/p.tsx")).refuse, /forbidden scope/);
  const lines = ["// BEGIN GENERATED", " * docs/engine.md", "// END GENERATED"];
  assert.match(plan("producer", "src/a.ts", null, unreachable("docs/engine.md", "docs/engine.md"), { lines, at: 2 }).refuse, /generated region/);
  assert.match(plan("producer", "src/a.ts", " * catalog/retired.json", unreachable("catalog/retired.json", "packages/designer/src/catalog/retired.json")).refuse, /2 packages/);
  assert.match(plan("designer", "src/a.ts", " * the Writer's records/pin.ts", unreachable("records/pin.ts", "packages/producer/src/records/pin.ts")).refuse, /names writer/);
  assert.match(plan("designer", "src/a.ts", " * records/pin.ts and records/pin.ts", unreachable("records/pin.ts", "packages/producer/src/records/pin.ts")).refuse, /2 times/);
});

test("skips the groups other units own and applies two findings on a line one pass at a time", () => {
  assert.deepEqual(plan("designer", "src/a.ts", " * packages/designer/a.ts", unreachable("packages/designer/a.ts", "packages/designer/a.ts")), { skip: "G13" });
  const text = " * docs/a.md and docs/b.md\n";
  const findings = [{ line: 1, detail: unreachable("docs/a.md", "docs/a.md") }, { line: 1, detail: unreachable("docs/b.md", "docs/b.md") }];
  const once = rewriteFile("producer", "src/a.ts", text, findings, { tracked, names });
  assert.equal(once.deferred, 1);
  assert.equal(once.text, " * docs/a.md (not shipped) and docs/b.md\n");
});

const NOTICES = [
  "`src/components/partners/magicui/` vendors the Magic UI registry items",
  "`sonner` 2.0.8 is the Toaster engine. `src/components/partners/shadcn/sonner.tsx` is the stock",
  "shadcn/ui Sonner item; the engine under the Kibo UI Video Player item (`src/components/partners/kibo-ui/video-player.tsx`), under",
].join("\n");

test("frozen files come from the notices record and docs/changelogs/, nothing else", () => {
  const vendored = vendoredFromNotices(NOTICES);
  assert.deepEqual(vendored, ["src/components/partners/magicui/", "src/components/partners/shadcn/sonner.tsx"]);
  assert.match(frozenReason("src/components/partners/magicui/particles.tsx", vendored), /vendored component/);
  assert.match(frozenReason("src/components/partners/shadcn/sonner.tsx", vendored), /vendored component/);
  assert.match(frozenReason("docs/changelogs/producer.md", vendored), /changelog/);
  assert.equal(frozenReason("src/components/partners/kibo-ui/video-player.tsx", vendored), undefined);
  assert.equal(frozenReason("src/components/partners/shadcn/button.tsx", vendored), undefined);
  assert.equal(frozenReason("src/records/pin.ts", vendored), undefined);
  assert.equal(frozenReason("docs/changelogs/old/producer.md", vendored), undefined);
});

test("--check: a G16 line in a non-frozen file still fails; frozen residue alone passes and is named", () => {
  const vendored = vendoredFromNotices(NOTICES);
  const file = "src/a.ts";
  assert.equal(frozenReason(file, vendored), undefined);
  const result = rewriteFile("producer", file, " * see docs/engine.md for the log\n", [{ line: 1, detail: unreachable("docs/engine.md", "docs/engine.md") }], { tracked, names });
  const failing = outcome({ notes: result.notes, deferred: result.deferred, refusals: result.refusals, changes: 1, frozen: [] }, [], { check: true });
  assert.equal(failing.code, 1);
  assert.match(failing.text, /1 rewrite\(s\) pending/);
  const frozen = ["packages/producer/docs/changelogs/producer.md:5: ../contracts/x.md (G16; frozen: changelog under docs/changelogs/)"];
  const passing = outcome({ notes: [], deferred: 0, refusals: [], changes: 0, frozen }, [], { check: true });
  assert.equal(passing.code, 0);
  assert.match(passing.text, /1 frozen residue[^]*producer\.md:5/);
  const refused = outcome({ notes: [], deferred: 0, refusals: ["packages/designer/src/a.ts:1: x/gone.md is ROT"], changes: 0, frozen }, [], { check: true });
  assert.equal(refused.code, 1);
});
