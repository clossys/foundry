#!/usr/bin/env node
/**
 * The pinned test world (foundry-build-0048 Unit A): seeds test-fixtures/consumer so that every slot the
 * fixture pages read (the upstream closure of the site shell, the hero section and their Writer copy) holds a
 * candidate pinned through the CHOOSE gate, and so does one Publisher page (Unit D: the site header chrome, seeded
 * in a second pass once the Publisher leaves are placed). Only the clossys verbs write: `clossys verdict --record` (the P1
 * create verdict), `clossys next --stage brief|diverge|render` and `clossys critique` (the P2 craft stages),
 * `clossys next --submit` (the guarded candidates verb) and `clossys pin` (the gate, its scorecard and the pin
 * ledger event). The content is synthetic fixture data, one generator per standard; it names no brand or client.
 *
 *   node scripts/seed-pinned-world.mjs [--out <dir>]   (default: rewrite test-fixtures/consumer; any other --out
 *   must be new, empty, or a tree this script wrote)
 *
 * The run is a pure function of the unpinned base (BASE: this fixture as the integration line held it before any
 * world was seeded, read from git history), taken as is: nothing is stripped, and every record and event the run
 * adds is written by a verb. The clock is fixed (AT), so one pass writes the same bytes; pinned-world.test.ts seeds
 * from BASE and compares the result with the committed tree.
 * BLOCKED lists the closure slots the run cannot fill (a refused shape, or a craft standard with no generator), with
 * why; the run leaves them (and their downstream) unpinned and prints them. Any other refusal stops the run (exit 1).
 * Before the seeding, the run does what a real consumer does to its store: `clossys migrate slots --apply` (the
 * Producer seats are clossys.slot/1 in the base). After it, the run places every Publisher package leaf
 * (scripts/place-fixture-publisher.mjs) on the same clock, then seeds PUBLISHER_TARGETS through the same verbs.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizedSeedFile } from "@clossys/designer/ref-verbatim";
import { placePublisher } from "./place-fixture-publisher.mjs";

/** The recipe axes the slot's last craft:brief recorded (`assembled.recipe.axes`): the axes its diverge directions vary. */
function briefAxes(ledger) {
  const brief = JSON.parse(readFileSync(ledger, "utf8")).events.filter(event => event.op === "craft:brief").at(-1);
  const axes = brief?.assembled?.recipe?.axes;
  if (!Array.isArray(axes) || !axes.length) throw new Error(`${ledger}: the craft:brief records no recipe axes`);
  return axes;
}

/** The seed clock: every record the verbs write in this run carries it. */
export const AT = "2026-11-19T00:00:00Z";
const RealDate = Date;
/** `new Date()` reads the seed clock; `Date.now()` stays real (lock files and their staleness use it). */
class SeedDate extends RealDate {
  constructor(...args) { if (args.length) super(...args); else super(AT); }
  static now() { return RealDate.now(); }
}

const here = dirname(fileURLToPath(import.meta.url));
const PRODUCER = resolve(here, "..");
export const FIXTURE = join(PRODUCER, "test-fixtures", "consumer");
const MODEL = "fixture-model";
const BY = "planner:fixture-world";

/** The slots the fixture pages read, besides the pages themselves (Publisher places them in its tests). */
export const TARGETS = ["designer/frames.site-shell", "designer/sections.hero", "writer/sections.hero.copy", "writer/frames.site-header.copy", "writer/page.home.meta", "writer/publication.site.meta"];
/**
 * The Publisher slots the run pins (Unit D): the site header chrome, whose upstream is the frames and copy above.
 * Publisher leaves exist only once placePublisher has run, so these seed in a second pass after it.
 */
export const PUBLISHER_TARGETS = ["publisher/chrome.site-header"];

// ---------------------------------------------------------------- base (the unpinned fixture)

/**
 * The one file that names the unpinned base (BASE_FILE: `{ commit, path }`). The seeder and pinned-world.test.ts
 * both read it, so when the integration line moves the unpinned fixture, only this file changes.
 */
export const BASE_FILE = join(here, "seed-pinned-world.base.json");

/**
 * The unpinned base: this fixture as the integration line held it before any world was seeded into it (git keeps
 * that tree), as BASE_FILE names it. The run starts from it as is, so nothing is stripped and no record is written
 * but by a verb; a slot the base already pins keeps that pin.
 */
export const BASE = readBase();

/** BASE_FILE's `{ commit, path }`; refused unless the commit is a full sha and the path a repository path. */
function readBase() {
  const value = JSON.parse(readFileSync(BASE_FILE, "utf8"));
  if (typeof value?.commit !== "string" || !/^[0-9a-f]{40}$/.test(value.commit)) throw new Error(`${BASE_FILE}: commit must be a full 40-character sha`);
  if (typeof value.path !== "string" || !value.path || value.path.startsWith("/")) throw new Error(`${BASE_FILE}: path must be a repository-relative path`);
  return Object.freeze({ commit: value.commit, path: value.path });
}

/**
 * Refuses unless `commit` is an ancestor of `repo`'s HEAD: a base the checked-out line does not contain is a stale
 * or foreign BASE_FILE, never a tree to seed from.
 */
export function assertBaseAncestor(repo, commit) {
  try {
    execFileSync("git", ["-C", repo, "merge-base", "--is-ancestor", commit, "HEAD"], { stdio: "ignore" });
  } catch {
    throw new Error(`the unpinned base ${commit} (${relative(repo, BASE_FILE) || BASE_FILE}) is not an ancestor of HEAD in ${repo}; point the base file at the unpinned fixture this line holds`);
  }
}

/**
 * Writes the base tree into `dir` (which must be empty or new), read from `repo`'s git history at `base` (default:
 * this repository and BASE); refused unless the base commit is an ancestor of HEAD.
 */
export function extractBase(dir, { repo = REPO, base = BASE } = {}) {
  mkdirSync(dir, { recursive: true });
  if (readdirSync(dir).length) throw new Error(`${dir} is not empty; the base is extracted into an empty folder`);
  assertBaseAncestor(repo, base.commit);
  const tar = execFileSync("git", ["-C", repo, "archive", "--format=tar", base.commit, base.path], { maxBuffer: 1 << 30 });
  execFileSync("tar", ["-x", "-C", dir, "--strip-components", String(base.path.split("/").length)], { input: tar });
}

// ---------------------------------------------------------------- the verbs

let runCli;
let STEPS;
let readSlot;
let readStandard;
let loadRecipes;
let craftRunRecipe;
let RECIPE_TIERS;
export async function load() {
  globalThis.Date = SeedDate;
  ({ runCli } = await import("../dist/cli/main.js"));
  ({ STEPS } = await import("../dist/pipeline/steps/index.js"));
  ({ readSlot } = await import("../dist/records/slots.js"));
  ({ readStandard } = await import("../dist/records/standards.js"));
  ({ loadRecipes, craftRunRecipe, RECIPE_TIERS } = await import("../dist/records/recipes.js"));
}

class Refused extends Error {
  constructor(slot, message) { super(`${slot}: ${message}`); this.slot = slot; }
}

function world(root, scratch) {
  const consumer = join(root, "clossys");
  let n = 0;
  const file = (name, value) => {
    const path = join(scratch, `${String(++n).padStart(4, "0")}-${name}`);
    writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
    return path;
  };
  const run = async (ref, ...args) => {
    const result = await runCli([...args, "--root", root], root);
    if (result.exitCode !== 0) throw new Refused(ref, `clossys ${args.filter(arg => !arg.startsWith(scratch)).join(" ")}: ${result.message}`);
    return result;
  };
  const skillOf = agent => STEPS.find(step => step.id === `${agent}.candidates`).command.skill;
  return { root, consumer, file, run, skillOf };
}

/** The slot's direct inputs and uses (its pinned upstream), agent-qualified. */
function upstream(consumer, agent, id) {
  const doc = readSlot(consumer, agent, id);
  return { doc, deps: [...new Set([...(doc.inputs ?? []), ...(doc.uses ?? [])])].filter(dep => dep !== id) };
}

const agentOf = (consumer, id) => readdirSync(join(consumer, "agents")).find(agent => existsSync(join(consumer, "agents", agent, id, "slot.json")));

/** Every slot the targets read, dependencies first (a pin's pinSet is its upstream's pins). */
export function closure(consumer, targets = TARGETS) {
  const order = [], seen = new Set();
  const visit = ref => {
    if (seen.has(ref)) return;
    seen.add(ref);
    const [agent, id] = ref.split("/");
    for (const dep of upstream(consumer, agent, id).deps) {
      const owner = agentOf(consumer, dep);
      if (!owner) throw new Error(`${ref} reads ${dep}, which no slot folder holds`);
      visit(`${owner}/${dep}`);
    }
    order.push(ref);
  };
  for (const target of targets) visit(target);
  return order;
}

// ---------------------------------------------------------------- content generators

/** The fixture's one made-up evidence finding (in the base). */
const FINDING = "finding:fixture-segment-draft";

const DIRECTION_VALUE = {
  Sound: "Calm and direct, like a capable neighbour explaining a plan",
  Do: "Lead with the outcome, then give one plain next step",
  Never: "Never pressure the reader or promise results the service cannot show",
  Promise: "Your site stays current without waiting on a developer",
  For: "Owners of small service businesses who edit their own website",
  Versus: "Agencies that hold every change in a queue for days",
  Essence: "Plain help that keeps a small business moving",
  Meaning: "Every page answers what the visitor came to do",
  Not: "Not a design studio and not an agency retainer",
  Where: "English-speaking towns where owners run the business themselves",
  "Not-yet": "Large cities with agency-led markets",
  Why: "Owners there edit their own pages and ask for fewer meetings",
  Language: "English only, with a friendly everyday register",
  Date: "2027-01-01",
};
const valueOf = key => DIRECTION_VALUE[key] ?? `Only small service businesses that edit their own site, for ${key.toLowerCase().replace(/-/g, " ")}`;

/** A Director brief (brief.profile, list, statement, measure): one Direction line per contract key, cited reasons, a testable watch. */
function brief(consumer, id, doc) {
  const keys = (doc.contract?.mustContain ?? []).map(item => item.key);
  const inputs = (doc.inputs ?? []).filter(dep => dep !== id).map(dep => `director:${dep}`);
  const refs = [FINDING, ...inputs];
  const direction = keys.map(key => `- ${key}: ${valueOf(key)}`);
  if (doc.standard === "brief.profile" && !keys.some(key => /^(?:Not|Never|Avoid)/.test(key))) direction.push("- Not: Never agencies or enterprise teams with an in-house web group");
  const because = [
    `- The fixture finding names small service businesses as the first group to serve (${FINDING}).`,
    ...inputs.map(ref => `- This direction follows the pinned upstream brief it reads (${ref}).`),
  ];
  return [
    "---",
    `slot: ${JSON.stringify(id)}`,
    `source: ${JSON.stringify({ kind: "derived", ref: refs })}`,
    "feeds: []",
    "functions: []",
    "---",
    "## Direction",
    ...direction,
    "",
    "## Because",
    ...because,
    "",
    "## Watch",
    "- If matching fixture sites fall below 3 in any quarter, then revisit this brief.",
    "",
  ].join("\n");
}

// Writer: every value derives from the pinned voice, which the candidate names as provenance (provenance.voice,
// copy.voice-derived), never as an input, and from the slot's upstream pins (copy.derived-upstream); a lexicon slot holds
// json records, a copy slot plain values within the contract's limits.

const VOICE = "director:identity.verbal.voice";

/**
 * The lexicon records of each fixture lexicon slot (key -> record fields past id, context and kind). The keys are the
 * slot's contract fixture keys, which the Writer catalog ships (src/catalog/ia/voice.json `contract.fixture`), and a
 * closed fixture holds no other key (certify/strings.ts).
 */
const LEXICON = {
  "lexicon.formality": { kind: "voice-rule", records: { byLocale: { rule: "Use a neutral everyday register and address the reader as you", value: { en: { register: "neutral", address: "informal-you" } } } } },
  "lexicon.warmth": { kind: "voice-rule", records: { level: { rule: "Sound like a capable neighbour, never a salesperson", value: "warm" } } },
  "lexicon.energy": { kind: "voice-rule", records: { level: { rule: "Keep a steady pace", value: "steady" }, maxExclamationsPer1k: { rule: "Use no exclamation marks", value: 0 } } },
  "lexicon.person": { kind: "voice-rule", records: { point: { rule: "Write in the second person to the owner", value: "second" } } },
  "lexicon.mood": { kind: "voice-rule", records: { byRole: { rule: "Use the imperative for actions and the indicative for facts", value: { action: "imperative", body: "indicative" } } } },
  "lexicon.sentence-length": { kind: "voice-rule", records: { byLocale: { rule: "Keep a sentence to twenty words or fewer", value: { en: { maxWords: 20 } } } } },
  "lexicon.reading-level": { kind: "voice-rule", records: { maxGrade: { rule: "Write for a grade seven reader", value: { en: 7 } } } },
  "lexicon.capitalization": { kind: "format", records: { byRole: { format: "sentence-case", value: "headings, labels and actions" }, exceptionsFrom: { format: "name-casing", value: "director/identity.naming.name#Casing" } } },
  "lexicon.punctuation": { kind: "format", records: { byLocale: { format: "terminal-period", value: "body sentences only, never headings or labels" } } },
  "lexicon.preferred-terms": { kind: "term", records: { terms: { term: "site", forms: ["site", "sites"], termStatus: "preferred", reason: "the plain word owners already use" } } },
  "lexicon.avoid-terms": { kind: "term", records: { terms: { term: "leverage", forms: ["leverage", "leveraging"], termStatus: "avoid", reason: "jargon the voice never uses" } } },
  "lexicon.avoid-patterns": { kind: "pattern-rule", records: { patterns: { pattern: { source: "\\bclick here\\b", flags: "i" }, severity: "warning", reason: "names the gesture, not the destination" } } },
};

/** The fixture copy of each copy slot (key -> English value), and the pin-map record a records contract places it in. */
const COPY = {
  "publication.site.meta": { siteName: "Fixture Works", "share.title": "Fixture Works keeps small business sites current", "share.description": "Plain help for owners who edit their own website and want every change live the same day." },
  "page.home.meta": { title: "Keep your site current without waiting", description: "Edit your own pages, publish the same day and keep every change in plain view." },
  "frames.site-header.copy": { "skip.label": "Skip to content", "navigation.label": "Main navigation", "navigation.open": "Open menu", "navigation.close": "Close menu" },
};

/** The derived source of a Writer candidate: every upstream pin the slot reads (its inputs, R07.1). */
function writerSource(consumer, doc, id) {
  const refs = [...new Set(upstream(consumer, "writer", id).deps.map(dep => `${agentOf(consumer, dep)}:${dep}`))];
  return { kind: "derived", ref: refs };
}

/**
 * A Writer Markdown candidate: frontmatter (slot, locales, reason, source, provenance) and one en section of `### <key>`
 * entries. provenance.voice names the pinned voice the copy derives from; it is provenance, not an input.
 */
function writerDoc(consumer, id, doc, reason, entries) {
  return [
    "---",
    `slot: ${JSON.stringify(id)}`,
    `locales: ${JSON.stringify(["en"])}`,
    `reason: ${JSON.stringify(reason)}`,
    `source: ${JSON.stringify(writerSource(consumer, doc, id))}`,
    `provenance: ${JSON.stringify({ voice: VOICE })}`,
    "---",
    "## en",
    "",
    ...entries.flatMap(([key, value]) => [`### ${key}`, `<!-- ${JSON.stringify({ id: key, bindings: [] })} -->`, value, ""]),
  ].join("\n");
}

function lexicon(consumer, id, doc) {
  const spec = LEXICON[id];
  if (!spec) throw new Error(`no fixture lexicon for writer/${id}`);
  const entries = Object.entries(spec.records).map(([key, fields]) => [key, `\`\`\`json\n${JSON.stringify({ id: key, context: key, kind: spec.kind, ...fields })}\n\`\`\``]);
  return writerDoc(consumer, id, doc, `Realises ${VOICE} as a rule the copy checks can apply.`, entries);
}

function copy(consumer, id, doc) {
  const values = COPY[id];
  if (!values) throw new Error(`no fixture copy for writer/${id}`);
  return writerDoc(consumer, id, doc, `Realises ${VOICE} for the pinned promise, within the contract limits.`, Object.entries(values));
}

const CREATE = "fixture world: a synthetic consumer, so its copy is written from its own pinned upstream";

/**
 * The contract fixture a lexicon slot lacks: `migrate contracts` leaves it a gap (the package does not determine a
 * consumer's record keys), so the consumer states it with `clossys ia --contract`. Undefined when the slot holds one.
 */
function lexiconContract(id, doc) {
  if (!doc.standard.startsWith("lexicon.") || doc.contract?.fixture !== undefined) return undefined;
  return { ...doc.contract, fixture: { keys: Object.keys(LEXICON[id]?.records ?? {}), locales: ["en"] } };
}

// Designer: every candidate is a shadcn-format registry item that starts from a reference-manifest row (the
// Designer's vendored, hashed references) and says which pinned Director trait it realises (derive.director).

const REFERENCES = join(PRODUCER, "..", "designer", "references");
let manifestRows;
/** The reference-manifest rows (packages/designer/references/manifest.json). */
const manifest = () => manifestRows ??= JSON.parse(readFileSync(join(REFERENCES, "manifest.json"), "utf8")).items;
/** The manifest row named `<registry>/<name>`, or the one that maps `slot` (of `registries` when given). */
function referenceOf({ slot, item, registries }) {
  const rows = manifest().filter(row => item ? `${row.registry}/${row.name}` === item : (row.slots ?? []).includes(slot) && (!registries || registries.includes(row.registry)));
  if (rows.length !== 1) throw new Error(`the reference manifest holds ${rows.length} row(s) for ${item ?? slot}`);
  return rows[0];
}
const refId = row => `${row.registry}/${row.name}@${row.version}`;
/** A vendored reference file's text (verbatim). */
const referenceText = (row, path) => readFileSync(join(REFERENCES, row.dir, path), "utf8");
/** `meta.source` over a manifest row: the row id, its hash and licence. */
const sourceFrom = (kind, row, parts = []) => ({ kind, ref: [refId(row), ...parts.map(refId)], hash: row.hash, license: row.license });

/** The Director traits a standard's derive.director names, those the slot reads, cited in a reason. */
function designerReason(standard, doc, what) {
  const params = (standard.doc.requirements ?? []).find(item => item.check === "derive.director")?.params ?? {};
  const inputs = new Set(doc.inputs ?? []);
  const cited = [...new Set([...(params.traits ?? []).filter(id => inputs.has(id)), ...(params.required ?? [])])];
  if (!cited.length && inputs.has("identity.visual.style")) cited.push("identity.visual.style");
  if (!cited.length) return `${what[0].toUpperCase()}${what.slice(1)}.`;
  return `Realises ${cited.map(id => `director:${id}`).join(", ")}: ${what}.`;
}

/** The CSS custom properties of a vendored stylesheet (`--name: value;`). */
const cssVarsOf = text => Object.fromEntries([...text.matchAll(/^\s*--([\w-]+):\s*([^;]+);/gm)].map(match => [match[1], match[2].trim()]));

/**
 * A token candidate (token.color, token.scale, token.typeface): its DTCG file `clossys/<slot>.json` holds one member
 * per contract member, valued from the reference row the manifest maps the slot to (the shadcn neutral preset, the
 * Tailwind theme or the font provider), with every contract mode and the source variable as provenance.
 */
function token(id, doc, standard) {
  const leaf = id.split(".").at(-1);
  const contract = doc.contract;
  const row = referenceOf({ slot: id });
  const modes = contract.modes ?? ["light"];
  const names = contract.members?.names ?? ["default"];
  const valueOf = (variable, mode) => {
    const name = variable.replace(/^--/, "");
    if (row.registry === "shadcn" && row.name === "neutral") {
      const preset = JSON.parse(referenceText(row, "neutral.json"));
      return preset.cssVars?.[mode]?.[name] ?? preset.cssVars?.theme?.[name] ?? preset.cssVars?.light?.[name];
    }
    if (row.registry === "tailwindcss") return cssVarsOf(referenceText(row, row.files[0].path))[name];
    if (row.type === "registry:font") {
      const meta = JSON.parse(referenceText(row, "metadata.json"));
      const family = meta.family ?? meta.name;
      return `"${family}", ${meta.category === "serif" ? "ui-serif, Georgia, serif" : meta.category === "monospace" ? "ui-monospace, monospace" : "ui-sans-serif, system-ui, sans-serif"}`;
    }
    return undefined;
  };
  const members = {}, cssVars = Object.fromEntries(modes.map(mode => [mode, {}]));
  for (const member of names) {
    const variable = contract.emit?.[member] ?? `--${leaf}${member === "default" ? "" : `-${member}`}`;
    const values = Object.fromEntries(modes.map(mode => [mode, valueOf(variable, mode)]));
    for (const [mode, value] of Object.entries(values)) if (typeof value !== "string") throw new Refused(`designer/${id}`, `${refId(row)} holds no ${mode} value for ${variable}`);
    const [first, ...rest] = modes;
    members[member] = {
      $type: contract.$type,
      $value: values[first],
      $extensions: {
        "com.clossys.css": { raw: values[first] },
        ...(rest.length ? { "com.clossys.modes": Object.fromEntries(rest.map(mode => [mode, values[mode]])) } : {}),
        "com.clossys.provenance": { sourceLabel: row.registry, sourceVariable: variable },
      },
    };
    for (const mode of modes) cssVars[mode][variable.replace(/^--/, "")] = values[mode];
  }
  const file = { themes: { [leaf]: members } };
  const item = {
    name: leaf,
    type: "registry:theme",
    files: [{ path: `clossys/${id}.json`, type: "registry:file", content: `${JSON.stringify(file, null, 2)}\n` }],
    cssVars,
    meta: {
      slot: id,
      source: sourceFrom("derived", row),
      element: { slot: id, reason: designerReason(standard, doc, `the ${refId(row)} value, kept as the fixture's base`) },
    },
  };
  return { ext: "json", body: `${JSON.stringify(item, null, 2)}\n`, rung: "L4", reason: DESIGNER_CREATE };
}

const DESIGNER_CREATE = "fixture world: a synthetic consumer, so the craft standard's candidate is made from its reference and pinned upstream";

/** A glyph candidate (asset.glyph): the lucide icon the manifest maps the slot to, its drawing verbatim. */
function glyph(id, doc, standard) {
  const leaf = id.split(".").at(-1);
  const row = referenceOf({ slot: id, registries: ["lucide"] });
  const files = row.files.filter(file => file.path.endsWith(".svg")).map(file => ({ path: `assets/${leaf}.svg`, type: "registry:file", content: referenceText(row, file.path) }));
  const item = {
    name: leaf, type: "registry:file", files,
    meta: { slot: id, source: sourceFrom("registry", row), element: { slot: id, reason: designerReason(standard, doc, `the ${refId(row)} drawing, unchanged`) } },
  };
  return { ext: "json", body: `${JSON.stringify(item, null, 2)}\n`, rung: "L4", reason: DESIGNER_CREATE };
}

/**
 * The fixture's own artwork in the current colour: the mark is a rounded square with an inner bar, the lockup the
 * mark beside a three-bar word shape; each contract member draws at its own weight, at least 1px at 16px.
 */
function markSvg(leaf, member, label) {
  const weight = { mono: "2", positive: "2.25", reversed: "2.5" }[member] ?? "2.25";
  const stroke = `fill="none" stroke="currentColor" stroke-width="${weight}" stroke-linecap="round"`;
  const drawing = leaf === "lockup"
    ? ["0 0 32 16", `  <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" ${stroke}/>`, `  <path d="M5 8h6M18 4.5h12M18 8h9M18 11.5h11" ${stroke}/>`]
    : ["0 0 24 24", `  <rect x="3" y="3" width="18" height="18" rx="5" ${stroke}/>`, `  <path d="M8 12h8" ${stroke}/>`];
  return [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${drawing[0]}" role="img" aria-label="${label}">`, ...drawing.slice(1), "</svg>", ""].join("\n");
}

let provenanceRule;
/** Whether the Designer provenance rule lists the slot as a consumer asset (an original is allowed only there). */
function consumerOwned(id) {
  provenanceRule ??= JSON.parse(readFileSync(join(PRODUCER, "..", "designer", "src", "catalog", "rules", "provenance.json"), "utf8"));
  return provenanceRule.consumerAssets.slots.includes(id);
}

/** A consumer-asset candidate (asset.logo-mark, asset.media-rule in a consumer-asset slot): the consumer's own original. */
function consumerAsset(id, doc, standard) {
  const leaf = id.split(".").at(-1);
  const contract = doc.contract;
  const label = "Fixture Works";
  const svg = contract.valueKind === "svg";
  const files = svg
    ? (contract.members?.names ?? ["positive"]).map(member => ({ path: `assets/${leaf}-${member}.svg`, type: "registry:file", content: markSvg(leaf, member, label) }))
    : [{ path: `clossys/${id}.json`, type: "registry:file", content: `${JSON.stringify({ assets: { [leaf]: { default: { $type: "rules", $value: { aspect: "16/9", fit: "cover", focal: "center" } } } } }, null, 2)}\n` }];
  const item = {
    name: leaf, type: "registry:file", files,
    meta: { slot: id, source: consumerOwned(id) ? { kind: "original", ref: [], license: "CC0-1.0" } : sourceFrom("derived", referenceOf({ slot: id })), element: { slot: id, reason: designerReason(standard, doc, "the fixture consumer's own plain artwork") } },
  };
  return { ext: "json", body: `${JSON.stringify(item, null, 2)}\n`, rung: "L4", reason: DESIGNER_CREATE };
}

/**
 * The consumer-supplied component slots (provenance.json consumerAssets) whose contract declares no fixture: the
 * consumer's own placeholder, and the minimal contract fixture (clossys.element-preview/1) that mounts it. The icon
 * set is the lucide-react package, re-exported as an npm candidate (one named re-export).
 */
const CONSUMER_COMPONENTS = {
  "components.icon": { file: "ui/icon.tsx", export: "Icon", source: () => npmSource("lucide-react"), content: 'export { ArrowRight as Icon } from "lucide-react";\n' },
  "components.logo": { file: "ui/logo.tsx", export: "Logo", source: () => ORIGINAL, content: [
    'import type { SVGProps } from "react";',
    "",
    "export function Logo(props: SVGProps<SVGSVGElement>) {",
    "  return (",
    '    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-label="Fixture Works" {...props}>',
    '      <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="2.25" />',
    '      <path d="M8 12h8" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />',
    "    </svg>",
    "  );",
    "}",
    "",
  ].join("\n") },
  "components.semantic-content": { file: "ui/semantic-content.tsx", export: "SemanticContent", source: () => ORIGINAL, content: [
    'import type { ElementType, HTMLAttributes } from "react";',
    "",
    "export function SemanticContent({ as: Tag = \"div\", ...props }: HTMLAttributes<HTMLElement> & { as?: ElementType }) {",
    "  return <Tag {...props} />;",
    "}",
    "",
  ].join("\n") },
};
/** The consumer's own code (a consumer-asset slot only: R03.2 and ref-verbatim refuse an original anywhere else). */
const ORIGINAL = { kind: "original", ref: [], license: "MIT" };
/** An npm package source: `npm/<name>@<installed version>`, hashed over the installed package.json, with its licence. */
function npmSource(name) {
  const version = lockedVersion(name);
  const manifestFile = join(REPO, "node_modules", name, "package.json");
  const hash = `sha256:${createHash("sha256").update(readFileSync(manifestFile)).digest("hex")}`;
  return { kind: "npm", ref: [`npm/${name}@${version}`], hash, license: JSON.parse(readFileSync(manifestFile, "utf8")).license };
}
/** The contract a consumer-supplied component slot takes: its own, with the minimal fixture that mounts the placeholder. */
function consumerComponentContract(id, doc) {
  const made = CONSUMER_COMPONENTS[id];
  if (!made || doc.contract?.fixture || !consumerOwned(id)) return undefined;
  return { ...doc.contract, fixture: { schema: "clossys.element-preview/1", fixtures: { file: made.file, export: made.export, props: {} } } };
}
/** A consumer-supplied component candidate: the consumer's own placeholder file, an original source. */
function consumerComponent(root, id, doc, standard) {
  const made = CONSUMER_COMPONENTS[id];
  const files = [{ path: made.file, type: "registry:ui", content: made.content }];
  const item = {
    name: id.split(".").at(-1), type: "registry:ui",
    dependencies: declare(root, `designer/${id}`, files),
    files,
    meta: { slot: id, source: made.source(), element: { slot: id, reason: designerReason(standard, doc, "the fixture consumer's own plain placeholder") } },
  };
  return { ext: "json", body: `${JSON.stringify(item, null, 2)}\n`, rung: "L4", reason: DESIGNER_CREATE };
}

// ---------------------------------------------------------------- consumer setup

export const REPO = resolve(PRODUCER, "..", "..");
let repoLock;
/** The repository lockfile's installed version of a package (what the certifier's host require resolves). */
function lockedVersion(name) {
  repoLock ??= JSON.parse(readFileSync(join(REPO, "package-lock.json"), "utf8")).packages;
  return repoLock[`node_modules/${name}`]?.version;
}
const HOST = new Set(["react", "react-dom"]);
/** The npm packages a file imports (bare specifiers, by package name), the host's React aside. */
function importedPackages(text) {
  const names = new Set();
  for (const match of text.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\sfrom\s+)?["']([^"']+)["']/g)) {
    const spec = match[1];
    if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@/")) continue;
    const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    if (!HOST.has(name)) names.add(name);
  }
  return [...names].sort();
}
/**
 * `<name>@<version>` for every package the files import, at the version the repository installs; the consumer
 * lockfile (its root package-lock.json, R06.1) gains each, as an install of the adopted item would.
 */
function declare(root, slot, files) {
  const names = [...new Set(files.flatMap(file => importedPackages(file.content)))].sort();
  const path = join(root, "package-lock.json");
  const lock = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { name: "fixture-consumer", lockfileVersion: 3, requires: true, packages: { "": {} } };
  const entries = new Map(Object.entries(lock.packages));
  for (const name of [...HOST, ...names]) {
    const version = lockedVersion(name);
    if (!version) throw new Refused(slot, `${name} is imported but the repository installs no version of it`);
    entries.set(`node_modules/${name}`, { version });
  }
  const packages = Object.fromEntries([...entries].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b))));
  writeFileSync(path, `${JSON.stringify({ ...lock, packages }, null, 2)}\n`);
  return names.map(name => `${name}@${lockedVersion(name)}`);
}

/**
 * The consumer's clossys/components.json, from the Designer flavor's one writer (check-generated-derived). The
 * run stages in a temporary root, but its output is the fixture: the stylesheet path is relative to the fixture's
 * clossys/ folder, so every pass writes the same bytes wherever it stages.
 */
async function setup(root) {
  const { writeFlavor } = await import("./check-generated-derived.mjs");
  writeFlavor(join(root, "clossys"), join(FIXTURE, "clossys"));
}

/**
 * A component candidate (component, adopt-first): L1 adopts the stock reference item the slot's preview fixture
 * names, its code byte-exact to the normalized reference (R03.4 and ref-verbatim: the reference file normalized
 * to the consumer's components.json; meta.refVerbatim.files maps each shipped file to the reference file).
 */
function component(root, consumer, id, doc, standard) {
  const file = doc.contract?.fixture?.fixtures?.file;
  const rows = file ? manifest().filter(row => row.files.some(each => each.path === file) && ["shadcn-aria", "diceui"].includes(row.registry)) : [];
  const row = rows.find(each => (each.slots ?? []).includes(id)) ?? rows.find(each => each.name === file.split("/").at(-1).replace(/\.tsx$/, "")) ?? rows[0];
  if (!row) throw new Refused(`designer/${id}`, `no stock reference item ships the contract fixture ${file ?? "(none)"}`);
  const files = row.files.filter(each => each.path.endsWith(".tsx")).map(each => ({ path: each.path, type: row.type, content: normalizedSeedFile(consumer, refId(row), each.path, { manifest: { items: manifest() }, referencesDir: REFERENCES }) }));
  const code = files;
  const item = {
    name: id.split(".").at(-1),
    type: row.type,
    dependencies: declare(root, `designer/${id}`, files),
    files,
    meta: {
      slot: id,
      source: sourceFrom("registry", row),
      refVerbatim: { files: Object.fromEntries(code.map(each => [each.path, each.path])) },
      element: { slot: id, reason: designerReason(standard, doc, `stock ${refId(row)}, adopted unmodified`) },
    },
  };
  return { ext: "json", body: `${JSON.stringify(item, null, 2)}\n`, rung: "L1", seed: `${row.registry}/${row.name}` };
}

/**
 * The consumer's own hero (planner ruling D3, 2026-11-20): Foundry authors no site section, so the seeder reuses the
 * scripted candidate file `clossys check --e2e` already ships (e2e/scenario.json craft.hero), byte for byte, at that
 * scenario's rung, through the same craft verbs. The slot is BLOCKED today with the contract gap the shipped file
 * leaves; this generator fills it as soon as its BLOCKED entry goes. (The frames are composed: COMPOSED_FRAMES.)
 */
const SHIPPED_CRAFT = { "sections.hero": "hero.json" };
function shippedCraft(id) {
  const step = JSON.parse(readFileSync(join(PRODUCER, "e2e", "scenario.json"), "utf8")).steps.find(each => each.craft?.ref === `designer/${id}`);
  if (!step || step.craft.file !== SHIPPED_CRAFT[id]) throw new Error(`e2e/scenario.json crafts no designer/${id} from ${SHIPPED_CRAFT[id]}`);
  return { ext: "json", body: readFileSync(join(PRODUCER, "e2e", step.craft.file), "utf8"), rung: step.craft.rung, reason: "fixture world: the consumer's own crafted element, the scripted candidate `clossys check --e2e` ships" };
}

/** The stock registries (source ladder L1); every other registry a standard's source.ref admits is a partner (L2). */
const STOCK = ["shadcn-aria", "shadcn"];

/**
 * A frame candidate (frame, craft): the reference item whose files ship the slot's contract fixture, climbing the
 * source ladder (stock first, then a partner registry the standard's source.ref admits): its code is the reference
 * file normalized to the consumer's components.json, adopted at L1 (stock) or L2 (partner) with the item as seed.
 */
function frame(root, consumer, id, doc, standard) {
  const file = doc.contract?.fixture?.fixtures?.file;
  const admitted = (standard.doc.requirements ?? []).find(item => item.check === "source.ref")?.params?.registries ?? [];
  const rank = row => (STOCK.includes(row.registry) ? 0 : 1);
  const rows = file ? manifest().filter(row => admitted.includes(row.registry) && (row.slots ?? []).includes(id) && row.files.some(each => each.path === file)).sort((a, b) => rank(a) - rank(b)) : [];
  const row = rows[0];
  if (!row) throw new Refused(`designer/${id}`, `no admitted reference item ships the contract fixture ${file ?? "(none)"}`);
  const files = row.files.filter(each => each.path === file).map(each => ({ path: each.path, type: "registry:component", content: normalizedSeedFile(consumer, refId(row), each.path, { manifest: { items: manifest() }, referencesDir: REFERENCES }) }));
  const item = {
    name: id.split(".").at(-1),
    type: "registry:block",
    dependencies: declare(root, `designer/${id}`, files),
    files,
    meta: {
      slot: id,
      source: sourceFrom("registry", row),
      refVerbatim: { files: Object.fromEntries(files.map(each => [each.path, each.path])) },
      element: { slot: id, reason: designerReason(standard, doc, `${STOCK.includes(row.registry) ? "stock" : "partner"} ${refId(row)}, adopted unmodified`) },
    },
  };
  return { ext: "json", body: `${JSON.stringify(item, null, 2)}\n`, rung: STOCK.includes(row.registry) ? "L1" : "L2", seed: `${row.registry}/${row.name}` };
}

/**
 * The frames no admitted reference item fills, so each is crafted (create.frame, rung L4) as a composition of the
 * consumer's pinned stock components (registry or npm lineage; an original such as the logo is no part):
 * - frames.site-header: the one partner header (tailark-oss mist header) is radix-flavored (asChild), which the
 *   consumer's aria engine refuses (REF-FLAVOR), and no stock item ships a header;
 * - frames.site-shell: no reference item ships a shell (its references are its parts'), so it is composed (SSC).
 * The shell places its header and footer as host nodes, not as the frames.site-header and frames.site-footer parts:
 * its contract's header and footer slots accept host-node (REF-COMP-LANDMARK), so a composed header with no
 * <header> of the shell's own leaves no banner, and wrapping the header frame's <header> in one nests a banner;
 * frames.site-footer is a stock adopt (registry lineage), and a composition places only pinned composed frames
 * (REF-COMP-PART). Publisher chrome mounts the header frame into the shell's header slot.
 * Each slot's `uses` are its parts (REF-COMP-USES): every part must be imported (REF-COMP-UNUSED) and stock
 * (REF-COMP-PART), and the package uses include parts no composition may place (the logo and semantic-content are
 * originals, the icon fails ref-verbatim, progress and toast are not in the component layer).
 * Each copy string is a prop (REF-COMP-COPY) and each raw element unstyled (REF-COMP-MARKUP). The fixture of a
 * composed slot is the consumer's own (ia sync keeps it), so the seeder declares it mounting the composed file.
 */
const COMPOSED_FRAMES = {
  "frames.site-header": {
    file: "registry/frames/site-header.tsx",
    parts: ["components.button", "components.dialog"],
    code: `import { Button, LinkButton } from "@/components/ui/button";
import { Dialog, DialogClose, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export interface SiteHeaderLink {
  href: string;
  label: string;
}

export function SiteHeader({ skipLabel, navigationLabel, navigationOpen, navigationClose, brand, links = [], actions, children }: {
  skipLabel?: string;
  navigationLabel?: string;
  navigationOpen?: string;
  navigationClose?: string;
  brand?: React.ReactNode;
  links?: SiteHeaderLink[];
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const items = links.map(link => <LinkButton key={link.href} href={link.href} variant="ghost">{link.label}</LinkButton>);
  return (
    <header>
      <LinkButton href="#main-content" variant="link">{skipLabel}</LinkButton>
      {brand}
      <nav aria-label={navigationLabel}>{items}</nav>
      <DialogTrigger>
        <Button variant="outline">{navigationOpen}</Button>
        <Dialog showCloseButton={false}>
          <DialogTitle>{navigationLabel}</DialogTitle>
          <nav aria-label={navigationLabel}>{items}</nav>
          <DialogClose>{navigationClose}</DialogClose>
        </Dialog>
      </DialogTrigger>
      {actions}
      {children}
    </header>
  );
}
`,
  },
  "frames.site-shell": {
    file: "registry/frames/site-shell.tsx",
    parts: ["components.separator"],
    code: `import { Separator } from "@/components/ui/separator";

export function SiteShell({ skipLink, progress, consent, header, footer, toasts, children }: {
  skipLink?: React.ReactNode;
  progress?: React.ReactNode;
  consent?: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  toasts?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div>
      {skipLink}
      {progress}
      {consent ? <section>{consent}</section> : null}
      <header>{header}</header>
      <Separator />
      <main id="main-content" tabIndex={-1}>{children}</main>
      <Separator />
      <footer>{footer}</footer>
      {toasts ? <section>{toasts}</section> : null}
    </div>
  );
}
`,
  },
};

/** The paths a pinned stock part's pin vendors (a registry item's refVerbatim files, an npm item's code files). */
function vendored(consumer, slot) {
  const pin = JSON.parse(readFileSync(join(consumer, "agents", "designer", slot, "pin.json"), "utf8"));
  const { content } = JSON.parse(readFileSync(join(consumer, "agents", "designer", slot, "candidates", pin.candidate), "utf8"));
  const files = content.meta?.refVerbatim?.files;
  return files ? Object.values(files) : content.files.filter(file => /\.(tsx|ts)$/.test(file.path)).map(file => file.path);
}

/** The one component a composed frame's code exports. */
const composedExport = code => {
  const named = [...code.matchAll(/^export function (\w+)/gm)].map(match => match[1]);
  if (named.length !== 1) throw new Error(`a composed frame exports ${named.length} components; the fixture mounts one`);
  return named[0];
};

/** A composed frame's contract (its own, the fixture repointed to the composed file and export, props kept) and uses. */
function composedFrameContract(id, doc) {
  const spec = COMPOSED_FRAMES[id];
  if (!spec) return undefined;
  const fixtures = { ...doc.contract.fixture.fixtures, file: spec.file, export: composedExport(spec.code) };
  return { contract: { ...doc.contract, fixture: { ...doc.contract.fixture, fixtures } }, uses: spec.parts };
}

/** A composed frame candidate (create.frame, L4): one file installed under components/frames, its parts the pins'. */
function composedFrame(root, consumer, id, doc, standard) {
  const spec = COMPOSED_FRAMES[id];
  const files = [{ path: spec.file, type: "registry:component", target: `components/frames/${spec.file.split("/").at(-1)}`, content: spec.code }];
  const reason = `fixture world: no admitted reference item fills ${id}, so it is composed from the consumer's pinned stock ${spec.parts.join(", ")}`;
  const item = {
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
    name: id.split(".").at(-1),
    type: "registry:block",
    dependencies: declare(root, `designer/${id}`, files),
    files,
    meta: {
      slot: id,
      source: { kind: "composition", ref: [], license: "MIT", parts: spec.parts.map(slot => ({ slot, files: vendored(consumer, slot) })) },
      element: { slot: id, reason: designerReason(standard, doc, `composed from the pinned stock ${spec.parts.join(", ")}`) },
    },
  };
  return { ext: "json", body: `${JSON.stringify(item, null, 2)}\n`, rung: "L4", reason };
}

// Publisher: a chrome candidate is a clossys.page/1 record (the page family) that places only what its contract
// names: the frame, the unit it frames and that unit's Writer copy, every value a Writer key (no inline copy).

/** A slot id without its agent (`designer/frames.site-shell` -> `frames.site-shell`), the form a page record names. */
const bare = ref => ref.split("/").at(-1);

/**
 * A chrome candidate (chrome, craft): one frame (the contract's frame) plus the unit it frames (the contract's unit),
 * each copy field of the unit's contract bound to the key of the same name in the contract's Writer copy slot, and a
 * derived source citing every input (R07.1). The page family requires a title; it is the unit's navigation label key.
 */
function chrome(consumer, id, doc) {
  const contract = doc.contract ?? {};
  if (typeof contract.frame !== "string" || typeof contract.unit !== "string" || typeof contract.copy !== "string") throw new Refused(`publisher/${id}`, "the chrome contract names no frame, unit and copy");
  const unit = readSlot(consumer, contract.unit.split("/")[0], bare(contract.unit));
  const copySlot = bare(contract.copy.split("#")[0]);
  const keys = (unit.contract?.copy?.fields ?? []).map(field => field.key);
  if (!keys.includes("navigation.label")) throw new Refused(`publisher/${id}`, `${contract.unit} declares no navigation.label copy field`);
  const record = {
    schema: "clossys.page/1",
    slug: id.split(".").at(-1),
    title: `${copySlot}#navigation.label`,
    frame: bare(contract.frame),
    sections: [bare(contract.unit)],
    copy: Object.fromEntries(keys.map(key => [key, `${copySlot}#${key}`])),
    meta: { source: { kind: "derived", ref: (doc.inputs ?? []).map(dep => `${agentOf(consumer, dep)}:${dep}`) } },
  };
  return { ext: "json", body: `${JSON.stringify(record, null, 2)}\n`, rung: "create", reason: "fixture world: a synthetic consumer, so its chrome is assembled from its own pinned frame, unit and copy" };
}

/**
 * A chrome slot's contract with the fixture the page certifier judges it by (R05.1): the package IA places chrome
 * with no fixture, and a chrome record names no path, so the sample route is the site's root, which every page the
 * chrome frames shares.
 */
function chromeContract(id, doc) {
  if (doc.standard !== "chrome" || doc.contract?.fixture !== undefined) return undefined;
  return { ...doc.contract, fixture: { route: { path: "/" } } };
}

/** The candidate a slot's standard takes, with its extension and the ladder rung it comes in on. */
function candidateOf(root, consumer, agent, id, doc, standard) {
  if (agent === "designer") {
    if (doc.standard.startsWith("token.")) return token(id, doc, standard);
    if (doc.standard === "asset.glyph") return glyph(id, doc, standard);
    if (doc.standard === "asset.logo-mark" || doc.standard === "asset.media-rule") return consumerAsset(id, doc, standard);
    if (doc.standard === "component" && CONSUMER_COMPONENTS[id] && consumerOwned(id)) return consumerComponent(root, id, doc, standard);
    if (doc.standard === "component" && doc.contract?.fixture) return component(root, consumer, id, doc, standard);
    if (SHIPPED_CRAFT[id]) return shippedCraft(id);
    if (COMPOSED_FRAMES[id]) return composedFrame(root, consumer, id, doc, standard);
    if (doc.standard === "frame") return frame(root, consumer, id, doc, standard);
  }
  if (agent === "director") return { ext: "md", body: brief(consumer, id, doc), rung: "create", reason: "fixture world: the brief standards are create-only and no package default fits a synthetic consumer" };
  if (agent === "writer") {
    // A copy slot pins per record (records/pin-map.ts), a record's candidate is named for it, and every candidate's
    // stem is the slot leaf (R08.1): the one record a submitted copy candidate can fill is the leaf.
    const lexiconSlot = doc.standard.startsWith("lexicon.");
    const body = lexiconSlot ? lexicon(consumer, id, doc) : copy(consumer, id, doc);
    return { ext: "md", body, rung: "create", reason: CREATE, ...(lexiconSlot ? {} : { record: id.split(".").at(-1) }) };
  }
  if (agent === "publisher" && doc.standard === "chrome") return chrome(consumer, id, doc);
  throw new Error(`no fixture generator for ${agent}/${id} (${doc.kind}, standard ${doc.standard})`);
}

// ---------------------------------------------------------------- record migrations (through the verbs)

/**
 * The slots the base retires, in order, each with the Designer slot that takes its place (`into`), or none:
 * - link: shadcn stock ships no Link; Button's link variant covers it.
 * - media-player and status-mark (owner 2026-11-20, "retire both"): no stock item in the consumer's engine ships
 *   either, so this consumer drops them; the Writer copy of the media player goes with it.
 */
const RETIRE = {
  "designer/components.link": { into: "components.button", reason: "duplicate: shadcn stock ships no Link component; the Button link variant covers it" },
  "writer/components.media-player.copy": { into: null, reason: "not-needed: the copy of designer/components.media-player, which retires" },
  "designer/components.media-player": { into: null, reason: "not-needed: no stock media player ships in the consumer's engine; owner 2026-11-20" },
  "designer/components.status-mark": { into: null, reason: "not-needed: no stock status mark ships in the consumer's engine; owner 2026-11-20" },
};
const DROP = Symbol("drop");
/** A Designer slot id the base retires, as its replacement id, DROP (no replacement) or undefined (not retired). */
const retiredAs = id => { const hit = RETIRE[`designer/${id}`]; return hit ? hit.into ?? DROP : undefined; };
/**
 * A contract with every retired Designer slot id replaced by the slot that takes its place, or dropped from its list
 * (composes, allowedComposes, accepts and the fixture's `(<slot id>)` labels); a replacement already listed is not
 * listed twice.
 */
function withoutRetired(value) {
  if (Array.isArray(value)) {
    const out = [];
    const replaced = new Set();
    for (const each of value) {
      const next = withoutRetired(each);
      if (next === DROP) continue;
      // A replacement is listed once: it folds into the same entry listed before it, and that entry listed after it
      // (link -> button ahead of button) is not listed again.
      const changed = next !== each;
      if (out.includes(next) && (changed || replaced.has(next))) continue;
      if (changed) replaced.add(next);
      out.push(next);
    }
    return out;
  }
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, withoutRetired(each)]).filter(([, each]) => each !== DROP));
  if (typeof value !== "string") return value;
  const as = retiredAs(value);
  if (as !== undefined) return as;
  return value.replace(/\((components\.[a-z0-9.-]+)\)/g, (match, id) => { const into = retiredAs(id); return typeof into === "string" ? `(${into})` : match; });
}

/** The Designer slots with a slot.json, and their documents. */
function designerSlots(consumer) {
  const dir = join(consumer, "agents", "designer");
  return readdirSync(dir).filter(id => !id.startsWith("_") && existsSync(join(dir, id, "slot.json"))).map(id => [id, readSlot(consumer, "designer", id)]);
}

/**
 * The slots whose installed file a component's stock source imports (`@/components/ui/<name>`), when that source is
 * in the consumer's engine (shadcn-aria): the installer is the slot whose contract fixture ships `ui/<name>.tsx`. A
 * foreign-engine source (diceui is radix) is never adopted, so its imports name no use.
 */
function importedSlots(consumer, slots, id, doc) {
  const file = doc.contract?.fixture?.fixtures?.file;
  if (doc.standard !== "component" || !file) return [];
  const row = manifest().find(each => each.registry === "shadcn-aria" && each.files.some(entry => entry.path === file));
  if (!row) return [];
  const text = normalizedSeedFile(consumer, refId(row), file, { manifest: { items: manifest() }, referencesDir: REFERENCES });
  const names = [...text.matchAll(/from\s+["']@\/components\/ui\/([\w-]+)["']/g)].map(match => match[1]);
  return [...new Set(names.flatMap(name => slots.filter(([other, each]) => other !== id && retiredAs(other) === undefined && each.contract?.fixture?.fixtures?.file?.endsWith(`/ui/${name}.tsx`)).map(([other]) => other)))];
}

/**
 * The base's record migrations, run through `clossys ia --uses` and `clossys retire --slot` before any slot is seeded;
 * a migrated base passes through unchanged, so a rerun writes the same bytes.
 * 1. No Designer slot names a RETIRE slot: its `uses` and its contract name the slot that takes its place, or drop it;
 *    then each retired slot leaves the IA, in RETIRE order.
 * 2. A component's `uses` lists every slot its stock source imports (R05.1 [import]: an import from a slot that
 *    `uses` does not list is refused).
 * Then `clossys ia sync` (BR-SEED2) gives every placed slot its package contract and behaviour: the package declares
 * every stock fixture (menu and resize-handle mount their reference's own trigger or panel group,
 * REFERENCE_FIXTURE_RULES), so the seeder repins nothing itself.
 */
async function migrate(w) {
  let slots = designerSlots(w.consumer);
  for (const [id, doc] of slots) {
    if (retiredAs(id) !== undefined) continue;
    const uses = [...new Set((doc.uses ?? []).map(use => retiredAs(use) ?? use).filter(use => use !== DROP))];
    for (const use of importedSlots(w.consumer, slots, id, doc)) if (!uses.includes(use)) uses.push(use);
    const contract = withoutRetired(doc.contract);
    const sameUses = uses.length === (doc.uses ?? []).length && uses.every((use, index) => use === doc.uses[index]);
    if (sameUses && JSON.stringify(contract) === JSON.stringify(doc.contract)) continue;
    const ref = `designer/${id}`;
    await w.run(ref, "ia", ref, "--contract", w.file(`${id}.contract.json`, contract), "--uses", uses.join(","), "--at", AT);
  }
  for (const [ref, { reason }] of Object.entries(RETIRE)) {
    const [agent, id] = ref.split("/");
    if (!existsSync(join(w.consumer, "agents", agent, id, "slot.json"))) continue;
    await w.run(ref, "retire", ref, "--slot", "--by", `agent:${agent}`, "--reason", reason, "--at", AT);
  }
  await w.run("producer", "ia", "sync", "--at", AT);
}

/**
 * The store in one format, before anything else writes (foundry-build-0048 B1-STRICT): the base's Producer seats are
 * clossys.slot/1, which records.computed-match refuses. There is no `migrate slot-1-to-2` verb; `clossys migrate
 * slots --apply` runs that conversion for every slot folder, the seats included, and writes store-format.json. A
 * migrated store plans nothing, so a rerun writes the same bytes. First `clossys migrate state --apply` moves the
 * base's legacy root `.clossys/` (a scorecard and three renders) into `clossys/.state/`, the consumer layout's one state
 * folder (ENGINE-ROOT); the base records that cite those files keep their text.
 */
async function storeFormat(w) {
  await w.run("producer", "migrate", "state", "--apply");
  await w.run("producer", "migrate", "slots", "--apply", "--at", AT);
}

// ---------------------------------------------------------------- slots the real certifier refuses

/**
 * Closure slots the run cannot fill today, with why: no candidate shape passes the real verbs, or the slot's
 * standard is craft work the seeder has no generator for; or a slot left empty on purpose, because tests fill it
 * from nothing (its upstream is still seeded). The run seeds none of them, nor any slot that reads one (its R02.2
 * upstream is unpinned); the world is pinned everywhere else. A slot leaves this list when its standard or contract
 * admits a candidate and the seeder can make one, or when no test fills it from nothing.
 */
export const BLOCKED = {
  "designer/sections.hero": "contract gap R05.1 [fixture] (submit refused by the constitution guard): the shipped e2e/hero.json ships only registry/sections/hero.tsx (export SimpleHero), but the contract fixture mounts mist/blocks/hero-section/one/hero-section.tsx (export default)",
  "writer/sections.hero.copy": "left empty on purpose: the pin-gate and loop.create tests submit and pin its first candidate (header.heading, actions.primary.label) from an empty slot",
};

/** The closure slots the run leaves unpinned: BLOCKED and everything that reads one, with the blocking slot. */
export function blockedIn(consumer, order) {
  const out = new Map();
  for (const ref of order) {
    if (BLOCKED[ref]) { out.set(ref, BLOCKED[ref]); continue; }
    const [agent, id] = ref.split("/");
    const dep = upstream(consumer, agent, id).deps.map(each => `${agentOf(consumer, each)}/${each}`).find(each => out.has(each));
    if (dep) out.set(ref, `R02.2: reads ${dep}, which is unpinned`);
  }
  return out;
}

// ---------------------------------------------------------------- one slot through the verbs

const TIER = "mid";

/**
 * The tier a crafted (P2) slot runs at: the higher of its standard's craftTier and the tier of the recipe code chooses
 * for the standard (recipe.json tier, the one next --stage and next --submit refuse a run below), ranked
 * low < mid < high by RECIPE_TIERS, the guard's own order.
 */
function craftTierOf(root, agent, standardId, standard) {
  const own = standard.doc.craftTier ?? TIER;
  const recipe = craftRunRecipe([], loadRecipes(root), agent, standardId)?.doc?.tier;
  return recipe && RECIPE_TIERS.indexOf(recipe) > RECIPE_TIERS.indexOf(own) ? recipe : own;
}

async function seedSlot(w, ref) {
  const [agent, id] = ref.split("/");
  let doc = readSlot(w.consumer, agent, id);
  const composed = agent === "designer" ? composedFrameContract(id, doc) : undefined;
  const contract = agent === "writer" ? lexiconContract(id, doc)
    : agent === "designer" ? consumerComponentContract(id, doc) ?? composed?.contract
    : agent === "publisher" ? chromeContract(id, doc) : undefined;
  if (contract) {
    await w.run(ref, "ia", ref, "--contract", w.file(`${id}.contract.json`, contract), ...(composed ? ["--uses", composed.uses.join(",")] : []), "--at", AT);
    doc = readSlot(w.consumer, agent, id);
  }
  const standard = readStandard(w.root, agent, doc.standard);
  if (!standard.doc || !standard.taste) throw new Refused(ref, `standard ${doc.standard} does not read`);
  const made = candidateOf(w.root, w.consumer, agent, id, doc, standard);
  const skill = w.skillOf(agent);
  const leaf = id.split(".").at(-1);
  const candidate = `${leaf}-v1.${made.ext}`;
  const create = made.rung === "create" || made.rung === "L4" || made.rung === "adapt" || made.rung === "L3";
  const tier = create ? craftTierOf(w.root, agent, String(doc.standard ?? ""), standard) : standard.doc.craftTier ?? TIER;
  if (create) {
    const criterion = standard.taste.criteria[0].id;
    const gap = standard.doc.mode === "adopt-first" ? { id: criterion, class: standard.doc.createGaps?.[0] ?? "missing-behavior" } : { id: criterion };
    await w.run(ref, "verdict", ref, "--record", w.file(`${id}.verdict.json`, { schema: "clossys.verdict/1", slot: id, create: true, reason: made.reason, gaps: [gap] }),
      "--model", MODEL, "--tier", tier, "--by", `agent:${agent}.verdict`, "--at", AT);
    if (standard.doc.mode === "craft") {
      const craft = ["--model", MODEL, "--tier", tier, "--skill", skill];
      await w.run(ref, "next", ref, "--stage", "brief", ...craft, "--file", w.file(`${id}.brief.json`, { goal: `fixture world: fill ${id} to ${doc.standard}` }));
      // Code chooses the run's recipe (the standard's one producing recipe, R15.5); the brief records its axes, and
      // each direction takes one value on every one of them.
      const axes = briefAxes(join(w.consumer, "agents", agent, id, "ledger.json"));
      await w.run(ref, "next", ref, "--stage", "diverge", ...craft, "--file", w.file(`${id}.diverge.json`,
        ["plain", "warm", "brisk"].map((tone, index) => ({ id: `d${index + 1}`, idea: `a ${tone} reading of the slot contract`, axes: Object.fromEntries(axes.map(axis => [axis, tone])) }))));
      await w.run(ref, "next", ref, "--stage", "render", ...craft);
      const manifest = [
        { role: "taste", ref: `packages/${agent}/standards/${doc.standard}/taste.md` },
        { role: "contract", ref: `clossys/agents/${agent}/${id}/slot.json#contract` },
        { role: "render", ref: `clossys/.state/renders/${agent}/${id}/${leaf}-v1.png` },
      ];
      const scores = Object.fromEntries(standard.taste.criteria.map(item => [item.id, 4]));
      await w.run(ref, "critique", ref, "--record", w.file(`${id}.critique.json`, { schema: "clossys.critique/1", slot: id, candidate, standard: doc.standard, scores, packet: { manifest } }),
        "--model", "fixture-critic", "--tier", tier, "--at", AT);
    }
  }
  await w.run(ref, "next", ref, "--submit", w.file(`${id}.${made.ext}`, made.body), "--model", MODEL, "--tier", tier, "--basis", "agent", "--skill", skill,
    "--rung", made.rung, ...(made.seed ? ["--seed", made.seed] : []), ...(made.reason ? ["--reason", made.reason] : []));
  const target = made.record ? `${ref}#${made.record}` : ref;
  await w.run(ref, "pin", target, candidate, "--by", BY, "--at", AT);
}

// ---------------------------------------------------------------- main

const pinned = (consumer, ref) => { const [agent, id] = ref.split("/"); return existsSync(join(consumer, "agents", agent, id, "pin.json")); };

/** The fixture tree's files (relative paths), sorted; `.git` is never part of it. */
export function treeFiles(dir, at = "") {
  return readdirSync(join(dir, at)).filter(name => name !== ".git").sort().flatMap(name => {
    const rel = at ? `${at}/${name}` : name;
    return statSync(join(dir, rel)).isDirectory() ? treeFiles(dir, rel) : [rel];
  });
}

/** The mark the seeder leaves in a tree it wrote (never in the fixture), so a rerun or a resume may replace it. */
export const MARK = ".seed-pinned-world";
const MARK_TEXT = "written by scripts/seed-pinned-world.mjs\n";
const marked = dir => existsSync(join(dir, MARK));

/** The agents whose IA places slots in the fixture; Publisher's IA places none. */
export const LOOP_PLACED = ["director", "designer", "writer"];

/**
 * The placed agents' own loops, last (R3): `clossys loop <agent>/loop.scope` adopts each agent's five loop slots and
 * pins them to its package candidates on the package-default planner basis, the adoption `clossys init` runs
 * (init-loops.ts). A loop already pinned is kept, so a rerun writes nothing.
 */
async function adoptLoops(w) {
  for (const agent of LOOP_PLACED) await w.run(`${agent}/loop.scope`, "loop", `${agent}/loop.scope`, "--by", "planner:package-default", "--at", AT);
}

/**
 * The last step (foundry-build-0048 R1): `clossys migrate placement --apply` backfills the placement decision on
 * every placed slot whose ledger holds none, as a real consumer does to its store. Its clock is the R1 run's.
 */
export const PLACEMENT_AT = "2026-11-23T00:00:00Z";
async function placement(w) {
  await w.run("producer", "migrate", "placement", "--apply", "--at", PLACEMENT_AT);
}

/**
 * After the placement (foundry-build-0048 R2): `clossys next --owner`, the owner interview, files every request need
 * it prints as a queue entry, as a real consumer's first interview does. It runs at the seed clock (AT); a rerun files
 * nothing new.
 */
async function interview(w) {
  await w.run("producer", "next", "--owner");
}

/**
 * After the interview (foundry-build-0048 CPA): slot requests flow through `clossys request` to a closed reuse, as a
 * consumer's slot loop does, so the request-flow conformance rows judge real entries: every content agent raises one
 * (its requester row) and holds one as assignee. Each requester is a placed slot whose keyed refs must survive the flow
 * (`clossys ia --inputs` takes bare ids and keeps a stored keyed ref; the close keeps it on a reused ref): a requester
 * that ends without one of its keyed refs, key included, is refused. It names one need no slot holds through `clossys ia`
 * (which files the request, to the agent holding the need's first id segment, along a declared issuing edge), an
 * owner-routed entry is handed to that agent with a made-up fixture answer, and the agent reuses a placed slot the
 * requester already reads, so its inputs end as the package declares them (never create: a new leaf is not a package
 * leaf). A need whose entry is filed already is skipped, so a rerun writes nothing.
 */
export const REUSE_REQUESTS = [
  { from: "director/execution.measure.north-star", target: "director/aspiration.goal.north-star", reuse: "director/aspiration.goal.long-term" },
  { from: "designer/components.skeleton", target: "designer/themes.skeleton-fill", reuse: "designer/themes.muted" },
  { from: "writer/lexicon.preferred-terms", target: "director/identity.naming.offer-names", reuse: "director/identity.naming.architecture" },
  { from: "publisher/page.about", target: "writer/publication.site.about-meta", reuse: "writer/page.about.meta" },
  { from: "publisher/page.about", target: "publisher/layout.about-page", reuse: "publisher/layout.about" },
];
const fixtureAnswer = agent => `Made-up fixture answer: hand it to ${agent} to answer by its skill.`;

async function reuseRequests(w) {
  const entries = join(w.consumer, "agents", "producer", "queue.slot", "entries");
  const entryFor = target => (existsSync(entries) ? readdirSync(entries) : []).map(name => JSON.parse(readFileSync(join(entries, name), "utf8"))).find(entry => entry.target === target);
  for (const { from, target, reuse } of REUSE_REQUESTS) {
    const [agent, id] = from.split("/");
    const [assignee, need] = target.split("/");
    if (entryFor(target)) continue;
    const raw = JSON.parse(readFileSync(join(w.consumer, "agents", agent, id, "slot.json"), "utf8"));
    const keyed = (refs = []) => refs.filter(ref => ref.key !== undefined).map(ref => JSON.stringify([ref.to, ref.rel, ref.key]));
    const doc = readSlot(w.consumer, agent, id);
    const inputs = [...(doc.inputs ?? []), need];
    await w.run(from, "ia", from, "--contract", w.file(`${id}.request-contract.json`, doc.contract), "--inputs", inputs.join(","), "--at", AT);
    const entry = entryFor(target);
    if (!entry) throw new Refused(from, `clossys ia filed no request for ${target}`);
    if (entry.assignee === "owner") await w.run(from, "request", entry.id, "--answer", "handoff", "--via", "cli", "--quote", fixtureAnswer(assignee), "--at", AT);
    await w.run(from, "request", entry.id, "--decide", "reuse", "--slot", reuse, "--at", AT);
    await w.run(from, "request", entry.id, "--close", "--at", AT);
    const after = readSlot(w.consumer, agent, id).inputs ?? [];
    if ([...new Set(after)].sort().join() !== [...new Set(doc.inputs ?? [])].sort().join()) throw new Refused(from, `the reuse of ${reuse} changed the requester's inputs`);
    const kept = keyed(JSON.parse(readFileSync(join(w.consumer, "agents", agent, id, "slot.json"), "utf8")).refs);
    const lost = keyed(raw.refs).filter(ref => !kept.includes(ref));
    if (lost.length) throw new Refused(from, `the requester lost a keyed ref (${lost.join(", ")}), which clossys ia --inputs or the close dropped`);
  }
}

/**
 * Package leaves the base predates, placed last as a consumer adopting a new package version does (CP1-VIDEO1,
 * 3c542b21c and fd6da3890: the verbs that wrote frames.video into this fixture). Each is placed by `clossys ia` with
 * the package contract seeded as `migrate contracts` seeds it (seededContract: the standard's requirements, which
 * `ia` requires) under its package group, `clossys migrate contracts` then seeds its family, and
 * `clossys ia --inputs` declares the inputs the `migrate inputs` plan reads for it (conform S6). The contract and the
 * inputs come from the package and the plan, never from this file. A leaf placed already is skipped.
 */
export const NEW_PACKAGE_LEAVES = [
  { ref: "designer/frames.video", catalog: "frames", under: "frames.frames/frames-shells", standard: "frame" },
];

async function newPackageLeaves(w) {
  const { planInputsMigration } = await import("../dist/migrate/inputs.js");
  const { seededContract } = await import("../dist/migrate/contracts.js");
  const placed = [];
  for (const { ref, catalog, under, standard } of NEW_PACKAGE_LEAVES) {
    const [agent, id] = ref.split("/");
    if (existsSync(join(w.consumer, "agents", agent, id, "slot.json"))) continue;
    const entries = JSON.parse(readFileSync(join(PRODUCER, "..", agent, "src", "catalog", "slots", `${catalog}.json`), "utf8"));
    const contract = (Array.isArray(entries) ? entries : entries.slots ?? []).find(entry => entry?.id === id)?.contract;
    if (!contract) throw new Refused(ref, `the ${agent} package catalog ${catalog}.json declares no contract for ${id}`);
    const standardDoc = readStandard(w.root, agent, standard).doc;
    if (!standardDoc) throw new Refused(ref, `standard ${standard} does not read`);
    await w.run(ref, "ia", ref, "--contract", w.file(`${id}.package-contract.json`, seededContract(agent, contract, standardDoc)), "--standard", standard, "--under", under, "--at", AT);
    placed.push({ ref, agent, id, standard });
  }
  if (!placed.length) return;
  await w.run("producer", "migrate", "contracts", "--at", AT);
  const changes = planInputsMigration(w.consumer).changes;
  for (const { ref, agent, id, standard } of placed) {
    const inputs = changes.find(change => change.agent === agent && change.slot === id)?.added ?? [];
    if (!inputs.length) throw new Refused(ref, "the migrate inputs plan reads no input for it (conform S6)");
    const doc = readSlot(w.consumer, agent, id);
    await w.run(ref, "ia", ref, "--contract", w.file(`${id}.inputs-contract.json`, doc.contract), "--standard", standard, "--inputs", inputs.join(","), "--at", AT);
  }
}

/**
 * Seeds the unpinned base of `from` in a temporary root and returns the pinned tree there (`keep`) or copies it to
 * `out` (which must not hold a tree already) and removes it. The root holds the seeder's mark; `out` never does.
 * `resume` continues a kept root in place, skipping the slots it pinned already (a development aid; the committed
 * fixture is always one whole run): it is refused unless the root holds the mark, and a `.git` it holds is kept.
 */
export async function seed({ from, out, only, keep = false, resume } = {}) {
  if (resume && !marked(resume)) throw new Error(`${resume} holds no ${MARK}; resume continues only a root the seeder kept`);
  await load();
  const root = resume ? realpathSync(resume) : realpathSync(mkdtempSync(join(tmpdir(), "pinned-world-")));
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "pinned-world-input-")));
  let done = false;
  let ownGit = false;
  try {
    if (!resume) {
      if (from) cpSync(from, root, { recursive: true });
      else extractBase(root);
      writeFileSync(join(root, MARK), MARK_TEXT);
    }
    if (!existsSync(join(root, ".git"))) { execFileSync("git", ["init", "-q"], { cwd: root }); ownGit = true; }
    await setup(root);
    const w = world(root, scratch);
    await storeFormat(w);
    await migrate(w);
    const all = closure(w.consumer);
    for (const ref of Object.keys(BLOCKED)) if (!all.includes(ref)) throw new Error(`BLOCKED names ${ref}, which the closure does not read`);
    const blocked = blockedIn(w.consumer, all);
    const order = all.filter(ref => !blocked.has(ref) && (!only || only.some(prefix => ref.startsWith(prefix))));
    for (const ref of order) if (!pinned(w.consumer, ref)) await seedSlot(w, ref);
    // The Publisher leaves, placed from the package trees (R6): the Publisher IA is the workspace's own.
    await placePublisher(w, AT);
    // The second pass: the Publisher targets, over a closure read after placement. Their upstream was seeded above;
    // a Publisher target that reads an unpinned slot is a refusal, never a silent skip.
    const later = closure(w.consumer, PUBLISHER_TARGETS).filter(ref => !order.includes(ref) && !pinned(w.consumer, ref));
    for (const [ref, rule] of blockedIn(w.consumer, closure(w.consumer, PUBLISHER_TARGETS))) throw new Refused(ref, rule);
    const placed = later.filter(ref => !only || only.some(prefix => ref.startsWith(prefix)));
    for (const ref of placed) await seedSlot(w, ref);
    order.push(...placed);
    if (!only) await adoptLoops(w);
    if (!only) await placement(w);
    if (!only) await interview(w);
    if (!only) await reuseRequests(w);
    if (!only) await newPackageLeaves(w);
    // A slot retire moves its folder under _retired/ after its events logged it, so the index still names the old
    // paths as on disk; the index is derived, so the seeder ends by re-running the verb that rebuilds it.
    await w.run("index", "index", "--rebuild");
    // Only the repository this run made goes; a resumed root's own .git stays.
    if (ownGit) rmSync(join(root, ".git"), { recursive: true, force: true });
    if (out) {
      mkdirSync(out, { recursive: true });
      cpSync(root, out, { recursive: true, filter: source => source !== join(root, MARK) });
    }
    done = true;
    return { root: keep || !out ? root : undefined, order, blocked };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    if (!keep && !resume && (out || !done)) rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Refuses unless the seeder may replace `out`: it is new, an empty folder, the fixture, or a folder holding the
 * mark. A plain file, or a folder of anything else, is never replaced.
 */
export function assertReplaceable(out) {
  if (!existsSync(out)) return;
  if (!lstatSync(out).isDirectory()) throw new Error(`${out} is not a folder; pass a new or empty --out`);
  if (readdirSync(out).length && out !== FIXTURE && !marked(out)) throw new Error(`${out} is not empty and holds no ${MARK}; pass a new or empty --out`);
}

/**
 * Replaces `out` with the pinned tree written at `next`, then removes `next`. The mark is checked again right
 * before the delete: a seeding pass is long, and `out` may have changed since the run began.
 */
export function replaceOut(out, next) {
  assertReplaceable(out);
  if (existsSync(out) && readdirSync(out).length) rmSync(out, { recursive: true, force: true });
  cpSync(next, out, { recursive: true });
  if (out !== FIXTURE) writeFileSync(join(out, MARK), MARK_TEXT);
  rmSync(next, { recursive: true, force: true });
}

/** The CLI: seeds into `--out` (default the fixture) and returns the exit code. */
export async function main(argv) {
  const arg = flag => { const at = argv.indexOf(flag); return at >= 0 ? argv[at + 1] : undefined; };
  const only = arg("--only")?.split(",");
  const out = resolve(arg("--out") ?? FIXTURE);
  try {
    // The pinned tree replaces `out` whole: written beside it first, so a refusal leaves `out` as it was.
    const next = `${out}.seeding`;
    if (existsSync(next)) throw new Error(`${relative(process.cwd(), next) || next} exists; a previous run stopped there (remove it)`);
    assertReplaceable(out);
    const { order, blocked } = await seed({ out: next, only });
    replaceOut(out, next);
    for (const [ref, rule] of blocked) console.log(`seed-pinned-world: BLOCKED ${ref}: ${rule}`);
    console.log(`seed-pinned-world: ${order.length} slot(s) pinned, ${blocked.size} blocked, at ${AT} into ${relative(process.cwd(), out) || "."}`);
    return 0;
  } catch (error) {
    console.error(`seed-pinned-world: ${error instanceof Refused ? "BLOCKED " : ""}${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
