/**
 * View discovery (system.md 6.6, 14.9): `clossys views list` and `clossys views show` read the package view
 * prompts (`packages/<agent>/views/<view-id>.md`, installed at `node_modules/@clossys/<agent>/views/`) and the
 * consumer's own views (`clossys/agents/<agent>/views/<view-id>.md`). A consumer file with the same id shadows the
 * package file. A chat agent reads views through these two verbs, never by searching node_modules.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { consumerViewsDir, packageViewsDir, VIEW_AGENTS, VIEW_ID, viewFiles } from "../check/views-inputs-only.js";
import { readRecordHeader } from "../records/schema.js";
import type { AgentId } from "../records/types.js";

export interface ViewListing {
  /** `<agent>/<view-id>`: the argument `clossys views show` takes. */
  readonly id: string;
  readonly agent: AgentId;
  readonly view: string;
  /** The first `# ` heading of the resolved file, or null. */
  readonly title: string | null;
  readonly appliesTo: readonly string[];
  readonly answers: readonly string[];
  /** Where the resolved prompt comes from. */
  readonly source: "package" | "consumer";
  /** True when a consumer file shadows a package file with the same id. */
  readonly shadowsPackage: boolean;
  /** Set when the resolved file has no readable header (checkViews in check/views-inputs-only.ts says why). */
  readonly invalid?: string;
}

export interface ViewsList {
  readonly schema: "clossys.views-list/1";
  /** The consumer root read for consumer views, or null when only package views were read. */
  readonly workspace: string | null;
  readonly views: readonly ViewListing[];
}

export interface ResolvedView {
  readonly id: string;
  readonly agent: AgentId;
  readonly view: string;
  readonly source: "package" | "consumer";
  readonly shadowsPackage: boolean;
  /** The prompt exactly as the file holds it. */
  readonly text: string;
}

export class ViewNotFoundError extends Error {
  readonly exitCode = 1;
  constructor(id: string, known: readonly string[]) {
    super(`No view ${id}. Known views: ${known.length ? known.join(", ") : "none"} (clossys views list)`);
    this.name = "ViewNotFoundError";
  }
}

export class ViewRefError extends Error {
  readonly exitCode = 2;
  constructor(id: string) {
    super(`A view is named <agent>/<view-id> (agent ${VIEW_AGENTS.join(", ")}), got ${JSON.stringify(id)}`);
    this.name = "ViewRefError";
  }
}

export interface ViewSources {
  /** Root used to find package views (a root with `packages/` reads them there, else the installed packages). */
  readonly packageRoot: string;
  /** The consumer root, or undefined to read package views only. */
  readonly consumerRoot?: string;
}

interface Located { readonly agent: AgentId; readonly view: string; readonly packageFile?: string; readonly consumerFile?: string }

function locate(sources: ViewSources): Located[] {
  const rows: Located[] = [];
  for (const agent of VIEW_AGENTS) {
    const byView = new Map<string, { packageFile?: string; consumerFile?: string }>();
    const pkgDir = packageViewsDir(sources.packageRoot, agent);
    for (const name of viewFiles(pkgDir)) byView.set(name.slice(0, -3), { packageFile: join(pkgDir, name) });
    if (sources.consumerRoot !== undefined) {
      const dir = consumerViewsDir(sources.consumerRoot, agent);
      for (const name of viewFiles(dir)) byView.set(name.slice(0, -3), { ...byView.get(name.slice(0, -3)), consumerFile: join(dir, name) });
    }
    for (const view of [...byView.keys()].sort()) rows.push({ agent, view, ...byView.get(view)! });
  }
  return rows;
}

const titleOf = (text: string): string | null => /^# (.+)$/m.exec(text.replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, ""))?.[1]?.trim() ?? null;

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** Every view id, its agent, appliesTo, answers and whether a consumer file shadows the package file. */
export function listViews(sources: ViewSources): ViewsList {
  const views = locate(sources).map((row): ViewListing => {
    const file = row.consumerFile ?? row.packageFile!;
    const text = readFileSync(file, "utf8");
    let header: Record<string, unknown> = {}, invalid: string | undefined;
    try {
      const read = readRecordHeader(`${row.view}.md`, text);
      if (typeof read === "object" && read !== null && !Array.isArray(read)) header = read as Record<string, unknown>;
      else invalid = "the clossys header is not a mapping";
    } catch (error) { invalid = error instanceof Error ? error.message : String(error); }
    return {
      id: `${row.agent}/${row.view}`, agent: row.agent, view: row.view, title: titleOf(text),
      appliesTo: strings(header.appliesTo), answers: strings(header.answers),
      source: row.consumerFile ? "consumer" : "package", shadowsPackage: !!(row.consumerFile && row.packageFile),
      ...(invalid !== undefined ? { invalid } : {}),
    };
  });
  return { schema: "clossys.views-list/1", workspace: sources.consumerRoot ?? null, views };
}

/** Accepts `<agent>/<view-id>` and the header form `<agent>/views/<view-id>`. */
export function parseViewId(id: string): { agent: AgentId; view: string } {
  const match = /^([a-z]+)\/(?:views\/)?([^/]+)$/.exec(id);
  if (!match || !(VIEW_AGENTS as readonly string[]).includes(match[1]!) || !VIEW_ID.test(match[2]!)) throw new ViewRefError(id);
  return { agent: match[1] as AgentId, view: match[2]! };
}

/** The resolved prompt for one view: the consumer file when present, else the package file. */
export function showView(sources: ViewSources, id: string): ResolvedView {
  const { agent, view } = parseViewId(id);
  const rows = locate(sources);
  const row = rows.find(candidate => candidate.agent === agent && candidate.view === view);
  if (!row) throw new ViewNotFoundError(`${agent}/${view}`, rows.map(candidate => `${candidate.agent}/${candidate.view}`));
  const file = row.consumerFile ?? row.packageFile!;
  return {
    id: `${agent}/${view}`, agent, view, source: row.consumerFile ? "consumer" : "package",
    shadowsPackage: !!(row.consumerFile && row.packageFile), text: readFileSync(file, "utf8"),
  };
}
