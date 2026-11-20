/**
 * A tmp consumer for the release tests: structure and real slot ids only (no names, brands or prices). It holds
 * one publication `site` with page `publisher/page.home`, its frame, the hero section and its copy record, the geography brief
 * the release locales come from (its `- Language: en, fr` Direction line), the voice the copy derives from, and the release slot
 * `publisher/release.site`, every one placed in its agent's IA. Every input slot holds a submitted candidate the real
 * certifier passes on the package standards, pinned through the CHOOSE gate as `clossys pin` pins it (pinGate, the
 * scorecard it cites, the pin), and every repin runs the cascade (loop/cascade.ts runCascade) over its dependants, so
 * each pin carries a recorded verdict on the pinSet now and nothing is legacy (handPin alone writes a legacy pin, for the
 * tests that need one). The release slot starts with no pin.
 * A `packages/` folder with package.json stubs and a copy of the real package standards keeps package lookups local,
 * so no installed package default leaks in.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { clearReverdict } from "../../constitution/cascade.js";
import { pinGate, writeScorecard } from "../../constitution/pin-gate.js";
import { runCascade } from "../../loop/cascade.js";
import { answerQueueEntry } from "../../queue/answer.js";
import { raiseEntry } from "../../loop/route.js";
import { PRODUCER_ROOT } from "../../package-path.js";
import { cliActor } from "../../records/pin.js";
import { writeTargetPin } from "../../records/pin-map.js";
import { positionIa, writeSlot } from "../../records/slot.js";
import { skillPath } from "../../records/ledger.js";
import { appendSlotDocEvent, writeCandidate } from "../../records/slot-write.js";
import { serializeFrontmatter, slotPositions, type IaDoc, type SlotAgent } from "../../records/slot-model/index.js";
import type { AgentId, Iso, Ref, Slot } from "../../records/types.js";
import type { ReleaseBuilder } from "../build.js";

export const AT = "2026-11-20T07:00:00Z" as Iso;

/** Each slot's kind, standard and IA node (L1, L2); slot.json `ia` is the position that node gives it. */
const SLOTS: Record<string, { kind: Slot["kind"]; standard: string; node: [string, string] }> = {
  "director/focus.reach.geography": { kind: "brief", standard: "brief.list", node: ["focus", "focus.reach"] },
  "director/identity.verbal.voice": { kind: "brief", standard: "brief.profile", node: ["identity", "identity.verbal"] },
  "designer/frames.site-shell": { kind: "element/frame", standard: "frame", node: ["frames", "frames.site"] },
  "designer/sections.hero": { kind: "element/section", standard: "section.site", node: ["sections", "sections.story"] },
  "writer/sections.hero.copy": { kind: "copy", standard: "passage", node: ["section-copy", "section-copy.story"] },
  "publisher/page.home": { kind: "page", standard: "page", node: ["pages", "site"] },
  "publisher/release.site": { kind: "release", standard: "release", node: ["releases", "site"] },
};

/** A deterministic clock: one minute per call. */
export function clock(start = "2026-11-20T08:00:00Z"): () => Date {
  let at = Date.parse(start);
  return () => { const now = new Date(at); at += 60_000; return now; };
}

/** The stub builder: one route per page, an index that carries every pin and locale (so a pin change changes the bytes). */
export const stubBuilder: ReleaseBuilder = async ({ out, locales, pins, publication }) => {
  mkdirSync(join(out, "site"), { recursive: true });
  writeFileSync(join(out, "site", "index.html"), `<!doctype html><html data-publication="${publication}"><body><pre>${JSON.stringify({ locales, pins })}</pre></body></html>\n`);
  return { routes: 1, locales: [...locales], exports: [{ kind: "react-static", path: "site/" }] };
};

export interface ReleaseWorld {
  readonly root: string;
  /**
   * Submits candidate `<name>-v<n>` of a slot (default content, or `content`; for the copy record `{ fields }`), pins it
   * through the CHOOSE gate (basis planner) and runs the cascade; returns the file name. A refused pick throws.
   */
  repin(ref: string, version: number, content?: unknown): string;
  /**
   * Submits candidate `<name>-v<n>` as repin does, then pins it by hand (writeTargetPin, basis planner) with no CHOOSE
   * gate and no cascade: a legacy pin with no recorded pinSet or verdict, as `clossys migrate recut` writes a pin/1.
   */
  handPin(ref: string, version: number, content?: unknown): string;
  /**
   * Raises a release sign-off entry naming `manifest` (default: the latest manifest on disk) with its sha256, as the
   * release loop does, and answers it as the owner; returns `queue.approve#<id>`.
   */
  signoff(now: () => Date, answer?: string, manifest?: string): string;
  read(rel: string): string;
  write(rel: string, text: string): void;
  dispose(): void;
}

/**
 * Writes one world slot's slot.json and records the write: a `slot` ledger event with the bytes' sha256, as the
 * requests world records its slot.json (R14.1), so a guarded verb on the slot judges only what the verb writes.
 */
function slot(root: string, ref: string, extra: Partial<Slot> = {}): void {
  const spec = SLOTS[ref]!;
  const [agent, id] = ref.split("/") as [AgentId, string];
  const position = slotPositions(agent as SlotAgent, iaDoc(agent)).get(id)!;
  writeSlot(join(root, "clossys", "agents", agent, id, "slot.json"), {
    schema: "clossys.slot/2", id, agent, kind: spec.kind, status: "live",
    createdBy: { actor: "code", cli: "clossys ia sync", version: "0.1.0" }, createdAt: AT, refs: [],
    ia: positionIa(id, position), base: null, standard: spec.standard,
    brief: { purpose: "placeholder", mustDo: [], inputs: [], acceptance: [] }, contract: {}, tighten: [], ...extra,
  } as Slot);
  appendSlotDocEvent(join(root, "clossys"), agent as SlotAgent, id, { by: "planner", at: AT, verb: "ia", skill: skillPath("producer", "ia"), fields: { kind: "ia", note: "release world slot.json" } });
}

/** The agent's ia.json placing its world slots (`omit`: slots left out, their L1/L2 groups kept). */
function iaDoc(agent: string, omit: ReadonlySet<string> = new Set()): IaDoc {
  const nodes: { id: string; label: string; children: { id: string; label: string; slots: string[] }[] }[] = [];
  for (const [ref, spec] of Object.entries(SLOTS)) {
    const [owner, id] = ref.split("/") as [string, string];
    if (owner !== agent) continue;
    const [l1, l2] = spec.node;
    let node = nodes.find(each => each.id === l1);
    if (!node) nodes.push(node = { id: l1, label: l1, children: [] });
    let child = node.children.find(each => each.id === l2);
    if (!child) node.children.push(child = { id: l2, label: l2, slots: [] });
    if (!omit.has(ref)) child.slots.push(id);
  }
  return { schema: "clossys.ia/1", source: "workspace#release-world", extensions: [], nodes } as IaDoc;
}

/** A Designer element: one labelled button. */
const LABEL = (version: number) => `export function Example({ label }: { label: string }) { return <button type="button" data-version="${version}">{label}</button>; }\n`;
const element = (name: string, file: string, version: number) => ({
  name, type: "registry:ui", files: [{ path: file, type: "registry:ui", content: LABEL(version) }], meta: { source: { kind: "original", ref: [], license: "MIT" } },
});
const fixture = (file: string) => ({ props: ["label"], fixture: { schema: "clossys.element-preview/1", fixtures: { file, export: "Example", props: { label: "Go" } } } });
const HEADING: Record<string, string> = { en: "Ship your site this week", fr: "Lancez votre site cette semaine" };
type Fields = Record<string, Record<string, string>>;
/**
 * A Markdown candidate: its front matter fields (with its `source`) and its body.
 */
export interface MarkdownDoc { readonly front: Readonly<Record<string, unknown>>; readonly body: string }
const isMarkdownDoc = (value: unknown): value is MarkdownDoc => typeof value === "object" && value !== null && "body" in value && "front" in value;
/** A Writer copy record (strings Markdown) holding `fields` (key -> locale -> text). */
function copyDoc(fields: Fields): MarkdownDoc {
  const locales = [...new Set(Object.values(fields).flatMap(value => Object.keys(value)))];
  const body = locales.map(locale => `## ${locale}\n${Object.entries(fields).filter(([, value]) => value[locale] !== undefined)
    .map(([key, value]) => `### ${key}\n<!-- ${JSON.stringify({ id: key, bindings: [] })} -->\n${value[locale]}\n`).join("")}`).join("\n");
  return { front: { slot: "sections.hero.copy", locales, reason: "realises the geography brief's locales for the hero", source: { kind: "derived", ref: ["director:identity.verbal.voice", "director:focus.reach.geography"] } }, body };
}

/**
 * The geography brief with `languages` on its `- Language:` Direction line (the release locales). A repin with a
 * locale the copy record lacks (`geographyBrief("en, fr, de")`) is a genuine red copy.locales: every pin still
 * certifies, and the release needs a locale the copy does not carry.
 */
export function geographyBrief(languages: string): MarkdownDoc {
  return { front: { slot: "focus.reach.geography", source: { kind: "derived", ref: ["finding:geography-buyers"] }, feeds: [], functions: [] }, body:
    `## Direction\n- Language: ${languages}\n\n## Because\n- Buyers read the languages listed (finding:geography-buyers).\n\n## Watch\n- If sessions in a listed language fall below 5% in any quarter, then review the release locales.\n` };
}

const CANDIDATE: Record<string, { name: string; record?: string; content: (version: number, content?: unknown) => unknown }> = {
  "director/focus.reach.geography": { name: "geography", content: (_version, content) => content ?? geographyBrief("en, fr") },
  "director/identity.verbal.voice": {
    name: "voice",
    content: (_version, content) => content ?? { front: { slot: "identity.verbal.voice", source: { kind: "derived", ref: ["finding:voice-readers"] }, feeds: [], functions: [] }, body:
      "## Direction\n- Sound: Plain and direct, like a helpful colleague.\n- Do: Short sentences that name the next step.\n- Never: Hype, jargon or pressure.\n\n## Because\n- Buyers skim on phones between tasks (finding:voice-readers).\n\n## Watch\n- If tickets about unclear copy exceed 5 in any month, then review the voice.\n" },
  },
  "designer/frames.site-shell": { name: "site-shell", content: (version, content) => content ?? element("site-shell", "frames/site-shell.tsx", version) },
  "designer/sections.hero": { name: "hero", content: (version, content) => content ?? element("hero", "sections/hero.tsx", version) },
  "writer/sections.hero.copy": {
    name: "home.hero", record: "home.hero",
    content: (version, content) => copyDoc((content as { fields?: Fields } | undefined)?.fields
      ?? { "header.heading": Object.fromEntries(Object.entries(HEADING).map(([locale, text]) => [locale, version > 1 ? `${text}, take ${version}` : text])) }),
  },
  "publisher/page.home": {
    name: "home",
    content: (_version, content) => content ?? {
      schema: "clossys.page/1", path: "/", title: "sections.hero.copy#header.heading", frame: "frames.site-shell", sections: ["sections.hero"],
      copy: { heading: "sections.hero.copy#header.heading" }, meta: { source: { kind: "original", ref: [] } },
    },
  },
};

/**
 * `releaseSlot: false` leaves `publisher/release.site` out: no slot.json and no ia.json placement (its `releases/site`
 * group stays, empty), so a test creates it through the real verb (`clossys ia publisher/release.site --kind release`).
 */
export function releaseWorld(options: { locales?: { required?: string[]; from?: string }; releaseSlot?: boolean } = {}): ReleaseWorld {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "release-world-")));
  const consumer = join(root, "clossys");
  const put = (rel: string, text: string): void => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  put("clossys/clossys.config.ts", "export default {};\n");
  for (const agent of ["director", "designer", "writer", "publisher", "producer"]) put(`packages/${agent}/package.json`, JSON.stringify({ name: `@clossys/${agent}`, version: "0.0.0" }));
  // The real package standards: the certifier judges every world candidate on them.
  for (const agent of ["director", "designer", "writer", "publisher"]) cpSync(join(PRODUCER_ROOT, "..", agent, "standards"), join(root, "packages", agent, "standards"), { recursive: true });
  for (const agent of ["director", "designer", "writer"]) put(`clossys/agents/${agent}/ia.json`, `${JSON.stringify(iaDoc(agent), null, 2)}\n`);
  put("clossys/agents/publisher/ia.json", `${JSON.stringify({
    ...iaDoc("publisher", options.releaseSlot === false ? new Set(["publisher/release.site"]) : undefined),
    publications: { site: { node: "directory/sites/site", starter: "site", root: "/", pages: ["page.home"], chrome: [], release: "release.site", redirects: [] } },
  }, null, 2)}\n`);
  slot(root, "director/focus.reach.geography", {
    contract: { question: "Where do we sell first?", mustContain: [{ key: "Language", hint: "the locales the site ships" }], fixture: { headings: ["Direction", "Because", "Watch"] } },
  });
  slot(root, "director/identity.verbal.voice", {
    contract: {
      question: "How do we sound?", mustContain: [{ key: "Sound", hint: "how we sound" }, { key: "Do", hint: "habits we keep" }, { key: "Never", hint: "what we never do" }],
      fixture: { headings: ["Direction", "Because", "Watch"] },
    },
  });
  slot(root, "designer/frames.site-shell", { contract: fixture("frames/site-shell.tsx") });
  slot(root, "designer/sections.hero", { contract: fixture("sections/hero.tsx") });
  slot(root, "writer/sections.hero.copy", {
    refs: [{ to: "director/identity.verbal.voice", rel: "input" } as Ref, { to: "director/focus.reach.geography", key: "Language", rel: "input" } as Ref],
    contract: {
      copy: { sourceLocale: "en", fields: [{ key: "header.heading", required: true }] }, records: { "home.hero": { uses: ["header.heading"] } },
      locales: { required: ["en", "fr"] }, fixture: { keys: ["header.heading"], locales: ["en"] },
    },
  });
  slot(root, "publisher/page.home", {
    refs: [{ to: "designer/frames.site-shell", rel: "uses" } as Ref, { to: "designer/sections.hero", rel: "uses" } as Ref, { to: "writer/sections.hero.copy", rel: "uses" } as Ref],
    contract: { fixture: { route: { path: "/" } } },
  });
  if (options.releaseSlot !== false) slot(root, "publisher/release.site", { contract: { locales: options.locales ?? { from: "director/focus.reach.geography:Language" } } });

  /** Submits candidate `<name>-v<version>` through the submit verb (writeCandidate), in the shape it validates. */
  const submit = (ref: string, version: number, content?: unknown) => {
    const spec = CANDIDATE[ref]!;
    const [agent, slotId] = ref.split("/") as ["director" | "designer" | "writer" | "publisher", string];
    const doc = spec.content(version, content);
    const expected = `${spec.name}-v${version}.${isMarkdownDoc(doc) ? "md" : "json"}`;
    const bytes = isMarkdownDoc(doc) ? serializeFrontmatter(doc.front, doc.body) : doc;
    const { name } = writeCandidate(consumer, agent, slotId, spec.name, bytes, { at: AT, provenance: { by: `agent:${agent}`, model: "none", tier: "none" } });
    if (name !== expected) throw new Error(`release world: ${ref} wrote ${name}, not ${expected}`);
    return { spec, agent, slotId, name };
  };
  const world: ReleaseWorld = {
    root,
    repin(ref, version, content) {
      const { spec, agent, slotId, name } = submit(ref, version, content);
      // The CHOOSE gate, as clossys pin runs it: the real certifier's verdict, the scorecard it cites, then the pin.
      const gate = pinGate(root, consumer, agent, slotId, name, AT);
      if (gate.refusals.length) throw new Error(`release world: ${ref} ${name} is refused: ${gate.refusals.join("; ")}`);
      const scorecard = writeScorecard(root, agent, slotId, gate.scorecard);
      writeTargetPin(root, { agent, slotId, ...(spec.record ? { record: spec.record } : {}), candidate: name, decidedBy: "planner", basis: "planner", at: AT, refs: [scorecard], createdBy: cliActor("clossys pin") });
      clearReverdict(root, agent, slotId);
      // The repin's cascade: every dependant whose pinSet changed is judged again through the same certifier.
      runCascade(root, AT, { maxRounds: 4 });
      return name;
    },
    handPin(ref, version, content) {
      const { spec, agent, slotId, name } = submit(ref, version, content);
      writeTargetPin(root, { agent, slotId, ...(spec.record ? { record: spec.record } : {}), candidate: name, decidedBy: "planner", basis: "planner", at: AT, refs: [], createdBy: cliActor("test") });
      return name;
    },
    signoff(now, answer = "ready", manifest) {
      const dir = join(root, "clossys/agents/publisher/release.site/candidates");
      const name = manifest ?? (existsSync(dir) ? readdirSync(dir).filter(file => /^site-v\d+\.json$/.test(file)).sort((a, b) => Number(a.slice(6, -5)) - Number(b.slice(6, -5))).pop() : undefined);
      const file = name ? join(dir, name) : undefined;
      const refs = name && file && existsSync(file) ? [{ to: `publisher/release.site/${name}`, sha256: createHash("sha256").update(readFileSync(file)).digest("hex"), rel: "input" } as Ref] : [];
      const { entry } = raiseEntry(root, {
        queue: "queue.approve", subject: { to: "publisher/release.site", rel: "input" } as Ref, decider: "owner", ask: "mark the release ready (publisher/release.site)",
        slug: "release.site", default: "not-ready", refs,
        options: [{ id: "ready", ...(name ? { candidate: name as never } : {}), summary: "mark it ready" }, { id: "not-ready", summary: "keep the current ready pin" }],
      }, now().toISOString().replace(/\.\d{3}Z$/, "Z") as Iso, false);
      const entryRef = `queue.approve#${entry.id}`;
      answerQueueEntry(root, { entry: entryRef, answer, by: "owner", via: "chat", quote: `owner said: ${answer}` }, now());
      return entryRef;
    },
    read: rel => readFileSync(join(root, rel), "utf8"),
    write: (rel, text) => put(rel, text),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
  for (const ref of Object.keys(CANDIDATE)) world.repin(ref, 1);
  return world;
}
