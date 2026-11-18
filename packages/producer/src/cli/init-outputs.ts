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
import { join, resolve } from "node:path";
import { checkPublicationOutputs, PUBLICATION_FEEDS, PUBLICATION_FORM_KINDS, publicationFormDefaults, type PublicationFeed, type PublicationForm, type PublicationFormKind, type PublicationOutputs } from "@clossys/publisher/content-map";
import { readCandidate, readSlotEntry } from "../records/slots.js";
import { writeCandidate } from "../records/slot-write.js";
import { readPinnedPublication } from "../publish/pinned-publication.js";
import { designerShareMark, writerLocaleCopy } from "../publish/install-outputs.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const INIT_OUTPUTS_USAGE = "Usage: clossys init --publication <id> [--forms contact,newsletter] [--share] [--meta json-ld,llms,rss|atom]\n"
  + "                    [--locales <default>,<locale>...] [--origin https://<host>] [--identity <name key>,<summary key>] [--root <dir>] [--json]\n"
  + "  records the publication's install outputs on a new submitted candidate of publisher/publication.<id> (never pinned).\n"
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

const META = ["json-ld", "llms", ...PUBLICATION_FEEDS] as const;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Merge the requested outputs over the pinned candidate's, check them, and submit the result as a new candidate. */
export async function initPublicationOutputs(root: string, options: InitOutputsOptions): Promise<InitOutputsResult> {
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
  const writer = await writerLocaleCopy(root);
  const installLocales = outputs.locales?.all ?? [writer.source];
  const keys = new Set<string>(outputs.identity && (outputs.share || outputs.jsonLd || outputs.llms || outputs.feed) ? [outputs.identity.name, outputs.identity.summary] : []);
  if (installLocales.length > 1 || outputs.llms || outputs.feed) for (const entry of (await readPinnedPublication(consumer, options.publication)).map.entries) keys.add(entry.title);
  const writerDrafts = installLocales.flatMap(locale => [...keys].sort().filter(key => !Object.hasOwn(writer.copy(locale), key)).map(key => ({ locale, key })));

  const stem = pin.candidate.replace(/-v\d+\.json$/, "");
  const written = writeCandidate(consumer, "publisher", slot, stem, { ...value, outputs }, { provenance: { by: "agent:publisher" } });
  return { slot, candidate: written.name, outputs, writerDrafts, needsMark: outputs.share === true && designerShareMark(root) === undefined };
}

const list = (value: string) => value.split(",").map(item => item.trim()).filter(Boolean);

export async function runInitOutputsCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  let root: string | undefined, publication: string | undefined;
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
  const workspace = discoverRoot(resolve(cwd, root ?? "."));
  const result = await initPublicationOutputs(workspace, { publication, ...options });
  const lines = [
    `submitted publisher/${result.slot}/${result.candidate} with the recorded outputs (pin it to install them)`,
    ...(result.outputs.forms ?? []).map(form => `  form ${form.id}: set ${form.targetEnv} in the host environment to its https delivery target`),
    ...result.writerDrafts.map(row => `  Writer draft needed: ${row.key} (${row.locale})`),
    ...(result.needsMark ? ["  Designer pin needed: assets.mark (share images draw it)"] : []),
  ];
  return { exitCode: 0, root: workspace, output: result, message: lines.join("\n") };
}
