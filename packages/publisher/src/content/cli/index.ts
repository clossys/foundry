import type { ContentWriterContext } from "../composition.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CompositeCatalogData } from "@clossys/designer/catalog";
import { isContentJson } from "../json.js";
import { executePublisherCommand } from "./workflow.js";
import type { PublisherCommand, PublisherCommandResult } from "./types.js";

const commands: readonly PublisherCommand[] = ["slot-create", "candidate-add", "candidate-revise", "review", "approve", "activate", "release"];
export const PUBLISHER_CONTENT_USAGE = "node <publisher>/dist/content/node.js <slot-create|candidate-add|candidate-revise|review|approve|activate|release> --root <content/publisher> --designer <library> --catalog <catalog.json> --input <command.json> --at <ISO timestamp> [--writer <writer-context.json>]";

/** JSON files are data only: no executable config, shell, credentials or deploy adapter. */
export async function mainPublisherContent(argv: readonly string[]): Promise<PublisherCommandResult> {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return { exitCode: 0, findings: [], data: { usage: PUBLISHER_CONTENT_USAGE } };
  try {
    const command = argv[0];
    if (!commands.includes(command as PublisherCommand)) throw new TypeError("Expected a Publisher content command");
    const flags = new Map<string, string>();
    for (let index = 1; index < argv.length; index += 2) {
      const flag = argv[index]!;
      if (!["--root", "--designer", "--catalog", "--input", "--at", "--writer"].includes(flag) || flags.has(flag)) throw new TypeError(`Unknown or repeated argument: ${flag}`);
      const value = argv[index + 1];
      if (value === undefined || !value.trim() || value.startsWith("--")) throw new TypeError(`${flag} requires a value`);
      flags.set(flag, value);
    }
    for (const flag of ["--root", "--designer", "--catalog", "--input", "--at"]) if (!flags.has(flag)) throw new TypeError(`Missing ${flag}`);
    const at = flags.get("--at")!;
    if (!Number.isFinite(Date.parse(at))) throw new TypeError("--at requires an explicit ISO timestamp");
    const [catalog, input]: unknown[] = await Promise.all([flags.get("--catalog")!, flags.get("--input")!].map(async file => JSON.parse(await readFile(resolve(file), "utf8")) as unknown));
    if (!isContentJson(catalog) || !catalog || typeof catalog !== "object" || Array.isArray(catalog)) throw new TypeError("Catalog must be a JSON record");
    if (!isContentJson(input)) throw new TypeError("Command input must be finite JSON");
    const writer = flags.has("--writer") ? JSON.parse(await readFile(resolve(flags.get("--writer")!), "utf8")) as ContentWriterContext : undefined;
    return await executePublisherCommand({ command: command as PublisherCommand, root: resolve(flags.get("--root")!), designerRoot: resolve(flags.get("--designer")!), catalog: catalog as unknown as CompositeCatalogData, input, at, ...(writer === undefined ? {} : { writer }) });
  } catch (error) {
    return { exitCode: 2, findings: [{ path: "cli", rule: "publisher-cli-input", message: error instanceof Error ? error.message : "Could not read Publisher command input" }] };
  }
}

export type { PublisherCommand, PublisherCommandInput, PublisherCommandResult } from "./types.js";
