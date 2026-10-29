import { existsSync } from "node:fs";
const ALIASES: Record<string, ReadCommand> = { "cell-quality": "check", coherence: "cohere", completion: "complete" };
/** Read-only argv and presentation layer; checks remain in the read/check APIs. */
export const READ_COMMANDS = ["status", "cell", "check", "cohere", "complete", "brief", "handoff"] as const;
export type ReadCommand = typeof READ_COMMANDS[number];
export interface ReadArgs {
  command: ReadCommand;
  root: string;
  json: boolean;
  help: boolean;
  targets: string[];
  scope: "core" | "full";
  level: "mvs" | "l0" | "full";
  verb?: "create" | "cohere" | "unlock" | "normalize";
  write?: boolean;
  request?: boolean;
}
export interface ReadResult { code: 0 | 1 | 2; data: unknown; text: string[] }
export interface ReadServices { execute(args: ReadArgs): ReadResult }
export const READ_USAGE = `Read commands: ${READ_COMMANDS.join(", ")}
Usage: strategist-check status [--scope core|full]
       strategist-check cell <id> --verb create|cohere|unlock|normalize
       strategist-check check [<id>[@N]...]
       strategist-check cohere [<l2-id>...]
       strategist-check complete [--level mvs|l0|full]
       strategist-check brief <contract> [--write] [--request]
       strategist-check handoff <contract>
Aliases: cell-quality = check, coherence = cohere, completion = complete.
Quality, coherence and completion commands save their returned report under <root>/reports/.
All read commands accept --root <dir> (default clossys/strategist), --json and --help.
brief --write saves the brief and briefs/index.json; --request opens a missing-input request.
brief and handoff without these flags do not write.`;
const part = "[a-z]+(?:-[a-z]+)*";
const leaf = new RegExp(`^${part}\\.${part}\\.${part}$`);
const pinned = new RegExp(`^${part}\\.${part}\\.${part}(?:@[1-9][0-9]*)?$`);
const group = new RegExp(`^${part}\\.${part}$`);

export function parseReadArgs(argv: string[]): ReadArgs {
  const command = ALIASES[argv[0] ?? ""] ?? argv[0] as ReadCommand;
  if (!READ_COMMANDS.includes(command)) throw new Error("Unknown read command");
  const args: ReadArgs = { command, root: "clossys/strategist", json: false, help: false, targets: [], scope: "core", level: "mvs" };
  const seen = new Set<string>();
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--help" || token === "-h") { args.help = true; continue; }
    if (token === "--json") { args.json = true; continue; }
    if (token === "--write" || token === "--request") {
      if (command !== "brief" || seen.has(token)) throw new Error(`${token} requires brief and may be given only once`);
      seen.add(token);
      if (token === "--write") args.write = true; else args.request = true;
      continue;
    }
    if (["--root", "--scope", "--level", "--verb"].includes(token)) {
      if (seen.has(token)) throw new Error(`Repeated option ${token}`);
      seen.add(token);
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`${token} needs a value`);
      if (token === "--root") args.root = value;
      if (token === "--scope") {
        if (command !== "status" || !["core", "full"].includes(value)) throw new Error("--scope needs status and core|full");
        args.scope = value as ReadArgs["scope"];
      }
      if (token === "--level") {
        if (command !== "complete" || !["mvs", "l0", "full"].includes(value)) throw new Error("--level needs complete and mvs|l0|full");
        args.level = value as ReadArgs["level"];
      }
      if (token === "--verb") {
        if (command !== "cell" || !["create", "cohere", "unlock", "normalize"].includes(value)) throw new Error("Invalid cell verb");
        args.verb = value as ReadArgs["verb"];
      }
    } else if (token.startsWith("-")) throw new Error(`Unsupported read option ${token}`);
    else args.targets.push(token);
  }
  if (args.help) return args;
  const targets = args.targets;
  if (["status", "complete"].includes(command) && targets.length) throw new Error(`${command} takes no targets`);
  if (["brief", "handoff"].includes(command) && targets.length !== 1) throw new Error(`${command} needs one contract`);
  if (command === "check" && targets.some(id => !pinned.test(id))) throw new Error("Invalid cell reference");
  if (command === "cohere" && targets.some(id => !group.test(id))) throw new Error("Invalid L2 id");
  if (command === "cell") {
    if (targets.length !== 1 || !args.verb) throw new Error("cell needs one id and --verb");
    const id = targets[0]!;
    const expected = leaf.test(id) ? "create" : group.test(id) ? "cohere" : id === "strategy" ? "normalize" : new RegExp(`^${part}$`).test(id) ? "unlock" : undefined;
    if (args.verb !== expected) throw new Error("Cell id level does not match --verb");
  }
  return args;
}

export function runReadCommand(argv: string[], services: ReadServices, print: (text: string) => void = console.log): number {
  const json = argv.includes("--json");
  try {
    const args = parseReadArgs(argv);
    if (args.help) { print(json ? JSON.stringify({ command: args.command, code: 0, help: READ_USAGE }) : READ_USAGE); return 0; }
    const result = services.execute(args);
    if (args.json) print(JSON.stringify({ command: args.command, code: result.code, result: result.data }));
    else for (const line of result.text) print(line);
    return result.code;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    print(json ? JSON.stringify({ command: argv[0], code: 2, error: message }) : `strategist-check: ${message}`);
    return 2;
  }
}

/** An explicit root selects cell-model handoff; path forms keep the 0.6 meaning. */
export function isReadCommand(argv: string[]): boolean {
  if (argv[0] !== "handoff") return READ_COMMANDS.includes((ALIASES[argv[0] ?? ""] ?? argv[0]) as ReadCommand);
  if (argv.includes("--root")) return true;
  const target = argv[1];
  if (!target || target === "--help" || target === "-h") return false;
  return !target.includes("/") && !target.includes("\\") && !existsSync(target);
}
