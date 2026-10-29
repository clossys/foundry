import { resolve } from "node:path";
import { activate, createRequest, listRequests, propose, resolveRequest, type NewRequest } from "./index.js";

const commands = new Set(["propose", "activate", "request"]);
const help = `Usage: strategist-check propose <id> [--from N] [--option A] [--request REQ-NNNN,…]
       strategist-check activate <id>@N[,…] --confirm msg:<session>#U<n>
       strategist-check request new --raised-by <role> --kind <kind> --cells <id,…> --detail <text>
       strategist-check request list
       strategist-check request resolve <REQ-NNNN> --ref <id>@N --confirm msg:<session>#U<n>
Options: --root <dir> (default clossys/strategist), --json, --help`;

/** Return undefined for another unit's command; all write flags are closed and explicit. */
export function runWriteCli(argv: string[]): number | undefined {
  const command = argv[0];
  if (!command || !commands.has(command)) return undefined;
  const jsonMode = argv.includes("--json");
  const emit = (value: unknown) => console.log(jsonMode ? JSON.stringify(value) : typeof value === "string" ? value : JSON.stringify(value, null, 2));
  try {
    const positional: string[] = [], flags = new Map<string, string>();
    const allowed = new Set(["--root", ...(command === "propose" ? ["--from", "--option", "--request"] : command === "activate" ? ["--confirm"] : ["--raised-by", "--kind", "--cells", "--detail", "--ref", "--confirm"])]);
    for (let i = 1; i < argv.length; i++) {
      const arg = argv[i]!;
      if (arg === "--json") continue;
      if (arg === "--help") { emit(help); return 0; }
      if (arg.startsWith("--")) {
        if (!allowed.has(arg) || flags.has(arg)) throw new Error(`Unknown or duplicate option ${arg}`);
        const value = argv[++i];
        if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
        flags.set(arg, value);
      } else positional.push(arg);
    }
    const root = resolve(flags.get("--root") ?? "clossys/strategist");
    const required = (flag: string) => { const value = flags.get(flag); if (!value) throw new Error(`Required option ${flag}`); return value; };
    const split = (value: string) => value.split(",").map(v => v.trim());
    if (command === "propose") {
      if (positional.length !== 1) throw new Error("propose requires one cell id");
      const from = flags.get("--from");
      if (from !== undefined && !/^[1-9]\d*$/.test(from)) throw new Error("--from requires a positive version");
      emit(propose(root, positional[0]!, { from: from === undefined ? undefined : Number(from), option: flags.get("--option"), requestIds: flags.has("--request") ? split(required("--request")) : undefined }));
    } else if (command === "activate") {
      if (positional.length !== 1) throw new Error("activate requires one comma-separated batch");
      emit(activate(root, split(positional[0]!), { confirm: required("--confirm") }));
    } else {
      const action = positional[0];
      const valid = action === "new" ? ["--raised-by", "--kind", "--cells", "--detail"] : action === "resolve" ? ["--ref", "--confirm"] : [];
      if ([...flags.keys()].some(f => f !== "--root" && !valid.includes(f))) throw new Error("Option does not apply to this request action");
      if (action === "list" && positional.length === 1) emit(listRequests(root));
      else if (action === "new" && positional.length === 1) emit(createRequest(root, { raisedBy: required("--raised-by"), kind: required("--kind") as NewRequest["kind"], cells: split(required("--cells")), detail: required("--detail") }));
      else if (action === "resolve" && positional.length === 2) emit(resolveRequest(root, positional[1]!, required("--ref"), required("--confirm")));
      else throw new Error("request requires new, list, or resolve <id>");
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (jsonMode) console.log(JSON.stringify({ error: message })); else console.error(`strategist-check: ${message}`);
    return message.startsWith("Activation blocked:") ? 1 : 2;
  }
}
