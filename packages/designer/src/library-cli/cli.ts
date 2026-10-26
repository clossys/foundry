#!/usr/bin/env node
import * as fs from "node:fs/promises";
import { constants, realpathSync } from "node:fs";
import { resolve as pathResolve, dirname, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDogfood, dogfoodSourceModules, DOGFOOD_PACKAGE_NAME, type DogfoodException, type NeedStatus } from "../catalog-core/dogfood.js";
import { consumerDogfoodSources, parseConsumerDogfoodContract, runConsumerDogfood } from "./consumer-dogfood.js";
import tokenSlots from "../catalog/slots/tokens.json" with { type: "json" };
import { libraryHash, loadCatalog, loadComponentRegistry, type CompositeFinding, type CompositeEmitTarget } from "../catalog-core/index.js";
import type { SurfaceResolutionOptions } from "../catalog-core/surface-types.js";
import { readSurfacePackageEvidence } from "./surface-package-evidence.js";
import { foundrySurfaceCatalog } from "./surface-catalog.js";
import { compositeLibraryHash } from "../catalog-core/library-components.js";
import type { EngineInput } from "../catalog-core/resolve.js";
import { checkLibrary, emitLibrary, isLibraryChangeSet, isCompositeChangeSet, writeCompositeLibrary, LIBRARY_EMIT_TARGETS, LibraryCheckError, LibraryConflictError, LibraryInputError, readLibrary, writeLibrary, readNeeds, writeNeeds, setNeed, NEED_STATUSES, isNeedCandidate } from "./fs-library.js";

const USAGE = `Usage: designer-library <command> --root <consumer-library>

Commands:
  status [--json]                         Describe consumer-owned fills and baseHash.
  check [--layer tokens|assets|components|sections|frames] [--json]
  emit [--check] [--target <target>]       Regenerate files, or fail on drift.
  apply --changeset <file> [--json]        Apply only explicitly instructed values.
  dogfood <path...> [--write-needs] [--json]  Derive surface findings; writes require the flag.
  dogfood-consumer <path...> --contract <file> [--json]  Check reachable consumer sources with zero exceptions.
  needs [--status open,proposed] [--json]    List needs and blocked parents.
  needs set NEED-NNN --status <status> [--candidate <json>] [--closed-by <ref>]
  recommend                              Unavailable until the chooser ships.

Emit targets: css-brand, css-scales, css-fonts, tailwind-theme, notices, component-index, components-consumption, surface-index, surfaces-consumption.
Composite folders also emit component targets by default; value folders retain all five value targets. No values are invented or auto-filled.
Chooser output belongs in the Studio basket; apply requires the human's explicit instruction in this session.
Exit codes: 0 = success, 1 = failed verdict or conflict, 2 = usage, invalid input or unavailable.
`;
type Command = "status" | "check" | "emit" | "apply" | "recommend" | "dogfood" | "dogfood-consumer" | "needs";
type Args = { command: Command; root: string; layer?: string; changeset?: string; json: boolean; drift: boolean; targets?: CompositeEmitTarget[]; paths: string[]; writeNeeds: boolean; status?: string; candidate?: string; closedBy?: string; contract?: string };
export interface LibraryCliIO { out(text: string): void; error(text: string): void }
const defaultIO: LibraryCliIO = { out: text => console.log(text), error: text => console.error(text) };

function parseArgs(argv: string[]): Args {
  const [command, ...flags] = argv;
  if (!["status", "check", "emit", "apply", "recommend", "dogfood", "dogfood-consumer", "needs"].includes(command ?? "")) throw new LibraryInputError("A known command is required");
  const values = new Map<string, string>(), toggles = new Set<string>(), targets: CompositeEmitTarget[] = [], paths: string[] = [];
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i]!;
    if (!flag.startsWith("-") && ["dogfood", "dogfood-consumer", "needs"].includes(command!)) { paths.push(flag); continue; }
    if (["--json", "--check", "--write-needs"].includes(flag)) {
      if (toggles.has(flag)) throw new LibraryInputError(`Duplicate ${flag}`);
      toggles.add(flag); continue;
    }
    if (!["--root", "--layer", "--changeset", "--target", "--status", "--candidate", "--closed-by", "--contract"].includes(flag)) throw new LibraryInputError(`Unknown option ${flag}`);
    const value = flags[++i];
    if (!value || value.startsWith("-")) throw new LibraryInputError(`${flag} requires a value`);
    if (flag === "--target") {
      if (![...LIBRARY_EMIT_TARGETS, "component-index", "components-consumption", "surface-index", "surfaces-consumption"].includes(value)) throw new LibraryInputError(`Unavailable emit target ${value}`);
      targets.push(value as CompositeEmitTarget);
    } else {
      if (values.has(flag)) throw new LibraryInputError(`Duplicate ${flag}`);
      values.set(flag, value);
    }
  }
  const root = values.get("--root");
  if (!root) throw new LibraryInputError("--root is required");
  const layer = values.get("--layer"), changeset = values.get("--changeset");
  if (layer && (command !== "check" || !["tokens", "assets", "components", "sections", "frames"].includes(layer))) throw new LibraryInputError("--layer requires check and a known layer");
  if ((command === "apply") !== !!changeset) throw new LibraryInputError("apply requires --changeset; other commands do not accept it");
  if ((toggles.has("--check") || targets.length) && command !== "emit") throw new LibraryInputError("--check and --target require emit");
  if (toggles.has("--json") && (command === "emit" || command === "recommend")) throw new LibraryInputError("--json requires status, check or apply");
  if (toggles.has("--write-needs") && command !== "dogfood") throw new LibraryInputError("--write-needs requires dogfood");
  if ((command === "dogfood-consumer") !== values.has("--contract")) throw new LibraryInputError("dogfood-consumer requires --contract; other commands do not accept it");
  if (["dogfood", "dogfood-consumer"].includes(command!) && !paths.length) throw new LibraryInputError("dogfood requires source paths");
  if (command === "needs" && paths.length && (paths.length !== 2 || paths[0] !== "set")) throw new LibraryInputError("needs accepts only set NEED-NNN");
  if (["--status", "--candidate", "--closed-by"].some(flag => values.has(flag)) && command !== "needs") throw new LibraryInputError("NEED options require needs");
  if (command === "needs" && !paths.length && (values.has("--candidate") || values.has("--closed-by"))) throw new LibraryInputError("candidate and closed-by require needs set");
  return { paths, contract: values.get("--contract"), writeNeeds: toggles.has("--write-needs"), status: values.get("--status"), candidate: values.get("--candidate"), closedBy: values.get("--closed-by"), command: command as Command, root, layer, changeset, json: toggles.has("--json"), drift: toggles.has("--check"), ...(targets.length ? { targets } : {}) };
}

/** Filter only findings attributable to the other layer; cross-layer findings stay visible. */
function layerFindings(findings: readonly CompositeFinding[], layer?: string): readonly CompositeFinding[] {
  if (!layer) return findings;
  if(layer==="sections"||layer==="frames")return findings.filter(finding=>finding.rule!=="surfaces"||finding.subject.startsWith(layer+".")||!finding.subject.match(/^(sections|frames)\./));
  if (layer === "components") return findings.filter(finding => finding.code.startsWith("K") || finding.rule === "components" || finding.subject.startsWith("components."));
  const other = layer === "tokens" ? "assets" : "tokens";
  return findings.filter(finding => {
    if (finding.code.startsWith("K") || finding.rule === "components") return false;
    if (finding.code.startsWith("A")) return layer === "assets";
    return !finding.subject.startsWith(other + ".") && !finding.subject.includes("/" + other + ".");
  });
}

async function readRegularText(path: string): Promise<string> {
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { if (!(await handle.stat()).isFile()) throw new LibraryInputError("Source must be a regular file"); return new TextDecoder("utf-8", { fatal: true }).decode(await handle.readFile()); }
  finally { await handle.close(); }
}
/** Scan explicit roots and reachable local source. Registered library primitives are boundaries. */
export async function dogfoodSources(paths: readonly string[], cwd = process.cwd()) {
  const ownSource = pathResolve(fileURLToPath(new URL("../../src", import.meta.url)));
  const files = new Map<string, string>(), localModules: Record<string, string> = {};
  const excluded = /\.(test|spec|stories|check)\.[cm]?[jt]sx?$|\.d\.ts$/;
  async function localTarget(base: string): Promise<string | undefined> {
    const bare = base.replace(/\.[cm]?jsx?$/, "");
    for (const candidate of [base, bare + ".tsx", bare + ".ts", bare + ".jsx", bare + ".js", join(bare, "index.tsx"), join(bare, "index.ts")]) {
      try { if ((await fs.lstat(candidate)).isFile()) return candidate; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ENOTDIR") throw error; }
    }
    return undefined;
  }
  async function visit(path: string): Promise<void> {
    const info = await fs.lstat(path);
    if (info.isSymbolicLink()) throw new LibraryInputError("Source symlink is not scanned");
    if (info.isDirectory()) {
      for (const name of (await fs.readdir(path)).sort()) if (!["node_modules", ".git", "dist", "build", "coverage"].includes(name)) await visit(join(path, name));
      return;
    }
    if (!info.isFile() || !/[.][cm]?[jt]sx?$/.test(path) || excluded.test(path) || files.has(path)) return;
    const content = await readRegularText(path); files.set(path, content);
    const display = relative(cwd, path).split("\\").join("/");
    for (const module of dogfoodSourceModules(content)) {
      let target: string | undefined;
      if (module.startsWith(".")) target = await localTarget(pathResolve(dirname(path), module));
      else if (module === `${DOGFOOD_PACKAGE_NAME}/studio`) target = await localTarget(join(ownSource, "studio/index.ts"));
      if (!target) continue;
      const owned = relative(ownSource, target).split("\\").join("/");
      const primitive = /^(components|icons|charts|blocks|shell)\//.exec(owned)?.[1];
      if (primitive) { localModules[`${display}:${module}`] = `${DOGFOOD_PACKAGE_NAME}/${primitive}`; continue; }
      await visit(target);
    }
  }
  for (const path of paths) await visit(pathResolve(cwd, path));
  return { files: [...files].map(([path, content]) => ({ file: relative(cwd, path).split("\\").join("/"), content })), localModules };
}

/** Testable CLI entry point; importing this module never writes to a consumer library. */
export async function main(argv: string[], io: LibraryCliIO = defaultIO): Promise<number> {
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0]!)) { io.out(USAGE); return 0; }
  try {
    const args = parseArgs(argv);
    if (args.command === "recommend") { io.error("recommend unavailable: the chooser has not shipped; no library was changed"); return 2; }

    if (args.command === "needs") {
      if (args.paths.length) {
        if (!args.status || !NEED_STATUSES.includes(args.status as NeedStatus)) throw new LibraryInputError("needs set requires one valid --status");
        const candidate: unknown = args.candidate ? JSON.parse(args.candidate) : undefined;
        if (candidate !== undefined && !isNeedCandidate(candidate)) throw new LibraryInputError("Invalid NEED candidate");
        const need = await setNeed(args.root, args.paths[1]!, { status: args.status as NeedStatus, ...(candidate ? { candidate } : {}), ...(args.closedBy ? { closedBy: args.closedBy } : {}) });
        io.out(args.json ? JSON.stringify(need) : `${need.id} ${need.status}`); return 0;
      }
      const statuses = args.status?.split(",");
      if (statuses?.some(status => !NEED_STATUSES.includes(status as NeedStatus))) throw new LibraryInputError("Unknown NEED status");
      const needs = (await readNeeds(args.root)).filter(row => !statuses || statuses.includes(row.status));
      const open = needs.filter(row => row.status !== "closed"), parents = [...new Set(open.map(row => row.raisedBy))];
      io.out(args.json ? JSON.stringify({ needs, open: open.length, parents }) : `${open.length} needs are open; ${parents.length} block these parents.\nID\tStatus\tParent\tMissing\n${needs.map(row => `${row.id}\t${row.status}\t${row.raisedBy}\t${row.missing}`).join("\n")}`); return 0;
    }
    const catalog = loadCatalog();
    const compositeCatalog = { values: catalog, components: { slots: loadComponentRegistry().slots, fills: [] }, surfaces: foundrySurfaceCatalog() };
    // Package-pointer leaves are checked against the export inventory of the packages actually installed beside this CLI.
    const surfaceOptions = async (): Promise<SurfaceResolutionOptions> => ({ packages: await readSurfacePackageEvidence(compositeCatalog.surfaces.fills), measurements: [] });
    if (args.command === "dogfood" || args.command === "dogfood-consumer") {
      const needs = await readNeeds(args.root);
      const consumerSources = args.contract ? await consumerDogfoodSources(args.paths, parseConsumerDogfoodContract(JSON.parse(await readRegularText(pathResolve(args.contract)))), dirname(pathResolve(args.contract))) : undefined;
      const sources = consumerSources ?? await dogfoodSources(args.paths);
      const themePath = pathResolve(args.root, "theme.css");
      let themeCss = "";
      try { themeCss = await readRegularText(themePath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      let exceptions: DogfoodException[] = [];
      try { const value: unknown = args.contract ? [] : JSON.parse(await readRegularText(pathResolve(args.root, "dogfood-exceptions.json"))); if (!Array.isArray(value) || value.some(row => !row || typeof row !== "object" || !["name", "file", "elementId", "hash", "reason", "owner", "expiry"].every(key => typeof row[key] === "string"))) throw new LibraryInputError("Invalid dogfood exception manifest"); exceptions = value; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const tokens = tokenSlots.map(slot => ({ id: slot.id, contract: { emit: Object.fromEntries(Object.entries(slot.contract.emit ?? {}).filter(([, property]) => typeof property === "string")) } }));
      let tokenLibrary: EngineInput | undefined;
      if (consumerSources) {
        let metadata: { format?: string } | undefined;
        try { metadata = JSON.parse(await readRegularText(pathResolve(args.root, "metadata.json"))); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (metadata?.format === "composite-v1") {
          const library = await readLibrary(args.root, compositeCatalog);
          tokenLibrary = { catalog, library: { ...library.values, source: library.source, adoptedAt: library.adoptedAt } };
        } else if (metadata !== undefined) tokenLibrary = { catalog, library: await readLibrary(args.root, catalog) };
      }
      const report = consumerSources ? runConsumerDogfood({ ...consumerSources, needs, tokens, themeCss, tokenLibrary }) : runDogfood({ ...sources, needs, tokens, themeCss, exceptions });
      if (args.writeNeeds) {
        const written = await writeNeeds(args.root, report.findings);
        for (const finding of report.findings) { const need = written.find(row => row.raisedBy === finding.raisedBy && row.missing === finding.missing); if (need) finding.needId = need.id; }
        report.needs = written.filter(need => report.findings.some(finding => finding.raisedBy === need.raisedBy && finding.missing === need.missing)).map(row => row.id);
      }
      io.out(args.json ? JSON.stringify(report) : `${report.findings.map(row => `${row.file}:${row.line} ${row.code} ${row.evidence}${row.needId ? ` (${row.needId})` : row.missing ? " (would open NEED; --write-needs to persist)" : ""}`).join("\n")}\nsummary: ${report.summary.elements} elements, ${report.summary.library} library, ${report.summary.structural} structural, ${report.summary.findings} findings; ${report.needs.length} needs`);
      return report.ok ? 0 : 1;
    }
    if (args.command === "status") {
      const metadata = JSON.parse(await readRegularText(pathResolve(args.root, "metadata.json")));
      if (metadata.format === "composite-v1") {
        const library = await readLibrary(args.root, compositeCatalog);
        const status = { consumer: library.source.id, baseHash: compositeLibraryHash(library), complete: library.values.complete === true, slots: [...library.values.fills, ...library.components.fills,...(library.surfaces?.fills??[])].map(fill => fill.$extensions["com.clossys.fill"].slot).sort() };
        io.out(args.json ? JSON.stringify(status) : `${status.consumer}: ${status.slots.length} consumer fills; baseHash ${status.baseHash}; complete ${status.complete}\n${status.slots.join("\n")}`);
        return 0;
      }
      const library = await readLibrary(args.root, catalog);
      const status = { consumer: library.source.id, baseHash: libraryHash(library), complete: library.complete === true, slots: library.fills.map(fill => fill.$extensions["com.clossys.fill"].slot).sort() };
      io.out(args.json ? JSON.stringify(status) : `${status.consumer}: ${status.slots.length} consumer fills; baseHash ${status.baseHash}; complete ${status.complete}\n${status.slots.join("\n")}`);
      return 0;
    }
    if (args.command === "check") {
      if((args.layer==="sections"||args.layer==="frames")&&(await readLibrary(args.root,compositeCatalog)).surfaces===undefined)throw new LibraryInputError("Surface layers unavailable until the library opts in");
      const result = await checkLibrary(args.root, compositeCatalog, undefined, await surfaceOptions()), findings = layerFindings(result.findings, args.layer);
      const ok = !findings.some(finding => finding.severity === "error");
      io.out(args.json ? JSON.stringify({ ok, findings }) : `${ok ? "Library check passed" : "Library check failed"}\n${findings.map(finding => `[${finding.severity}] ${finding.code} ${finding.message}`).join("\n")}`);
      return ok ? 0 : 1;
    }
    if (args.command === "emit") {
      const result = await emitLibrary(args.root, compositeCatalog, { check: args.drift, targets: args.targets, surfaceOptions: await surfaceOptions() });
      io.out(result.ok ? args.drift ? "Library emission is current" : "Library emission written" : `Library emission drift: ${result.drift.join(", ")}`);
      return result.ok ? 0 : 1;
    }
    const handle = await fs.open(pathResolve(args.changeset!), constants.O_RDONLY | constants.O_NOFOLLOW);
    let changes: unknown;
    try {
      if (!(await handle.stat()).isFile()) throw new LibraryInputError("Changeset must be a regular file");
      changes = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await handle.readFile()));
    } finally { await handle.close(); }
    if(changes&&typeof changes==="object"&&"baseHash" in changes&&typeof changes.baseHash==="string"&&changes.baseHash.startsWith("sha256:")){
      if(!isCompositeChangeSet(changes,compositeCatalog))throw new LibraryInputError("Invalid composite changeset");const library=await writeCompositeLibrary(args.root,compositeCatalog,changes,undefined,await surfaceOptions());const result={ok:true,baseHash:compositeLibraryHash(library)};io.out(args.json?JSON.stringify(result):`Library changes applied; baseHash ${result.baseHash}`);return 0;
    }
    if (!isLibraryChangeSet(changes, catalog)) throw new LibraryInputError("Invalid library changeset");
    const library = await writeLibrary(args.root, catalog, changes);
    const result = { ok: true, baseHash: libraryHash(library) };
    io.out(args.json ? JSON.stringify(result) : `Library changes applied; baseHash ${result.baseHash}`);
    return 0;
  } catch (error) {
    if (error instanceof LibraryCheckError) {
      io.error(JSON.stringify({ ok: false, findings: error.result.findings })); return 1;
    }
    io.error(`designer-library: ${error instanceof Error ? error.message : String(error)}`);
    return error instanceof LibraryConflictError ? 1 : 2;
  }
}

const argvPath = process.argv[1];
if (argvPath) {
  let isMain = false;
  try { isMain = realpathSync(pathResolve(argvPath)) === realpathSync(fileURLToPath(import.meta.url)); } catch { /* Importing a module never invokes the bin. */ }
  if (isMain) process.exitCode = await main(process.argv.slice(2));
}
