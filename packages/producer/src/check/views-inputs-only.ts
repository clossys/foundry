/**
 * `views.inputs-only` (system.md 6.6, 9, 12.7, 14.9; run by the package script `check:views`): a view prompt
 * is a read-only, tool-neutral instruction for a chat agent, and it reads the workspace only through the four
 * read verbs.
 *
 * Reads every package `packages/<agent>/views/*.md` and every consumer `clossys/agents/<agent>/views/*.md`.
 * A view fails when:
 * - its front matter has no `clossys` header, or the header does not validate against `schemas/view.json`, or its
 *   `id` and `agent` do not match the file's agent and name;
 * - an `inputs` line does not start with `clossys status`, `clossys slot`, `clossys render` or `clossys preview`
 *   (so `clossys views` and every write verb are refused as inputs), or names a file path;
 * - `appliesTo` holds anything but a slot kind, a queue id or an `<agent>/<slot-id glob>` ref (the 6.6 template's
 *   `writer/*.copy` form: a ref wildcard is a ref, not a path);
 * - an `answers` queue is not one of the four, or the view answers a queue and its body never says `clossys answer`;
 * - the Markdown body (front matter excluded) names a file path, a path glob, or a raw file read (`cat`, `ls`,
 *   `fs.`, `readFile`, ...), or runs a `clossys` verb other than the read verbs, `answer` and `views`;
 * - the body or the inputs name a coding tool, a model or its vendor (one file serves every chat agent);
 * - the `## Rules` section is missing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { packagePath, PRODUCER_ROOT } from "../package-path.js";
import { readRecordHeader, validateAgainst, type JsonSchema } from "../records/schema.js";
import type { AgentId, QueueName } from "../records/types.js";
import { runOf, type TargetCheckRun, type TargetFinding } from "./pins-resolve.js";

export const VIEWS_INPUTS_ONLY = "views.inputs-only";

export const VIEW_AGENTS: readonly AgentId[] = ["director", "designer", "writer", "publisher", "producer"];
/** The four read verbs a view may take as an input (system.md 12.1). */
export const READ_VERBS = ["status", "slot", "render", "preview"] as const;
export const VIEW_QUEUES: readonly QueueName[] = ["queue.pick", "queue.approve", "queue.clarify", "queue.fix"];
/** The slot kinds (system.md 4 `SlotKind`), plus the Designer element kinds by their short name (designer.md 9.7). */
export const VIEW_SLOT_KINDS: readonly string[] = [
  "brief",
  "element/token", "element/asset", "element/component", "element/section", "element/frame",
  "token", "asset", "component", "section", "frame",
  "voice", "prose", "copy",
  "layout", "chrome", "page", "release",
  "loop", "queue", "ledger",
];
/** `clossys` verbs a view body may name: the read verbs, the one write path back (`answer`) and view discovery. */
const BODY_VERBS = new Set<string>([...READ_VERBS, "answer", "views"]);

export const VIEW_ID = /^[a-z][a-z0-9-]*$/;
const INPUT = new RegExp(`^clossys (${READ_VERBS.join("|")})( |$)`);
const AGENT_GROUP = VIEW_AGENTS.join("|");
/** `<agent>/<slot-id or glob>[/<candidate>][#<record>]`: a ref, never a file path (system.md 5, 9). */
const REF_TOKEN = new RegExp(`^(${AGENT_GROUP})/[a-z0-9<>*.{}|_-]+(/(package:)?[a-z0-9<>*._-]+)?(#[a-z0-9<>*._-]+)?(:[A-Za-z<>-]+)?$`);
const APPLIES_GLOB = new RegExp(`^(${AGENT_GROUP})/[a-z0-9*][a-z0-9.*-]*$`);
const CANDIDATE_FILE = /^[a-z0-9<>][a-z0-9<>.-]*-v([1-9][0-9]*|<n>)\.(md|json|svg)$/;
const FILE_EXTENSION = /\.(json|jsonl|md|mdx|ts|tsx|js|mjs|cjs|jsx|svg|css|html?|ya?ml|txt|csv|lock|sh)$/i;
const PATH_START = /^(\.{1,2}\/|~\/|\/[A-Za-z]|\.clossys(\/|$)|clossys\/|node_modules(\/|$)|packages\/|src\/|dist\/)/;
const URL_TOKEN = /^[a-z][a-z0-9+.-]*:\/\//i;
/** A raw file read anywhere in the prose. */
const READ_CALL = /\bfs\.[A-Za-z]|\b(readFileSync|readFile|readdirSync|readdir|createReadStream|globSync)\b/;
/** A shell read at the start of a code span or a fenced line. */
const SHELL_READ = /^\s*(\$\s*)?(cat|ls|head|tail|less|grep|rg|find|sed|awk|tree|jq|bat)(\s|$)/;
/** Coding tools, models and their vendors: a view is one file for every chat agent (system.md 12.7). */
export const TOOL_NAMES = /\b(claude|codex|cursor|copilot|chatgpt|openai|anthropic|gemini|bard|gpt(-?[0-9][a-z0-9.-]*)?|o[134]-mini|windsurf|cline|aider|devin|opus|sonnet|haiku|llama|mistral|deepseek|qwen|grok|vs ?code|jetbrains|zed)\b/i;

let viewSchema: JsonSchema | undefined;
function schema(): JsonSchema {
  return viewSchema ??= JSON.parse(readFileSync(join(PRODUCER_ROOT, "schemas", "view.json"), "utf8")) as JsonSchema;
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

/** The Markdown body after the front matter (the whole text when there is none). */
export function viewBody(text: string): string {
  const match = FRONT.exec(text);
  return match ? text.slice(match[0].length) : text;
}

/** Inline code spans and fenced lines of a Markdown body. */
function codeSpans(body: string): string[] {
  const spans: string[] = [];
  let fenced = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) { spans.push(line); continue; }
    for (const match of line.matchAll(/`([^`]+)`/g)) spans.push(match[1]!);
  }
  return spans;
}

const trimToken = (token: string): string => token.replace(/^[("'`\[{<]+|[)"'`\]},;:!?.]+$/g, "");

/** Why `token` is a file path or path glob, or undefined when it is not one (a ref, a URL, a placeholder, a word). */
export function pathReason(raw: string): string | undefined {
  const token = trimToken(raw);
  if (token === "" || URL_TOKEN.test(token)) return undefined;
  if (REF_TOKEN.test(token)) return undefined;
  if (PATH_START.test(token)) return "a file path";
  if (token.includes("/")) {
    if (token.split("/").length > 2) return "a file path";
    if (token.includes("*")) return "a path glob";
    if (FILE_EXTENSION.test(token)) return "a file path";
    return undefined;
  }
  if (/^\*\.[a-z0-9]+$/i.test(token) || token.includes("**")) return "a path glob";
  if (FILE_EXTENSION.test(token) && !CANDIDATE_FILE.test(token) && /^[\w<>*.-]+$/.test(token)) return "a file name";
  return undefined;
}

function pathFindings(subject: string, where: string, text: string): TargetFinding[] {
  const findings: TargetFinding[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[\s`|]+/)) {
    const reason = pathReason(raw);
    const token = trimToken(raw);
    if (reason && !seen.has(token)) {
      seen.add(token);
      findings.push({ check: VIEWS_INPUTS_ONLY, subject, detail: `${where} names ${reason} (${token}); read the workspace only through clossys ${READ_VERBS.join("|")}` });
    }
  }
  return findings;
}

export interface ViewTarget {
  readonly agent: AgentId;
  /** The file name without `.md`. */
  readonly viewId: string;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Every finding for one view prompt file (`subject` names it in the findings). */
export function checkViewText(subject: string, text: string, target: ViewTarget): TargetFinding[] {
  const findings: TargetFinding[] = [];
  const fail = (detail: string): void => { findings.push({ check: VIEWS_INPUTS_ONLY, subject, detail }); };
  if (!VIEW_ID.test(target.viewId)) fail(`view file name ${target.viewId}.md is not a view id (${VIEW_ID.source})`);
  let header: unknown;
  try { header = readRecordHeader(`${target.viewId}.md`, text); } catch (error) {
    fail(`no clossys.view/1 header: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (header !== undefined) {
    for (const issue of validateAgainst(schema(), header)) fail(`header ${issue.path || "(root)"}: ${issue.message}`);
    if (isObject(header)) {
      const id = `${target.agent}/views/${target.viewId}`;
      if (header.id !== id) fail(`header id ${JSON.stringify(header.id)} must be ${id} (the file's agent and name)`);
      if (header.agent !== target.agent) fail(`header agent ${JSON.stringify(header.agent)} must be ${target.agent}`);
      const inputs = Array.isArray(header.inputs) ? header.inputs : [];
      for (const input of inputs) {
        if (typeof input !== "string") continue;
        if (!INPUT.test(input)) fail(`input ${JSON.stringify(input)} must start with clossys ${READ_VERBS.join(", clossys ")}`);
        findings.push(...pathFindings(subject, `input ${JSON.stringify(input)}`, input.replace(/^clossys \S+/, "")));
        if (TOOL_NAMES.test(input)) fail(`input ${JSON.stringify(input)} names a coding tool or model (${TOOL_NAMES.exec(input)![0]})`);
      }
      for (const scope of Array.isArray(header.appliesTo) ? header.appliesTo : []) {
        if (typeof scope !== "string" || VIEW_SLOT_KINDS.includes(scope) || (VIEW_QUEUES as readonly string[]).includes(scope) || APPLIES_GLOB.test(scope)) continue;
        fail(`appliesTo ${JSON.stringify(scope)} is not a slot kind, a queue id or an <agent>/<slot-id> ref`);
      }
      const answers = Array.isArray(header.answers) ? header.answers : [];
      for (const queue of answers) if (!(VIEW_QUEUES as readonly unknown[]).includes(queue)) fail(`answers ${JSON.stringify(queue)} is not one of ${VIEW_QUEUES.join(", ")}`);
      if (answers.length && !/`clossys answer /.test(viewBody(text))) fail("the view answers a queue but its body never says how: clossys answer <queue-item> <answer> --by owner --via chat --quote \"<words>\"");
    }
  }
  const body = viewBody(text);
  if (!/^## Rules[ \t]*$/m.test(body)) fail("the ## Rules section is missing");
  findings.push(...pathFindings(subject, "the body", body));
  const read = READ_CALL.exec(body);
  if (read) fail(`the body names a raw file read (${read[0]}); read only through the CLI`);
  for (const span of codeSpans(body)) {
    if (SHELL_READ.test(span)) fail(`the body runs a raw file read (${span.trim()}); read only through the CLI`);
    for (const match of span.matchAll(/(?:^|[^\w-])clossys\s+([a-z][a-z-]*)/g)) {
      if (!BODY_VERBS.has(match[1]!)) fail(`the body runs clossys ${match[1]}: a view is read-only (clossys ${[...BODY_VERBS].join(", ")} only)`);
    }
  }
  const tool = TOOL_NAMES.exec(body);
  if (tool) fail(`the body names a coding tool, model or vendor (${tool[0]}); one view serves every chat agent`);
  return findings;
}

/** The view prompt files of one folder, sorted: `<view-id>.md`. */
export function viewFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir).filter(name => name.endsWith(".md")).sort();
}

/** Where the package views of `agent` live for `root` (the repository's packages/, or the installed package). */
export function packageViewsDir(root: string, agent: AgentId): string {
  return packagePath(root, `packages/${agent}/views`);
}

/** Where a consumer adds or shadows views of `agent`. */
export function consumerViewsDir(root: string, agent: AgentId): string {
  return join(root, "clossys", "agents", agent, "views");
}

export interface ViewsCheckOptions {
  /** Read package views (default true). */
  readonly packages?: boolean;
  /** Read consumer views under `<root>/clossys/agents/<agent>/views/` (default true). */
  readonly consumer?: boolean;
}

/** Runs `views.inputs-only` over every package and consumer view prompt `root` resolves. */
export function checkViews(root: string, options: ViewsCheckOptions = {}): TargetCheckRun & { readonly files: number } {
  const findings: TargetFinding[] = [];
  let files = 0;
  for (const agent of VIEW_AGENTS) {
    const dirs: { dir: string; label: string }[] = [];
    if (options.packages !== false) dirs.push({ dir: packageViewsDir(root, agent), label: `@clossys/${agent} views` });
    if (options.consumer !== false) dirs.push({ dir: consumerViewsDir(root, agent), label: `consumer ${agent} views` });
    for (const { dir, label } of dirs) {
      for (const name of viewFiles(dir)) {
        files++;
        const viewId = name.slice(0, -".md".length);
        findings.push(...checkViewText(`${label}: ${agent}/${viewId}`, readFileSync(join(dir, name), "utf8"), { agent, viewId }));
      }
    }
  }
  return { ...runOf(VIEWS_INPUTS_ONLY, findings), files };
}
