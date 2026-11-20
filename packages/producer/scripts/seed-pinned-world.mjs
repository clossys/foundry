#!/usr/bin/env node
/**
 * The pinned test world (foundry-build-0048 Unit A): seeds test-fixtures/consumer so that every slot the
 * fixture pages read (the upstream closure of the site shell, the hero section and their Writer copy) holds a
 * candidate pinned through the CHOOSE gate. Only the clossys verbs write: `clossys verdict --record` (the P1
 * create verdict), `clossys next --stage brief|diverge|render` and `clossys critique` (the P2 craft stages),
 * `clossys next --submit` (the guarded candidates verb) and `clossys pin` (the gate, its scorecard and the pin
 * ledger event). The content is synthetic fixture data, one generator per standard; it names no brand or client.
 *
 *   node scripts/seed-pinned-world.mjs [--out <dir>]   (default: rewrite test-fixtures/consumer)
 *
 * The run is a pure function of the unpinned base: the committed fixture with every seeded record taken out
 * (candidates, critiques, pins, scorecards, renders and the ledger events the verbs above wrote). The clock is
 * fixed (AT), so a rerun writes the same bytes; pinned-world.test.ts reruns it and compares the trees.
 * BLOCKED lists the closure slots the real certifier refuses every candidate shape for, with the rule; the run
 * leaves them (and their downstream) unpinned and prints them. Any other refusal stops the run (exit 1).
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizedSeedFile } from "@clossys/designer/ref-verbatim";

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

// ---------------------------------------------------------------- base (the unpinned fixture)

/** Ledger ops the seeding verbs write; the base keeps every other event (ia, migrate, slot). */
const SEEDED_OPS = /^(?:verdict|options|submit|pin|pick|confirm|craft:.+)$/;
const SEEDED_DIRS = new Set(["candidates", "critiques"]);
const SEEDED_FILES = new Set(["pin.json"]);
/** Consumer setup the run writes before its slots: the shadcn flavor and the lockfile of the packages its pins declare. */
const SETUP_FILES = ["package-lock.json", "clossys/components.json"];

/** The unpinned base of a fixture tree, in place: every seeded record and ledger event taken out. */
export function stripSeeded(root) {
  for (const name of [".clossys", ...SETUP_FILES]) if (existsSync(join(root, name))) rmSync(join(root, name), { recursive: true, force: true });
  const agents = join(root, "clossys", "agents");
  for (const agent of readdirSync(agents)) {
    const dir = join(agents, agent);
    if (!statSync(dir).isDirectory()) continue;
    for (const slot of readdirSync(dir)) {
      const slotDir = join(dir, slot);
      if (slot === "_retired" || !statSync(slotDir).isDirectory()) continue;
      for (const entry of readdirSync(slotDir)) {
        if (SEEDED_DIRS.has(entry) || SEEDED_FILES.has(entry)) rmSync(join(slotDir, entry), { recursive: true, force: true });
      }
      const ledger = join(slotDir, "ledger.json");
      if (!existsSync(ledger)) continue;
      const doc = JSON.parse(readFileSync(ledger, "utf8"));
      const events = (doc.events ?? []).filter(event => !SEEDED_OPS.test(String(event.op)));
      if (events.length !== (doc.events ?? []).length) writeFileSync(ledger, `${JSON.stringify({ ...doc, events }, null, 2)}\n`);
    }
  }
}

// ---------------------------------------------------------------- the verbs

let runCli;
let STEPS;
let readSlot;
let readStandard;
export async function load() {
  globalThis.Date = SeedDate;
  ({ runCli } = await import("../dist/cli/main.js"));
  ({ STEPS } = await import("../dist/pipeline/steps/index.js"));
  ({ readSlot } = await import("../dist/records/slots.js"));
  ({ readStandard } = await import("../dist/records/standards.js"));
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

// Writer: every value derives from the pinned voice and the slot's other upstream pins (copy.voice-derived,
// copy.derived-upstream); a lexicon slot holds json records, a copy slot plain values within the contract's limits.

const VOICE = "director:identity.verbal.voice";

/** The lexicon records of each fixture lexicon slot (key -> record fields past id, context and kind). */
const LEXICON = {
  "lexicon.formality": { kind: "voice-rule", records: { register: { rule: "Use a neutral everyday register", value: "neutral" }, address: { rule: "Address the reader as you", value: "informal-you" } } },
  "lexicon.warmth": { kind: "voice-rule", records: { warmth: { rule: "Sound like a capable neighbour, never a salesperson", value: "warm" } } },
  "lexicon.energy": { kind: "voice-rule", records: { energy: { rule: "Keep a steady pace with no exclamation", value: "steady" } } },
  "lexicon.person": { kind: "voice-rule", records: { person: { rule: "Write in the second person to the owner", value: "second" } } },
  "lexicon.mood": { kind: "voice-rule", records: { mood: { rule: "Use the imperative for actions and the indicative for facts", value: "imperative-actions" } } },
  "lexicon.sentence-length": { kind: "voice-rule", records: { "max-words": { rule: "Keep a sentence to twenty words or fewer", value: 20 } } },
  "lexicon.reading-level": { kind: "voice-rule", records: { grade: { rule: "Write for a grade seven reader", value: 7 } } },
  "lexicon.capitalization": { kind: "format", records: { headings: { format: "sentence-case", value: "headings, labels and actions" } } },
  "lexicon.punctuation": { kind: "format", records: { "terminal-period": { format: "terminal-period", value: "body sentences only, never headings or labels" } } },
  "lexicon.preferred-terms": { kind: "term", records: { site: { term: "site", forms: ["site", "sites"], termStatus: "preferred", reason: "the plain word owners already use" } } },
  "lexicon.avoid-terms": { kind: "term", records: { leverage: { term: "leverage", forms: ["leverage", "leveraging"], termStatus: "avoid", reason: "jargon the voice never uses" } } },
  "lexicon.avoid-patterns": { kind: "pattern-rule", records: { "click-here": { pattern: { source: "\\bclick here\\b", flags: "i" }, severity: "warning", reason: "names the gesture, not the destination" } } },
};

/** The fixture copy of each copy slot (key -> English value), and the pin-map record a records contract places it in. */
const COPY = {
  "publication.site.meta": { siteName: "Fixture Works", "share.title": "Fixture Works keeps small business sites current", "share.description": "Plain help for owners who edit their own website and want every change live the same day." },
  "page.home.meta": { title: "Keep your site current without waiting", description: "Edit your own pages, publish the same day and keep every change in plain view." },
  "frames.site-header.copy": { "skip.label": "Skip to content", "navigation.label": "Main navigation", "navigation.open": "Open menu", "navigation.close": "Close menu" },
  "sections.hero.copy": { "header.heading": "Keep your site current without waiting" },
};

/** The derived source of a Writer candidate: the pinned voice first, then every other upstream pin it reads. */
function writerSource(consumer, doc, id) {
  const refs = [...new Set([VOICE, ...upstream(consumer, "writer", id).deps.map(dep => `${agentOf(consumer, dep)}:${dep}`)])];
  return { kind: "derived", ref: refs };
}

/** A Writer Markdown candidate: frontmatter (slot, locales, reason, source) and one en section of `### <key>` entries. */
function writerDoc(consumer, id, doc, reason, entries) {
  return [
    "---",
    `slot: ${JSON.stringify(id)}`,
    `locales: ${JSON.stringify(["en"])}`,
    `reason: ${JSON.stringify(reason)}`,
    `source: ${JSON.stringify(writerSource(consumer, doc, id))}`,
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

/**
 * The inputs a copy slot lacks: copy.voice-derived holds every Writer copy candidate to cite the pinned voice and R07.1
 * holds every citation to the slot's inputs, so a copy slot that does not read the voice takes it as an input
 * (`clossys ia --inputs`), as its fixture siblings do. Undefined when the slot reads it already.
 */
function copyInputs(doc) {
  const voice = VOICE.slice("director:".length);
  if (doc.standard.startsWith("lexicon.") || (doc.inputs ?? []).includes(voice)) return undefined;
  return [...(doc.inputs ?? []), voice];
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

// ---------------------------------------------------------------- consumer setup

const REPO = resolve(PRODUCER, "..", "..");
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

/** The consumer's clossys/components.json, from the Designer flavor's one writer (check-generated-derived). */
async function setup(root) {
  const { writeFlavor } = await import("./check-generated-derived.mjs");
  writeFlavor(join(root, "clossys"));
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

/** The candidate a slot's standard takes, with its extension and the ladder rung it comes in on. */
function candidateOf(root, consumer, agent, id, doc, standard) {
  if (agent === "designer") {
    if (doc.standard.startsWith("token.")) return token(id, doc, standard);
    if (doc.standard === "asset.glyph") return glyph(id, doc, standard);
    if (doc.standard === "asset.logo-mark" || doc.standard === "asset.media-rule") return consumerAsset(id, doc, standard);
    if (doc.standard === "component" && doc.contract?.fixture) return component(root, consumer, id, doc, standard);
  }
  if (agent === "director") return { ext: "md", body: brief(consumer, id, doc), rung: "create", reason: "fixture world: the brief standards are create-only and no package default fits a synthetic consumer" };
  if (agent === "writer") {
    // A copy slot pins per record (records/pin-map.ts), a record's candidate is named for it, and every candidate's
    // stem is the slot leaf (R08.1): the one record a submitted copy candidate can fill is the leaf.
    const lexiconSlot = doc.standard.startsWith("lexicon.");
    const body = lexiconSlot ? lexicon(consumer, id, doc) : copy(consumer, id, doc);
    return { ext: "md", body, rung: "create", reason: CREATE, ...(lexiconSlot ? {} : { record: id.split(".").at(-1) }) };
  }
  throw new Error(`no fixture generator for ${agent}/${id} (${doc.kind}, standard ${doc.standard})`);
}

// ---------------------------------------------------------------- slots the real certifier refuses

/**
 * Closure slots no candidate shape passes today, with the rule that refuses it (each shape was put through the
 * real verbs). The run seeds none of them, nor any slot that reads one (its R02.2 upstream is unpinned); the
 * world is pinned everywhere else. A slot leaves this list when its standard or contract admits a candidate.
 */
export const BLOCKED = {
  "designer/components.dialog": "R05.1 [import] and R07.1: its normalized reference imports @/components/ui/button, which resolves to components.link (link ships the same stock button file as components.button) and slot.json uses does not list link",
  "designer/components.media-player": "ref-verbatim REF-FLAVOR: the contract fixture's reference diceui/media-player is new-york, the consumer flavor is aria-nova",
  "designer/components.status-mark": "ref-verbatim REF-FLAVOR: the contract fixture's reference diceui/status is new-york, the consumer flavor is aria-nova",
  "designer/components.icon": "R05.1 [no-fixture]: no contract fixture (contract-fixture-gaps: no adopted reference); an npm re-export fails R03.2 (adopt rung needs a registry source) and R03.4",
  "designer/components.logo": "R05.1 [no-fixture]: no contract fixture (contract-fixture-gaps: no adopted reference)",
  "designer/components.semantic-content": "R05.1 [no-fixture]: no contract fixture (contract-fixture-gaps: no adopted reference); R03.2 admits an original source only in consumer-asset slots",
  "designer/assets.image-ratio": "asset.media-rule: R03.2 admits an original source only in consumer-asset slots, and source.ref (registries: []) admits no registry reference",
  "designer/assets.pattern": "asset.media-rule: R03.2 admits an original source only in consumer-asset slots, and source.ref (registries: []) admits no registry reference",
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

async function seedSlot(w, ref) {
  const [agent, id] = ref.split("/");
  let doc = readSlot(w.consumer, agent, id);
  const contract = agent === "writer" ? lexiconContract(id, doc) : undefined;
  const inputs = agent === "writer" ? copyInputs(doc) : undefined;
  if (contract || inputs) {
    await w.run(ref, "ia", ref, "--contract", w.file(`${id}.contract.json`, contract ?? doc.contract), ...(inputs ? ["--inputs", inputs.join(",")] : []), "--at", AT);
    doc = readSlot(w.consumer, agent, id);
  }
  const standard = readStandard(w.root, agent, doc.standard);
  if (!standard.doc || !standard.taste) throw new Refused(ref, `standard ${doc.standard} does not read`);
  const made = candidateOf(w.root, w.consumer, agent, id, doc, standard);
  const skill = w.skillOf(agent);
  const leaf = id.split(".").at(-1);
  const candidate = `${leaf}-v1.${made.ext}`;
  const tier = standard.doc.craftTier ?? TIER;
  const create = made.rung === "create" || made.rung === "L4" || made.rung === "adapt" || made.rung === "L3";
  if (create) {
    const criterion = standard.taste.criteria[0].id;
    const gap = standard.doc.mode === "adopt-first" ? { id: criterion, class: standard.doc.createGaps?.[0] ?? "missing-behavior" } : { id: criterion };
    await w.run(ref, "verdict", ref, "--record", w.file(`${id}.verdict.json`, { schema: "clossys.verdict/1", slot: id, create: true, reason: made.reason, gaps: [gap] }),
      "--model", MODEL, "--tier", tier, "--by", `agent:${agent}.verdict`, "--at", AT);
    if (standard.doc.mode === "craft") {
      const craft = ["--model", MODEL, "--tier", tier, "--skill", skill];
      await w.run(ref, "next", ref, "--stage", "brief", ...craft, "--file", w.file(`${id}.brief.json`, { goal: `fixture world: fill ${id} to ${doc.standard}` }));
      await w.run(ref, "next", ref, "--stage", "diverge", ...craft, "--file", w.file(`${id}.diverge.json`,
        ["plain", "warm", "brisk"].map((tone, index) => ({ id: `d${index + 1}`, idea: `a ${tone} reading of the slot contract`, axes: { tone } }))));
      await w.run(ref, "next", ref, "--stage", "render", ...craft);
      const manifest = [
        { role: "taste", ref: `packages/${agent}/standards/${doc.standard}/taste.md` },
        { role: "contract", ref: `clossys/agents/${agent}/${id}/slot.json#contract` },
        { role: "render", ref: `.clossys/renders/${agent}/${id}/${leaf}-v1.png` },
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

/**
 * Seeds the unpinned base of `from` in a temporary root and returns the pinned tree there (`keep`) or copies it to
 * `out` (which must not hold a tree already) and removes it. `resume` continues a kept root in place, skipping
 * the slots it pinned already (a development aid; the committed fixture is always one whole run).
 */
export async function seed({ from = FIXTURE, out, only, keep = false, resume } = {}) {
  await load();
  const root = resume ? realpathSync(resume) : realpathSync(mkdtempSync(join(tmpdir(), "pinned-world-")));
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "pinned-world-input-")));
  let done = false;
  try {
    if (!resume) {
      cpSync(from, root, { recursive: true });
      stripSeeded(root);
    }
    if (!existsSync(join(root, ".git"))) execFileSync("git", ["init", "-q"], { cwd: root });
    if (!existsSync(join(root, "clossys", "components.json"))) await setup(root);
    const w = world(root, scratch);
    const all = closure(w.consumer);
    for (const ref of Object.keys(BLOCKED)) if (!all.includes(ref)) throw new Error(`BLOCKED names ${ref}, which the closure does not read`);
    const blocked = blockedIn(w.consumer, all);
    const order = all.filter(ref => !blocked.has(ref) && (!only || only.some(prefix => ref.startsWith(prefix))));
    for (const ref of order) if (!resume || !pinned(w.consumer, ref)) await seedSlot(w, ref);
    rmSync(join(root, ".git"), { recursive: true, force: true });
    if (out) {
      mkdirSync(out, { recursive: true });
      cpSync(root, out, { recursive: true });
    }
    done = true;
    return { root: keep || !out ? root : undefined, order, blocked };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    if (!keep && !resume && (out || !done)) rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = flag => { const at = process.argv.indexOf(flag); return at > 0 ? process.argv[at + 1] : undefined; };
  const only = arg("--only")?.split(",");
  const out = resolve(arg("--out") ?? FIXTURE);
  try {
    // The pinned tree replaces `out` whole: written beside it first, so a refusal leaves `out` as it was.
    const next = `${out}.seeding`;
    if (existsSync(next)) throw new Error(`${relative(process.cwd(), next)} exists; a previous run stopped there (remove it)`);
    const { order, blocked } = await seed({ out: next, only });
    if (existsSync(out)) rmSync(out, { recursive: true, force: true });
    cpSync(next, out, { recursive: true });
    rmSync(next, { recursive: true, force: true });
    for (const [ref, rule] of blocked) console.log(`seed-pinned-world: BLOCKED ${ref}: ${rule}`);
    console.log(`seed-pinned-world: ${order.length} slot(s) pinned, ${blocked.size} blocked, at ${AT} into ${relative(process.cwd(), out) || "."}`);
  } catch (error) {
    if (error instanceof Refused) { console.error(`seed-pinned-world: BLOCKED ${error.message}`); process.exit(1); }
    throw error;
  }
}
