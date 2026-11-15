/**
 * `clossys render`: any candidate from any agent rendered as a specimen (system.md 12.4, 14.3).
 * The driver is `src/specimen/render.ts`; this module parses arguments and prints.
 *
 *   clossys render <agent>/<slot-id>[/<candidate>] [--compare <agent>/<slot-id>/<candidate>] [--json]
 *     renders every live candidate of the slot (or the one named) under `.clossys/renders/` and
 *     prints the `clossys.render/1` result (`--json`: the result alone, on stdout).
 *   clossys render <slot> <candidate> | <slot> --draft <file>
 *     the int2 Designer form: one element candidate (or an unsubmitted craft direction) rendered
 *     through the specimen harness, cached by (candidate sha256, dependency pin-set hash). A
 *     dependency that is missing, unreadable or unpinned is refused (exit 1).
 *
 * `--draft <file>` renders a craft direction before it is submitted (section 5b, stage 3) as the
 * slot's next candidate from a temporary copy of the consumer's records; the consumer's records
 * are never written.
 */
import { resolve } from "node:path";
import {
  MODEL_AGENTS,
} from "../records/slot-model/index.js";
import {
  renderCandidate, renderRef, RenderUsageError, type RenderIndex, type RenderResult, type Snapshot,
} from "../specimen/render.js";
import { CliUsageError } from "./args.js";
import { discoverRoot } from "./root.js";

export {
  DEFAULT_RENDER_CACHE, DEFAULT_RENDER_WIDTHS, RENDER_CACHE_VERSION, dependencyPins, renderCandidate, renderKey,
  type RenderedWidth, type RenderResult,
} from "../specimen/render.js";

export const RENDER_USAGE = "Usage: clossys render <agent>/<slot-id>[/<candidate>] [--compare <agent>/<slot-id>/<candidate>] [--root <dir>] [--theme <t>] [--width <px,px>] [--cache <dir>] [--json]\n"
  + "       clossys render <agent>/<slot-id> --draft <file> [--root <dir>] [--theme <t>] [--width <px,px>] [--cache <dir>] [--json]\n"
  + "       clossys render <slot> <candidate> | <slot> --draft <file>   (Designer element form)\n"
  + "  renders candidates of any agent as specimens under .clossys/renders/ (Designer: images through the specimen harness,\n"
  + "  cached by (candidate sha256, dependency pin-set hash); other agents: text specimens) and prints the clossys.render/1\n"
  + "  result; --compare renders a second candidate beside it with one side-by-side compare.html; --draft renders a craft\n"
  + "  direction before submit (section 5b stage 3) as the slot's next candidate, from a temporary copy of the records";

export interface RenderArgs {
  readonly slot?: string;
  readonly candidate?: string;
  readonly root?: string;
  readonly theme?: string;
  readonly widths: readonly number[];
  readonly cache?: string;
  readonly draft?: string;
  readonly compare?: string;
  readonly json: boolean;
  readonly help: boolean;
}

/** True when the first positional is an `<agent>/<slot-id>[/<candidate>]` ref, not an int2 slot id. */
export const isAgentRef = (value: string | undefined): boolean => !!value && value.includes("/") && (MODEL_AGENTS as readonly string[]).includes(value.split("/")[0]!);

export function parseRenderArgs(argv: readonly string[]): RenderArgs {
  const positional: string[] = [];
  let root: string | undefined, theme: string | undefined, cache: string | undefined, draft: string | undefined, compare: string | undefined, json = false, help = false;
  const widths: number[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const value = (): string => {
      const next = argv[++index];
      if (!next || next.startsWith("--")) throw new CliUsageError(`${arg} requires a value`);
      return next;
    };
    switch (arg) {
      case "--help": help = true; break;
      case "--json": json = true; break;
      case "--root": root = value(); break;
      case "--theme": theme = value(); break;
      case "--cache": cache = value(); break;
      case "--draft": draft = value(); break;
      case "--compare": compare = value(); break;
      case "--width":
        for (const part of value().split(",")) {
          if (!/^\d{3,4}$/.test(part) || Number(part) < 200 || Number(part) > 3840) throw new CliUsageError("--width must be 200-3840 (comma-separated)");
          widths.push(Number(part));
        }
        break;
      default:
        if (arg.startsWith("--")) throw new CliUsageError(`unknown argument ${arg}`);
        positional.push(arg);
    }
  }
  if (positional.length > 2) throw new CliUsageError(`unexpected ${positional[2]}`);
  if (isAgentRef(positional[0]) && positional.length > 1) throw new CliUsageError(`unexpected ${positional[1]} (a ref names its candidate: <agent>/<slot-id>/<candidate>)`);
  if (draft !== undefined && positional.length > 1) throw new CliUsageError(`--draft and a candidate name are separate calls (got ${positional[1]})`);
  if (compare !== undefined && !isAgentRef(positional[0])) throw new CliUsageError("--compare needs an <agent>/<slot-id>/<candidate> ref");
  return {
    ...(positional[0] ? { slot: positional[0] } : {}), ...(positional[1] ? { candidate: positional[1] } : {}), ...(root ? { root } : {}), ...(theme ? { theme } : {}),
    ...(cache ? { cache } : {}), ...(draft !== undefined ? { draft } : {}), ...(compare ? { compare } : {}), widths, json, help,
  };
}

export interface RenderCliResult { exitCode: 0 | 1 | 2; message: string; output?: RenderResult; index?: RenderIndex }

function indexLines(index: RenderIndex): string[] {
  const rows = index.specimens.map(row => `  ${row.candidate}  ${row.specimen}${row.locale ? `  ${row.locale}` : ""}${row.width ? `  ${row.width}` : ""}  ${row.png ?? row.html}`);
  return [`render  ${index.ref}${index.compare ? `  --compare ${index.compare}` : ""}`, ...rows, ...(index.compareHtml ? [`  side-by-side  ${index.compareHtml}`] : []), JSON.stringify(index)];
}

export async function runRenderCli(argv: readonly string[], cwd = process.cwd(), snapshot?: Snapshot): Promise<RenderCliResult> {
  try {
    const args = parseRenderArgs(argv);
    if (args.help) return { exitCode: 0, message: RENDER_USAGE };
    const root = () => discoverRoot(resolve(cwd, args.root ?? "."));
    const shared = { ...(args.theme ? { theme: args.theme } : {}), widths: args.widths, ...(args.cache ? { cache: args.cache } : {}), ...(snapshot ? { snapshot } : {}) };
    if (isAgentRef(args.slot)) {
      const index = await renderRef({ root: root(), ref: args.slot!, ...(args.compare ? { compare: args.compare } : {}), ...(args.draft !== undefined ? { draft: resolve(cwd, args.draft) } : {}), ...shared });
      return { exitCode: 0, message: args.json ? JSON.stringify(index) : indexLines(index).join("\n"), index };
    }
    if (!args.slot || (!args.candidate && args.draft === undefined)) throw new CliUsageError("render needs <agent>/<slot-id>[/<candidate>], <slot> <candidate> or <slot> --draft <file>");
    const output = await renderCandidate({ root: root(), slot: args.slot, ...(args.candidate ? { candidate: args.candidate } : {}), ...(args.draft !== undefined ? { draft: resolve(cwd, args.draft) } : {}), ...shared });
    if (args.json) return { exitCode: 0, message: JSON.stringify(output), output };
    const lines = output.renders.map(row => `${row.cached ? "cached" : "rendered"} ${row.width}px ${row.path}`);
    return { exitCode: 0, message: [`${output.draft ? "draft " : ""}${output.slot}/${output.candidate} sha256:${output.sha256.slice(0, 12)} pin-set:${output.pinSetHash.slice(0, 12)} (${output.dependencies.length} dependencies) ${output.theme}`, ...lines].join("\n"), output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const usage = error instanceof CliUsageError || error instanceof RenderUsageError;
    return { exitCode: usage ? 2 : 1, message: usage ? `${message}\n${RENDER_USAGE}` : message };
  }
}
