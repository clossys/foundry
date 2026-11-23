/**
 * The Publisher leaves of the synthetic fixture consumer (foundry-build-0048 R6), placed with clossys verbs only.
 * scripts/seed-pinned-world.mjs runs this as its last step, on its fixed clock, so the fixture stays one seeder pass.
 *
 * The Publisher IA is the workspace's own (`clossys ia publisher --start`), so each leaf is placed from the package
 * tree data (packages/publisher/src/catalog/ia/{composition,directory,release}.json): its L1/L2, its contract and its
 * declared inputs. Chrome comes first, then layouts and pages, because a layout reads chrome and a page reads its
 * layouts. Then each release's publication (`clossys ia publisher --publication <pub>`) and the release. Then
 * `clossys migrate contracts` seeds each slot's family, and `clossys loop publisher/loop.scope` adopts and pins the
 * Publisher's loop slots, which a consumer that places the Publisher holds. A leaf already placed is skipped.
 * The workspace's tabs and groups are added first, with the package labels, in TAB_ORDER: the Directory (pages)
 * first, so the agent's first slot is a page.
 *
 * A placement that overlaps a placed slot takes a made-up fixture reason (OVERLAP_REASONS) under the made-up fixture
 * owner decision (FIXTURE_DECISION), like the fixture's other made-up decisions.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const trees = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "publisher", "src", "catalog", "ia");

export const FIXTURE_DECISION = {
  ref: "clossys/fixture-consumer#1 issuecomment-1000000001 (OWNER WORDS 2026-11-19 fixture Publisher placement)",
  quote: "Made-up fixture decision: place the Publisher package leaves; each overlapping leaf below is its own slot.",
};
/** Made-up fixture reasons: why each overlapping leaf's material differs from the slot it overlaps. */
export const OVERLAP_REASONS = {
  "chrome.admin-sidebar": "Made-up fixture reason: the admin sidebar lists the admin publication's page ids, the app sidebar the app's.",
  "layout.site-page": "Made-up fixture reason: a site page the consumer names and routes takes any ordered body sections; the about page is fixed to story, team and closing.",
  "layout.docs-article": "Made-up fixture reason: an article is one body with related reading; the docs index lists every entry.",
  "layout.admin-requests": "Made-up fixture reason: the requests page is the whole open queue; the admin home shows notices and a first-run state.",
};

/** The order of the workspace's tabs: the package L0s, Directory first. */
export const TAB_ORDER = ["directory", "composition", "release"];

/** The live package leaves, each with its record and its `<l1>/<l2>` (the last segment of each package node id). */
export function publisherLeaves() {
  const leaves = [], groups = [];
  for (const name of TAB_ORDER) {
    const tree = JSON.parse(readFileSync(join(trees, `${name}.json`), "utf8"));
    for (const l1 of tree.nodes) {
      if (l1.parked) continue;
      const tab = l1.id.split("/").pop();
      groups.push({ id: tab, label: l1.label });
      for (const l2 of l1.children ?? []) {
        if (l2.parked) continue;
        const under = `${tab}/${l2.id.split("/").pop()}`;
        groups.push({ id: under, label: l2.label });
        for (const id of l2.leaves ?? []) leaves.push({ id, record: tree.slots[id], under });
      }
    }
  }
  return { leaves, groups };
}

/** Places every Publisher leaf in `w.consumer` (the seeder's world: `run(ref, ...argv)`, `file(name, value)`) at `at`. */
export async function placePublisher(w, at) {
  const iaFile = join(w.consumer, "agents", "publisher", "ia.json");
  if (!existsSync(iaFile)) await w.run("publisher", "ia", "publisher", "--start");
  const registry = join(w.consumer, "owner-decisions.json");
  if (!existsSync(registry)) await w.run("publisher", "owner-decision", "init");
  if (!readFileSync(registry, "utf8").includes("1000000001")) {
    await w.run("publisher", "owner-decision", "add", "--ref", FIXTURE_DECISION.ref, "--scope", "ia", "--quote-file", w.file("publisher-owner-words.txt", `${FIXTURE_DECISION.quote}\n`), "--date", at.slice(0, 10));
  }
  const placed = () => new Set(JSON.parse(readFileSync(iaFile, "utf8")).nodes.flatMap(l1 => l1.children.flatMap(l2 => l2.slots)));
  const place = async ({ id, record, under }) => {
    if (placed().has(id)) return;
    const { inputs, family: _family, ...contract } = record;
    const kind = record.kind === "layout" || record.kind === "chrome" ? "page" : record.kind;
    const standard = record.kind === "page" || record.kind === "release" ? ["--standard", record.kind] : [];
    const reason = OVERLAP_REASONS[id] ? ["--owner-ref", FIXTURE_DECISION.ref, "--overlap-reason", OVERLAP_REASONS[id]] : [];
    await w.run(`publisher/${id}`, "ia", `publisher/${id}`, "--contract", w.file(`${id}.contract.json`, contract), "--under", under, "--kind", kind, ...standard,
      "--inputs", inputs.map(ref => ref.slice(ref.indexOf("/") + 1)).join(","), ...reason, "--at", at);
  };
  const { leaves, groups } = publisherLeaves();
  const held = new Set(JSON.parse(readFileSync(iaFile, "utf8")).nodes.flatMap(l1 => [l1.id, ...l1.children.map(l2 => `${l1.id}/${l2.id}`)]));
  for (const group of groups) if (!held.has(group.id)) await w.run("publisher", "ia", "publisher", "--add", group.id, "--label", group.label, "--owner-ref", FIXTURE_DECISION.ref, "--at", at);
  for (const kind of ["chrome", "layout", "page"]) for (const leaf of leaves.filter(each => each.record.kind === kind)) await place(leaf);
  for (const leaf of leaves.filter(each => each.record.kind === "release")) {
    await w.run(`publisher/${leaf.id}`, "ia", "publisher", "--publication", leaf.record.publication);
    await place(leaf);
  }
  await w.run("publisher", "migrate", "contracts", "--at", at);
  await w.run("publisher/loop.scope", "loop", "publisher/loop.scope", "--at", at);
}
