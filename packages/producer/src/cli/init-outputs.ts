/**
 * `clossys init --publication <id> ...`: records a publication's install outputs (form endpoints,
 * share images, page meta, locales) on a new submitted candidate of its Publisher slot
 * (`publisher/publication.<id>`). The pinned candidate is the base; nothing is pinned here, so the
 * owner pins it like any other candidate, and `clossys publish --install --next` installs it.
 *
 * Init writes no copy and no visuals. It reports each Writer key a recorded locale does not yet
 * hold, so the Writer drafts it, and the share images need the Designer's pinned `assets.mark`.
 * A form names the environment variable of its delivery target; no value is ever recorded.
 */
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkPublicationOutputs, PUBLICATION_FEEDS, PUBLICATION_FORM_KINDS, publicationFormDefaults, type PublicationFeed, type PublicationForm, type PublicationFormKind, type PublicationOutputs } from "@clossys/publisher/content-map";
import { readCandidate, readSlotEntry } from "../records/slots.js";
import type { WriteGuard } from "../records/slot-write.js";
import { PACKAGE_ROOT } from "../pipeline/options.js";
import { readPinnedPublication } from "../publish/pinned-publication.js";
import { designerShareMark, writerLocaleCopy } from "../publish/install-outputs.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { runNextSubmitCli } from "./next.js";
import { discoverRoot } from "./root.js";

export const INIT_OUTPUTS_USAGE = "Usage: clossys init --publication <id> [--forms contact,newsletter] [--share] [--meta json-ld,llms,rss|atom]\n"
  + "                    [--locales <default>,<locale>...] [--origin https://<host>] [--identity <name key>,<summary key>]\n"
  + "                    --model <id> --tier low|mid|high --basis agent|owner|planner --skill <path> [--rung adapt|create] [--seed <id>] [--reason <text>] [--root <dir>] [--json]\n"
  + "  records the publication's install outputs on a new submitted candidate of publisher/publication.<id> (never pinned).\n"
  + "  The candidate goes through clossys next --submit (schema, slot model, write guard, symlink refusal, ladder): --rung\n"
  + "  defaults to adapt with --seed the pinned candidate, so the slot's latest verdict must be create (P2).\n"
  + "  Forms name an environment variable for their delivery target; set it in the host, never in a record.";

export interface InitOutputsOptions {
  readonly publication: string;
  readonly forms?: readonly PublicationFormKind[];
  readonly share?: boolean;
  readonly meta?: readonly ("json-ld" | "llms" | PublicationFeed)[];
  readonly locales?: readonly string[];
  readonly origin?: string;
  readonly identity?: { readonly name: string; readonly summary: string };
}
export interface InitOutputsResult {
  readonly slot: string;
  readonly candidate: string;
  readonly outputs: PublicationOutputs;
  /** Writer keys a recorded locale does not hold yet: the Writer drafts each before that locale installs. */
  readonly writerDrafts: readonly { readonly locale: string; readonly key: string }[];
  /** True when share images are recorded and the Designer pins no `assets.mark`. */
  readonly needsMark: boolean;
}

/** The submit provenance init passes to `clossys next --submit`: the seat's model and tier, the basis, the contract skill and the ladder rung. */
export interface InitSubmit {
  readonly model: string;
  readonly tier: string;
  readonly basis: string;
  readonly skill: string;
  /** Defaults to adapt, with the pinned candidate as the seed. */
  readonly rung?: string;
  readonly seed?: string;
  readonly reason?: string;
}
/** The candidates verb refused the init write: its result, with nothing written. */
export class InitOutputsRefusal extends Error {
  constructor(readonly result: CliResult) { super(result.message); this.name = "InitOutputsRefusal"; }
}

const META = ["json-ld", "llms", ...PUBLICATION_FEEDS] as const;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Merge the requested outputs over the pinned candidate's, check them, and submit the result as a new
 * candidate through `clossys next --submit` (the one guarded candidates verb), so it is refused, and
 * nothing is written, exactly where any other submission would be.
 */
export async function initPublicationOutputs(root: string, options: InitOutputsOptions, submit: InitSubmit, guard: WriteGuard = true, packageRoot = PACKAGE_ROOT): Promise<InitOutputsResult> {
  const consumer = join(root, "clossys");
  const slot = `publication.${options.publication}`;
  const pin = readSlotEntry(consumer, "publisher", slot)?.pin;
  if (!pin) throw new Error(`init: publisher/${slot} has no pinned candidate to record outputs on`);
  const pinned = readCandidate(consumer, "publisher", slot, pin.candidate);
  if (pinned.sha256 !== pin.sha256) throw new Error(`init: publisher/${slot}/${pin.candidate} drifted from its pin`);
  const value: unknown = JSON.parse(pinned.bytes);
  if (!object(value)) throw new Error(`init: publisher/${slot}/${pin.candidate} is not a JSON object`);
  const base = (object(value.outputs) ? value.outputs : {}) as PublicationOutputs;

  const forms: PublicationForm[] = [...(base.forms ?? [])];
  for (const kind of options.forms ?? []) if (!forms.some(form => form.id === kind)) forms.push(publicationFormDefaults(kind));
  const feed = options.meta?.find((item): item is PublicationFeed => (PUBLICATION_FEEDS as readonly string[]).includes(item));
  const identity = options.identity ?? base.identity;
  const origin = options.origin ?? base.origin;
  const locales = options.locales?.length ? { default: options.locales[0]!, all: [...options.locales] } : base.locales;
  const outputs: PublicationOutputs = {
    ...base,
    ...(origin !== undefined ? { origin } : {}),
    ...(identity !== undefined ? { identity } : {}),
    ...(forms.length ? { forms } : {}),
    ...(options.share ? { share: true } : {}),
    ...(options.meta?.includes("json-ld") ? { jsonLd: true } : {}),
    ...(options.meta?.includes("llms") ? { llms: true } : {}),
    ...(feed ? { feed } : {}),
    ...(locales ? { locales } : {}),
  };
  const issues = checkPublicationOutputs(outputs);
  if (issues.length) throw new Error(`init: outputs refused: ${issues.join("; ")}`);

  // Every key the outputs draw, in every recorded locale: the identity, and each page title when a second locale installs.
  // The Writer is read only when an output draws copy (a forms-only init needs no pinned Writer).
  const keys = new Set<string>(outputs.identity && (outputs.share || outputs.jsonLd || outputs.llms || outputs.feed) ? [outputs.identity.name, outputs.identity.summary] : []);
  if ((outputs.locales?.all.length ?? 1) > 1 || outputs.llms || outputs.feed) for (const entry of (await readPinnedPublication(consumer, options.publication)).map.entries) keys.add(entry.title);
  const writer = keys.size ? await writerLocaleCopy(root) : undefined;
  const installLocales = outputs.locales?.all ?? (writer ? [writer.source] : []);
  const writerDrafts = writer ? installLocales.flatMap(locale => [...keys].sort().filter(key => !Object.hasOwn(writer.copy(locale), key)).map(key => ({ locale, key }))) : [];

  const rung = submit.rung ?? "adapt";
  const seed = submit.seed ?? (rung === "create" ? undefined : `${slot}/${pin.candidate}`);
  const dir = mkdtempSync(join(tmpdir(), "clossys-init-publication-"));
  const file = join(dir, `${options.publication}.json`);
  let result: CliResult;
  try {
    writeFileSync(file, `${JSON.stringify({ ...value, outputs }, null, 2)}\n`);
    const argv = [`publisher/${slot}`, "--submit", file, "--model", submit.model, "--tier", submit.tier, "--basis", submit.basis, "--skill", submit.skill, "--rung", rung,
      ...(seed !== undefined ? ["--seed", seed] : []), ...(submit.reason !== undefined ? ["--reason", submit.reason] : []), "--root", root];
    try { result = await runNextSubmitCli(argv, root, undefined, packageRoot, guard); }
    catch (error) {
      if (error instanceof CliUsageError) throw new CliUsageError(`init --publication: ${error.message.split("\n")[0]}\n${INIT_OUTPUTS_USAGE}`);
      throw error;
    }
  } finally {
    try { unlinkSync(file); } catch { /* not written */ }
    rmdirSync(dir);
  }
  if (result.exitCode !== 0) throw new InitOutputsRefusal({ ...result, message: result.message.replace(/^next --submit refused:/, "init --publication refused:") });
  const candidate = String((result.output as { candidate?: unknown }).candidate);
  return { slot, candidate, outputs, writerDrafts, needsMark: outputs.share === true && designerShareMark(root) === undefined };
}

const list = (value: string) => value.split(",").map(item => item.trim()).filter(Boolean);

export async function runInitOutputsCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  let root: string | undefined, publication: string | undefined;
  const submit: { model?: string; tier?: string; basis?: string; skill?: string; rung?: string; seed?: string; reason?: string } = {};
  const SUBMIT_FLAGS = { "--model": "model", "--tier": "tier", "--basis": "basis", "--skill": "skill", "--rung": "rung", "--seed": "seed", "--reason": "reason" } as const;
  const options: { forms?: PublicationFormKind[]; share?: boolean; meta?: (typeof META)[number][]; locales?: string[]; origin?: string; identity?: { name: string; summary: string } } = {};
  const take = (index: number, flag: string) => {
    const value = argv[index];
    if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${flag} requires a value\n${INIT_OUTPUTS_USAGE}`);
    return value;
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help") return { exitCode: 0, message: INIT_OUTPUTS_USAGE };
    if (arg === "--json") continue;
    if (arg === "--share") { options.share = true; continue; }
    if (arg === "--root") { root = take(++index, arg); continue; }
    if (arg === "--publication") { publication = take(++index, arg); continue; }
    if (Object.hasOwn(SUBMIT_FLAGS, arg)) { submit[SUBMIT_FLAGS[arg as keyof typeof SUBMIT_FLAGS]] = take(++index, arg); continue; }
    if (arg === "--origin") { options.origin = take(++index, arg); continue; }
    if (arg === "--locales") { options.locales = list(take(++index, arg)); continue; }
    if (arg === "--forms") {
      const kinds = list(take(++index, arg));
      const bad = kinds.find(kind => !(PUBLICATION_FORM_KINDS as readonly string[]).includes(kind));
      if (bad !== undefined) throw new CliUsageError(`--forms: unknown form ${bad} (${PUBLICATION_FORM_KINDS.join(", ")})\n${INIT_OUTPUTS_USAGE}`);
      options.forms = kinds as PublicationFormKind[];
      continue;
    }
    if (arg === "--meta") {
      const items = list(take(++index, arg));
      const bad = items.find(item => !(META as readonly string[]).includes(item));
      if (bad !== undefined) throw new CliUsageError(`--meta: unknown output ${bad} (${META.join(", ")})\n${INIT_OUTPUTS_USAGE}`);
      if (items.includes("rss") && items.includes("atom")) throw new CliUsageError(`--meta: choose one feed, rss or atom\n${INIT_OUTPUTS_USAGE}`);
      options.meta = items as (typeof META)[number][];
      continue;
    }
    if (arg === "--identity") {
      const keys = list(take(++index, arg));
      if (keys.length !== 2) throw new CliUsageError(`--identity takes <name key>,<summary key>\n${INIT_OUTPUTS_USAGE}`);
      options.identity = { name: keys[0]!, summary: keys[1]! };
      continue;
    }
    throw new CliUsageError(`Unknown argument: ${arg}\n${INIT_OUTPUTS_USAGE}`);
  }
  if (publication === undefined) throw new CliUsageError(`--publication is required\n${INIT_OUTPUTS_USAGE}`);
  for (const flag of ["--model", "--tier", "--basis", "--skill"] as const) if (submit[SUBMIT_FLAGS[flag]] === undefined) throw new CliUsageError(`init --publication requires ${flag} (its candidate is submitted)\n${INIT_OUTPUTS_USAGE}`);
  const workspace = discoverRoot(resolve(cwd, root ?? "."));
  let result: InitOutputsResult;
  try { result = await initPublicationOutputs(workspace, { publication, ...options }, submit as InitSubmit); }
  catch (error) {
    if (error instanceof InitOutputsRefusal) return { ...error.result, root: workspace };
    if (error instanceof CliUsageError) throw error;
    // Every other refusal (no pin, a drifted pin, refused outputs, a symlinked slot folder) writes nothing.
    return { exitCode: 1, root: workspace, message: `init --publication refused: ${(error instanceof Error ? error.message : String(error)).replace(/^init: /, "")}` };
  }
  const lines = [
    `submitted publisher/${result.slot}/${result.candidate} with the recorded outputs (pin it to install them)`,
    ...(result.outputs.forms ?? []).map(form => `  form ${form.id}: set ${form.targetEnv} in the host environment to its https delivery target`),
    ...result.writerDrafts.map(row => `  Writer draft needed: ${row.key} (${row.locale})`),
    ...(result.needsMark ? ["  Designer pin needed: assets.mark (share images draw it)"] : []),
  ];
  return { exitCode: 0, root: workspace, output: result, message: lines.join("\n") };
}
