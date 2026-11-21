/** `clossys slot <ref> [--candidates all|live] [--root <dir>] [--json]`: one slot in full (system.md 12.3). Read-only. */
import { resolve } from "node:path";
import { RefError } from "../read/ref.js";
import { slotView, SlotViewError, type SlotView } from "../read/slot.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const SLOT_USAGE = "Usage: clossys slot <agent>/<slot-id>[/<candidate>|/package:<name>-v<n>.<ext>][#<record>] [--candidates all|live] [--root <dir>] [--json]\n"
  + "  shows one slot in full: its brief, every candidate with its check summary, the pin, who consumes it, open queue\n"
  + "  items and ledger runs (clossys.slot-view/1). Read-only. Exit 1 when the ref names no slot or candidate.";

function summary(view: SlotView): string {
  const lines = [`${view.ref}  ${view.slot.kind}  ${view.slot.status}  ${view.slot.ia.l0} > ${view.slot.ia.l1} > ${view.slot.ia.l2}`];
  if (view.slot.brief.purpose) lines.push(`  brief: ${view.slot.brief.purpose}`);
  lines.push(`  candidates: ${view.candidates.length}`);
  for (const candidate of view.candidates) lines.push(`    ${candidate.name}  ${candidate.check.status}${candidate.check.failed.length ? ` (${candidate.check.failed.join(", ")})` : ""}${candidate.briefCurrent ? "" : "  brief changed"}`);
  lines.push(view.pin.length ? `  pin: ${view.pin.map(pin => `${pin.record ? `${pin.record} ` : ""}${pin.candidate} [${pin.state}]`).join("; ")}` : "  pin: none");
  lines.push(`  used by: ${view.consumedBy.length ? view.consumedBy.join(", ") : "none"}`);
  if (view.queue.length) lines.push(`  open queue: ${view.queue.join(", ")}`);
  if (view.ledger.length) lines.push(`  ledger: ${view.ledger.join(", ")}`);
  return lines.join("\n");
}

export async function runSlotCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  let ref: string | undefined, root: string | undefined, candidates: "all" | "live" = "live";
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help") return { exitCode: 0, message: SLOT_USAGE };
    if (arg === "--json") continue;
    if (arg === "--root" || arg === "--candidates") {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${arg} requires a value\n${SLOT_USAGE}`);
      if (arg === "--root") root = value;
      else if (value === "all" || value === "live") candidates = value;
      else throw new CliUsageError(`--candidates must be all or live, got ${value}\n${SLOT_USAGE}`);
      continue;
    }
    if (arg.startsWith("--") || ref !== undefined) throw new CliUsageError(`Unknown argument: ${arg}\n${SLOT_USAGE}`);
    ref = arg;
  }
  if (ref === undefined) throw new CliUsageError(`clossys slot needs a ref\n${SLOT_USAGE}`);
  const workspace = discoverRoot(resolve(cwd, root ?? "."));
  try {
    const view = slotView(workspace, ref, { candidates });
    return { exitCode: 0, root: workspace, output: view, message: summary(view) };
  } catch (error) {
    if (error instanceof RefError) throw new CliUsageError(`${error.message}\n${SLOT_USAGE}`);
    if (error instanceof SlotViewError) return { exitCode: 1, root: workspace, message: error.message };
    throw error;
  }
}
