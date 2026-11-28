/**
 * The Planner's unit rules as code (CP1-PLANNERRUN): one reader for a unit packet's `Tier:` and `Env:`
 * fields, the env rule (R-UNIT-ENV), the tier rule (R-UNIT-TIER, read as data from the tier table in the
 * Planner skill, packages/planner/skill/SKILL.md) and the self-sufficient cloud prompt `clossys unit run`
 * writes. Pure: no filesystem, clock or git access here; `./unit.ts` reads those and passes them in.
 */
import { UNIT_TIERS, type UnitEnv, type UnitTier } from "@clossys/controller/loop";

export const ENV_RULE = "R-UNIT-ENV";
export const TIER_RULE = "R-UNIT-TIER";

/** A packet the rules cannot accept: the rule it breaks and why, in one line. */
export class UnitRefusal extends Error {
  constructor(readonly rule: string, message: string) { super(message); }
}
/** An input the rules cannot be read from at all (the tier table, a packet file): exit 2, not a refusal. */
export class UnitReadError extends Error {}

export interface PacketBase {
  /** The base line as written, up to the end of its line or a following `Branch:`. */
  readonly text: string;
  readonly branch: string | null;
  readonly sha: string | null;
}

export interface UnitPacket {
  readonly path: string;
  readonly id: string;
  readonly title: string;
  readonly tier: UnitTier | null;
  readonly env: UnitEnv | null;
  readonly envReason: string | null;
  /** `Step:` as written, lowercased (`fold` is the fold gate). */
  readonly step: string | null;
  /** `Gate: YES|NO`, when the packet says. */
  readonly gate: boolean | null;
  readonly base: PacketBase | null;
  readonly branch: string | null;
  readonly repository: string | null;
  /** `## <heading>` (lowercased) -> the section's text. */
  readonly sections: ReadonlyMap<string, string>;
  /** The write set: the `## Write set` section, else the Objective. */
  readonly writeSet: string;
  readonly markdown: string;
}

const TIERS: readonly string[] = UNIT_TIERS;
const field = (name: string) => new RegExp(`^\\s*(?:[-*]\\s+)?(?:\\*\\*)?${name}(?:\\*\\*)?:\\s*(.*)$`, "i");
const FENCE = /^\s*(```|~~~)/;

/** The packet's lines outside fenced code blocks: a field shown in an example block is not a field. */
function proseLines(markdown: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (FENCE.test(line)) { fenced = !fenced; continue; }
    if (!fenced) out.push(line);
  }
  return out;
}

function sectionsOf(lines: readonly string[]): Map<string, string> {
  const sections = new Map<string, string>();
  let heading: string | null = null;
  let body: string[] = [];
  const close = () => { if (heading !== null && !sections.has(heading)) sections.set(heading, body.join("\n").trim()); };
  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) { close(); heading = match[1]!.toLowerCase(); body = []; continue; }
    if (heading !== null) body.push(line);
  }
  close();
  return sections;
}

const unquote = (text: string) => text.replace(/[*`]/g, "").trim();

/**
 * Reads one unit packet. Refuses (R-UNIT-ENV / R-UNIT-TIER) a malformed `Tier:` or `Env:` field, a `Tier:`
 * the title contradicts, and a packet with neither field nor the Objective (or Write set) its rule needs to
 * fill the field in. Every other field is optional here; the verb that needs one refuses without it.
 */
export function readPacket(markdown: string, path: string): UnitPacket {
  const lines = proseLines(markdown);
  const titleLine = lines.find(line => /^#\s+\S/.test(line));
  if (!titleLine) throw new UnitRefusal(TIER_RULE, `${path}: not a unit packet: it has no "# <ID>: <title>" line`);
  const title = titleLine.replace(/^#\s+/, "").trim();
  const id = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*:/.exec(title)?.[1] ?? (path.split(/[\\/]/).pop() ?? path).replace(/\.md$/i, "").toUpperCase();
  const first = (name: string): string | null => {
    const pattern = field(name);
    for (const line of lines) { const match = pattern.exec(line); if (match) return match[1]!.trim(); }
    return null;
  };

  let tier: UnitTier | null = null;
  const tierText = first("Tier");
  if (tierText !== null) {
    const value = unquote(tierText).split(/[\s.,;(]/)[0]!.toLowerCase();
    if (!TIERS.includes(value)) throw new UnitRefusal(TIER_RULE, `${path}: Tier: ${JSON.stringify(unquote(tierText))} is not one of ${TIERS.join(", ")}`);
    tier = value as UnitTier;
  }
  const titled = /\((low|mid|high)\b/i.exec(title)?.[1]?.toLowerCase() as UnitTier | undefined;
  if (titled && tier && titled !== tier) throw new UnitRefusal(TIER_RULE, `${path}: the title says ${titled} but Tier: says ${tier}`);
  tier ??= titled ?? null;

  let env: UnitEnv | null = null;
  let envReason: string | null = null;
  const envText = first("Env");
  if (envText !== null) {
    const match = /^(cloud|local)\b\.?\s*(?:\((.*)\))?/i.exec(unquote(envText));
    if (!match) throw new UnitRefusal(ENV_RULE, `${path}: Env: ${JSON.stringify(unquote(envText))} is not "cloud" or "local (<reason>)"`);
    env = match[1]!.toLowerCase() as UnitEnv;
    envReason = match[2]?.trim() || null;
  }

  const gateText = first("Gate");
  const gate = gateText === null ? null : /^\W*yes\b/i.test(gateText) ? true : /^\W*no\b/i.test(gateText) ? false : null;
  const stepText = first("Step");
  const prose = lines.join("\n");
  const baseMatch = /\bBase:\s*([^\n]*)/.exec(prose);
  let base: PacketBase | null = null;
  if (baseMatch) {
    const text = baseMatch[1]!.split(/\bBranch:/)[0]!.trim().replace(/[.\s]+$/, "");
    const sha = /\b(?=[0-9a-f]*[0-9])[0-9a-f]{7,40}\b/.exec(text)?.[0] ?? null;
    const branch = /`([^`\s]+)`/.exec(text)?.[1] ?? (/^branch\s+(\S+)/i.exec(text)?.[1] ?? null);
    base = { text, branch, sha };
  }
  const branch = /\bBranch:\s*`([^`\s]+)`/.exec(prose)?.[1] ?? null;
  const repository = /\bRepository:\s*`?([\w.-]+\/[\w.-]+)`?/.exec(prose)?.[1] ?? null;
  const sections = sectionsOf(lines);
  const writeSet = sections.get("write set") ?? sections.get("objective") ?? "";
  if (!writeSet && tier === null) throw new UnitRefusal(TIER_RULE, `${path}: no Tier: field and no Objective or Write set for the tier rule to fill it in from`);
  if (!writeSet && env === null) throw new UnitRefusal(ENV_RULE, `${path}: no Env: field and no Objective or Write set for the env rule to fill it in from`);
  return {
    path, id, title, tier, env, envReason, step: stepText === null ? null : unquote(stepText).split(/[\s.,;]/)[0]!.toLowerCase(),
    gate, base, branch, repository, sections, writeSet, markdown,
  };
}

/** A path shape that can only be outside a checkout: a home, an absolute system root, a parent, a drive. */
const OUTSIDE = /(?:^|[\s`'"(])((?:~|\$HOME)\/[^\s`'")]*|\.\.\/[^\s`'")]*|\/(?:home|Users|root|tmp|private|var|etc|opt|mnt|srv)\/[^\s`'")]*|[A-Za-z]:\\[^\s`'")]*)/g;

/** The paths in `text` outside the repository, in order, once each. */
export function outsidePaths(text: string): string[] {
  return [...new Set([...text.matchAll(OUTSIDE)].map(match => match[1]!))];
}

/** What the env rule reads beyond the packet: the remote as last fetched, and the unit's launch log. */
export interface EnvFacts {
  /** Whether the base is on the remote; `null` when it cannot be told (no git, no remote). */
  readonly baseOnRemote: (base: PacketBase) => boolean | null;
  /** How many of the unit's cloud launches the loop state records as failed. */
  readonly failedCloudLaunches: (unit: string) => number;
}

export interface EnvDecision {
  readonly env: UnitEnv;
  readonly reason: string;
  /** The named needs detected; empty means cloud. */
  readonly needs: readonly string[];
  readonly declared: UnitEnv | null;
}

/**
 * R-UNIT-ENV: cloud by default; local only for a named need code detects. A packet that says `Env: local`
 * with no detected need is refused, naming the rule. A need overrides a packet that says cloud.
 */
export function decideEnv(packet: UnitPacket, facts: EnvFacts): EnvDecision {
  const needs: string[] = [];
  const outside = outsidePaths(packet.writeSet);
  if (outside.length) needs.push(`the write set names a path outside the repository (${outside.join(", ")})`);
  if (packet.step === "fold" || packet.step === "fold-gate") needs.push("the step is the fold gate");
  if (packet.base) {
    const on = facts.baseOnRemote(packet.base);
    if (on === false) needs.push(`the base ${packet.base.sha ?? packet.base.branch ?? packet.base.text} is not on the remote (as last fetched)`);
  }
  const failed = facts.failedCloudLaunches(packet.id);
  if (failed >= 2) needs.push(`the launch log shows ${failed} failed cloud launches`);
  if (packet.env === "local" && needs.length === 0) {
    throw new UnitRefusal(ENV_RULE, `${packet.path}: Env: local, but no local need is detected; ${ENV_RULE}: local only when the write set names a path outside the repository, the step is the fold gate, the base commit is not on the remote, or the launch log shows two failed cloud launches`);
  }
  if (needs.length) return { env: "local", reason: needs.join("; "), needs, declared: packet.env };
  return { env: "cloud", reason: "cloud by default: no local need detected", needs, declared: packet.env };
}

/** One row of the Planner skill's tier table. */
export interface TierRow {
  readonly tier: UnitTier;
  readonly when: string;
  /** A gate-class lexicon (any term matches), or constraints (all must hold), or neither (always). */
  readonly lexicon: readonly string[];
  readonly constraints: { readonly maxBehaviours?: number; readonly maxFiles?: number; readonly failingTest?: boolean } | null;
}

export const TIER_TABLE_START = "<!-- unit-tiers:start";
export const TIER_TABLE_END = "<!-- unit-tiers:end -->";
const CONSTRAINT = /^(behaviours<=(\d+)|files<=(\d+)|failing-test)$/;

/** The tier table between the unit-tiers markers of the Planner skill, as data; a malformed table is a read error. */
export function readTierTable(skill: string, path: string): readonly TierRow[] {
  const start = skill.indexOf(TIER_TABLE_START);
  const open = start < 0 ? -1 : skill.indexOf("-->", start);
  const end = open < 0 ? -1 : skill.indexOf(TIER_TABLE_END, open);
  if (end < 0) throw new UnitReadError(`${path} has no tier table (${TIER_TABLE_START} ... ${TIER_TABLE_END})`);
  const rows: TierRow[] = [];
  for (const line of skill.slice(open + 3, end).split("\n").map(item => item.trim()).filter(Boolean)) {
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
    if (cells.length !== 3) throw new UnitReadError(`${path}: a tier table row is not "| tier | when | terms |": ${line}`);
    const [tier, when, terms] = cells as [string, string, string];
    if (tier === "tier" || /^-+$/.test(tier)) continue;
    if (!TIERS.includes(tier)) throw new UnitReadError(`${path}: tier table row names ${JSON.stringify(tier)}, not one of ${TIERS.join(", ")}`);
    if (rows.some(row => row.tier === tier)) throw new UnitReadError(`${path}: the tier table lists ${tier} twice`);
    const list = terms.split(",").map(term => term.trim()).filter(Boolean);
    const constraintTerms = list.filter(term => CONSTRAINT.test(term));
    if (constraintTerms.length && constraintTerms.length !== list.length) throw new UnitReadError(`${path}: the ${tier} row mixes constraints and lexicon terms`);
    let constraints: TierRow["constraints"] = null;
    if (constraintTerms.length) {
      const c: { maxBehaviours?: number; maxFiles?: number; failingTest?: boolean } = {};
      for (const term of constraintTerms) {
        const match = CONSTRAINT.exec(term)!;
        if (match[2] !== undefined) c.maxBehaviours = Number(match[2]);
        else if (match[3] !== undefined) c.maxFiles = Number(match[3]);
        else c.failingTest = true;
      }
      constraints = c;
    }
    rows.push({ tier: tier as UnitTier, when, lexicon: constraints ? [] : list, constraints });
  }
  const fallback = rows.findIndex(row => row.lexicon.length === 0 && row.constraints === null);
  if (fallback < 0 || fallback !== rows.length - 1) throw new UnitReadError(`${path}: the tier table needs exactly one last row with no terms (the tier for every other packet)`);
  return rows;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const termIn = (term: string, text: string) => new RegExp(`(?:^|[^a-z0-9])${escape(term)}(?:[^a-z0-9]|$)`, "i").test(text);

/** Distinct file-shaped backticked paths in the write set. */
export function writeSetFiles(packet: UnitPacket): string[] {
  return [...new Set([...packet.writeSet.matchAll(/`([^`\s]+)`/g)].map(match => match[1]!).filter(token => !token.startsWith("-") && (/\//.test(token) || /\.[A-Za-z0-9]{1,5}$/.test(token))))];
}

/** Top-level list items of the Objective; a paragraph Objective is one behaviour. */
export function behaviours(packet: UnitPacket): number {
  const objective = packet.sections.get("objective") ?? packet.writeSet;
  const items = objective.split("\n").filter(line => /^[-*]\s+/.test(line)).length;
  return items || (objective.trim() ? 1 : 0);
}

/** Whether the Validation (or Objective) names a quoted test and says it fails. */
export function namesFailingTest(packet: UnitPacket): boolean {
  const text = `${packet.sections.get("validation") ?? ""}\n${packet.sections.get("objective") ?? ""}`;
  return text.split("\n").some(line => /"[^"]+"|“[^”]+”/.test(line) && /\bfail(?:s|ing|ed)?\b/i.test(line));
}

export interface TierDecision {
  readonly tier: UnitTier;
  /** The computed tier: the packet's tier may sit above it, never below. */
  readonly floor: UnitTier;
  readonly reason: string;
  readonly declared: UnitTier | null;
}

/**
 * R-UNIT-TIER: the first tier table row whose condition holds is the floor; the packet's tier (its field or
 * title) when it has one, else the floor. A packet tier below the floor is refused, naming the rule.
 */
export function decideTier(packet: UnitPacket, table: readonly TierRow[]): TierDecision {
  const gateText = [packet.title, packet.sections.get("objective") ?? "", packet.sections.get("write set") ?? ""].join("\n");
  let floor: UnitTier | null = null;
  let reason = "";
  for (const row of table) {
    if (row.lexicon.length) {
      const hit = packet.gate === true ? "Gate: YES" : row.lexicon.find(term => termIn(term, gateText));
      if (hit) { floor = row.tier; reason = `${row.tier}: ${row.when} (${hit === "Gate: YES" ? hit : `"${hit}"`})`; break; }
      continue;
    }
    if (row.constraints) {
      const c = row.constraints, files = writeSetFiles(packet).length, count = behaviours(packet), failing = namesFailingTest(packet);
      const holds = (c.maxBehaviours === undefined || count <= c.maxBehaviours) && (c.maxFiles === undefined || files <= c.maxFiles) && (!c.failingTest || failing);
      if (holds) { floor = row.tier; reason = `${row.tier}: ${row.when} (${count} behaviour(s), ${files} file(s), a named failing test)`; break; }
      continue;
    }
    floor = row.tier; reason = `${row.tier}: ${row.when}`; break;
  }
  if (floor === null) throw new UnitReadError("the tier table matched no row");
  const declared = packet.tier;
  if (declared && TIERS.indexOf(declared) < TIERS.indexOf(floor)) {
    throw new UnitRefusal(TIER_RULE, `${packet.path}: Tier: ${declared} is below the computed floor ${floor}; ${TIER_RULE}: ${reason}`);
  }
  return { tier: declared ?? floor, floor, reason, declared };
}

/** Local path shapes withheld from a cloud prompt: a cloud executor cannot reach them, and the repository is public. */
const LOCAL_PATH = /(?:~|\$HOME)\/[^\s`'")\]]*|\/(?:home|Users|root|private\/var|var\/folders)\/[^\s`'")\]]*|[A-Za-z]:\\[^\s`'")\]]*/g;
export const WITHHELD = "<local path withheld>";
/** `text` with every local path shape replaced by WITHHELD. */
export const withholdLocalPaths = (text: string) => text.replace(LOCAL_PATH, WITHHELD);
export const PREFLIGHT_HEADING = "PREFLIGHT (first, before any work; any failure -> push nothing, final `BLOCKED: preflight <step> <error>`):";

export interface CloudLaunch {
  readonly packet: UnitPacket;
  readonly env: EnvDecision;
  readonly tier: TierDecision;
  readonly repository: string;
  readonly branch: string;
}

/** The self-sufficient prompt a cloud executor starts from: rules, preflight, no-local-files, output, then the packet with local paths withheld. */
export function cloudPrompt({ packet, env, tier, repository, branch }: CloudLaunch): string {
  const base = packet.base?.sha ?? packet.base?.branch ?? null;
  const report = `${branch}-report`;
  const body = withholdLocalPaths(packet.markdown).trimEnd();
  return [
    `You are a cloud executor for one unit, ${packet.id}, in ${repository} (public repository: nothing private in anything you commit).`,
    `Tier: ${tier.tier}. Env: cloud (${env.reason}).`,
    `Base: ${packet.base?.text ?? "the repository's default branch"}. Create branch ${branch} from it and push only ${branch} and ${report}.`,
    "Build packages package-scoped only (npm run build -w <package>).",
    "Rules: no npm publish, no version, changelog or release-catalog edits, no PR, no merge, push only your own branches. Never weaken a check, scanner, allowlist, baseline or gap list. No vitest -u, no git stash/reset/restore/checkout -- path, no force-push, no --no-verify, no rm -rf. Generated fixtures are regenerated by their own verb or script, never hand-merged. No URLs in commit messages. BLOCKED after the same error twice, or at once on a permission refusal. Last lines of REPORT.md and of your reply: DONE: <sha> (or BLOCKED: <one paragraph>), then \"model: <your serving model id>\".",
    "",
    PREFLIGHT_HEADING,
    `- \`git remote get-url origin\` names ${repository}`,
    `- \`git fetch origin${base && !packet.base?.sha ? ` ${base}` : ""}\` ok${packet.base?.sha ? `, and ${packet.base.sha} is reachable` : ""}`,
    `- \`git push --dry-run origin HEAD:refs/heads/${branch}\` ok`,
    "- `node -v`, `npm -v`, `npm ci` ok",
    "",
    "NO-LOCAL-FILES: work only in this cloud clone. A packet line that names a local path, a local lease or another repository is out of scope: describe in REPORT.md what it needed. The receipt goes in REPORT.md, never on the unit branch. The packet text is the whole spec.",
    "",
    "OUTPUT (the planner reads GitHub only):",
    `- push ${branch} (fast-forward, never a PR)`,
    `- push ${report} holding one REPORT.md: the DONE/BLOCKED line, model id, files touched, every command and its exit code, related-test new/base-red lists, timings. Public repository: no private paths, pricing or client names.`,
    `- BLOCKED also pushes ${report}.`,
    "",
    "## Packet",
    "",
    body,
    "",
  ].join("\n");
}

/** The shell command that starts the cloud session from the prompt file. */
export const cloudCommand = (promptFile: string) => `claude --cloud "$(cat '${promptFile.replace(/'/g, "'\\''")}')"`;

/** The local lease command and the tier profile a local executor runs under. */
export function localLaunch(packet: UnitPacket, tier: UnitTier, branch: string): { command: string; profile: string } {
  const profile = `program-${tier}`;
  const base = packet.base?.sha ?? packet.base?.branch;
  return { command: `wt lease ${branch}${base ? ` --base ${base}` : ""} --profile ${profile}`, profile };
}
