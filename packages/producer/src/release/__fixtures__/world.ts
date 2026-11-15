/**
 * A tmp consumer for the release tests: structure and real slot ids only (no names, brands or prices). It holds
 * one publication `site` with page `publisher/page.home`, the hero section and its copy record, the geography brief
 * the release locales come from, and the release slot `publisher/release.site`. Every input slot is pinned (basis
 * planner) to a placeholder candidate; the release slot starts with no pin. A `packages/` folder with package.json
 * stubs keeps package lookups local, so no installed package default leaks in.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { answerQueueEntry } from "../../queue/answer.js";
import { raiseEntry } from "../../loop/route.js";
import { buildCandidateHeader, candidatePath, serializeCandidate, writeCandidateFile } from "../../records/candidate.js";
import { cliActor } from "../../records/pin.js";
import { writeTargetPin } from "../../records/pin-map.js";
import { writeSlot } from "../../records/slot.js";
import type { AgentId, Iso, Ref, Slot } from "../../records/types.js";
import type { ReleaseBuilder } from "../build.js";

export const AT = "2026-11-20T07:00:00Z" as Iso;

const SLOTS: Record<string, { kind: Slot["kind"]; ia: Slot["ia"]; standard: string }> = {
  "director/focus.reach.geography": { kind: "brief", ia: { l0: "strategy", l1: "strategy/focus", l2: "strategy/focus/reach", order: 0 }, standard: "brief.statement" },
  "designer/sections.hero": { kind: "element/section", ia: { l0: "interface", l1: "interface/sections", l2: "interface/sections/story", order: 0 }, standard: "section.site" },
  "writer/sections.hero.copy": { kind: "copy", ia: { l0: "copy", l1: "copy/section-copy", l2: "copy/section-copy/story", order: 0 }, standard: "passage" },
  "publisher/page.home": { kind: "page", ia: { l0: "composition", l1: "composition/pages", l2: "composition/pages/site", order: 0 }, standard: "page" },
  "publisher/release.site": { kind: "release", ia: { l0: "composition", l1: "composition/releases", l2: "composition/releases/site", order: 0 }, standard: "release" },
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
  /** Writes a new placeholder candidate `<name>-v<n>` of a slot and pins it (basis planner); returns the file name. */
  repin(ref: string, version: number, content?: unknown): string;
  /** Raises a release sign-off entry and answers it as the owner; returns `queue.approve#<id>`. */
  signoff(now: () => Date, answer?: string): string;
  read(rel: string): string;
  write(rel: string, text: string): void;
  dispose(): void;
}

function slot(root: string, ref: string, extra: Partial<Slot> = {}): void {
  const spec = SLOTS[ref]!;
  const [agent, id] = ref.split("/") as [AgentId, string];
  writeSlot(join(root, "clossys", "agents", agent, id, "slot.json"), {
    schema: "clossys.slot/2", id, agent, kind: spec.kind, status: "live",
    createdBy: { actor: "code", cli: "clossys ia sync", version: "0.1.0" }, createdAt: AT, refs: [],
    ia: spec.ia, base: null, standard: spec.standard,
    brief: { purpose: "placeholder", mustDo: [], inputs: [], acceptance: [] }, contract: {}, tighten: [], ...extra,
  } as Slot);
}

const CANDIDATE: Record<string, { name: string; content: (version: number) => unknown; refs?: Ref[]; ext: "json" | "md" }> = {
  "director/focus.reach.geography": { name: "geography", ext: "md", content: () => "## Language\nen, fr\n" },
  "designer/sections.hero": { name: "hero", ext: "json", content: version => ({ placeholder: version }) },
  "writer/sections.hero.copy": { name: "home.hero", ext: "json", content: version => ({ fields: { "header.heading": { en: `placeholder ${version}`, fr: `placeholder ${version}` } } }) },
  "publisher/page.home": {
    name: "home", ext: "json", content: version => ({ placeholder: version }),
    refs: [{ to: "designer/sections.hero", rel: "uses" } as Ref, { to: "writer/sections.hero.copy", record: "home.hero", rel: "uses" } as Ref],
  },
};

export function releaseWorld(options: { locales?: { required?: string[]; from?: string } } = {}): ReleaseWorld {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "release-world-")));
  const put = (rel: string, text: string): void => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  put("clossys/clossys.config.ts", "export default {};\n");
  for (const agent of ["director", "designer", "writer", "publisher", "producer"]) put(`packages/${agent}/package.json`, JSON.stringify({ name: `@clossys/${agent}`, version: "0.0.0" }));
  put("clossys/agents/publisher/ia.json", `${JSON.stringify({
    schema: "clossys.ia/1", id: "publisher/ia", agent: "publisher", kind: "ia", status: "live",
    createdBy: { actor: "code", cli: "clossys ia sync", version: "0.1.0" }, createdAt: AT, refs: [],
    publications: { site: { node: "directory/sites/site", starter: "site", root: "/", pages: ["page.home"], chrome: [], release: "release.site", redirects: [] } },
  }, null, 2)}\n`);
  slot(root, "director/focus.reach.geography");
  slot(root, "designer/sections.hero");
  slot(root, "writer/sections.hero.copy", {
    refs: [{ to: "director/focus.reach.geography", key: "Language", rel: "input" } as Ref],
    contract: { copy: { sourceLocale: "en", fields: [{ key: "header.heading", required: true }] }, records: { "home.hero": { uses: ["header.heading"] } }, locales: { required: ["en", "fr"] } },
  });
  slot(root, "publisher/page.home");
  slot(root, "publisher/release.site", { contract: { locales: options.locales ?? { from: "director/focus.reach.geography:Language" } } });

  const world: ReleaseWorld = {
    root,
    repin(ref, version, content) {
      const spec = CANDIDATE[ref]!;
      const [agent, slotId] = ref.split("/") as [AgentId, string];
      const name = `${spec.name}-v${version}.${spec.ext}`;
      const record = agent === "writer" ? spec.name : undefined;
      const header = buildCandidateHeader({
        agent, slotId, name, createdBy: cliActor("test"), createdAt: AT, ...(record ? { record } : {}),
        ...(spec.refs ? { refs: spec.refs } : {}), source: { kind: "original", ref: [] },
      });
      writeCandidateFile(candidatePath(root, agent, slotId, name), serializeCandidate(name, header, content ?? spec.content(version)));
      writeTargetPin(root, { agent, slotId, ...(record ? { record } : {}), candidate: name, decidedBy: "planner", basis: "planner", at: AT, refs: [], createdBy: cliActor("clossys pin") });
      return name;
    },
    signoff(now, answer = "ready") {
      const { entry } = raiseEntry(root, {
        queue: "queue.approve", subject: { to: "publisher/release.site", rel: "input" } as Ref, decider: "owner", ask: "mark the release ready (publisher/release.site)",
        slug: "release.site", default: "not-ready", options: [{ id: "ready", summary: "mark it ready" }, { id: "not-ready", summary: "keep the current ready pin" }],
      }, now().toISOString().replace(/\.\d{3}Z$/, "Z") as Iso, false);
      const name = `queue.approve#${entry.id}`;
      answerQueueEntry(root, { entry: name, answer, by: "owner", via: "chat", quote: `owner said: ${answer}` }, now());
      return name;
    },
    read: rel => readFileSync(join(root, rel), "utf8"),
    write: (rel, text) => put(rel, text),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
  for (const ref of Object.keys(CANDIDATE)) world.repin(ref, 1);
  return world;
}
