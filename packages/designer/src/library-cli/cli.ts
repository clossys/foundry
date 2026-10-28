#!/usr/bin/env node
import * as fs from "node:fs/promises";
import { constants, realpathSync } from "node:fs";
import { resolve as pathResolve, dirname, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDogfood, dogfoodSourceModules, DOGFOOD_PACKAGE_NAME, type DogfoodException, type NeedStatus } from "../catalog-core/dogfood.js";
import { consumerDogfoodSources, parseConsumerDogfoodContract, runConsumerDogfood } from "./consumer-dogfood.js";
import tokenSlots from "../catalog/slots/tokens.json" with { type: "json" };
import { libraryHash, loadCatalog, loadComponentCompositionRules, loadComponentRegistry, type CompositeFinding, type CompositeEmitTarget } from "../catalog-core/index.js";
import type { CompositeEngineInput } from "../catalog-core/types.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import type { SurfaceResolutionOptions } from "../catalog-core/surface-types.js";
import { readSurfacePackageEvidence } from "./surface-package-evidence.js";
import { foundrySurfaceCatalog } from "./surface-catalog.js";
import { compositeLibraryHash } from "../catalog-core/library-components.js";
import { choose, type EngineInput } from "../catalog-core/resolve.js";
import { consumptionReport } from "../catalog-core/relationships.js";
import { buildSurfaceConsumption } from "../catalog-core/surface-consumption.js";
import { buildUsageGraph, serializeUsageGraph, type UsageGraphInputs } from "../catalog-core/usage-graph.js";
import { checkLibrary, checkLibraryReceipt, emitLibrary, isLibraryChangeSet, isCompositeChangeSet, writeCompositeLibrary, writeUsageGraph, LIBRARY_EMIT_TARGETS, LibraryCheckError, LibraryConflictError, LibraryInputError, readLibrary, writeLibrary, readNeeds, writeNeeds, setNeed, NEED_STATUSES, isNeedCandidate } from "./fs-library.js";

import { reselect } from "./reselect.js";
import { generateStarter } from "./generate-starter.js";
import { selectStarter } from "./select.js";

const USAGE = `Usage: designer-library <command> --root <consumer-library>

Commands:
  status [--json]                         Describe consumer-owned fills and baseHash.
  check [--layer tokens|assets|components|sections|frames] [--observations <file>] [--json]
  emit [--check] [--target <target>] [--observations <file>]  Regenerate files, or fail on drift.
  apply --changeset <file> [--observations <file>] [--json]  Apply only explicitly instructed values.
  dogfood <path...> [--write-needs] [--json]  Derive surface findings; writes require the flag.
  dogfood-consumer <path...> --contract <file> [--json]  Check reachable consumer sources with zero exceptions.
  needs [--status open,proposed] [--json]    List needs and blocked parents.
  needs set NEED-NNN --status <status> [--candidate <json>] [--closed-by <ref>]
  graph --check|--write                  Derive usage-graph.json from consumption producers, or fail on drift.
  receipt [--base <receipt.json>] [--json]  Fail when library files differ from the last designer write receipt.
  reselect --leaf <id> --source <source-id> [--write] [--json]  Preview or apply one source.
  generate-starter --leaf <id> [--write] [--json]  Preview or author an identity starter.
  select --starter shadcn-base|custom [--write]  Unavailable until the starter engine ships.
  capture --driver <module> --out <dir> [--leaf <id>]  Capture derived WebP outside the library.
  recommend                              Unavailable until the chooser ships.

Emit targets: css-brand, css-scales, css-fonts, tailwind-theme, notices, component-index, components-consumption, surface-index, surfaces-consumption.
Composite folders also emit component targets by default; value folders retain all five value targets. No values are invented or auto-filled.
--observations supplies package-export evidence ({ "packageExports": { "<module>": ["<Export>"] } });
it defaults to <root>/component-observations.json when present. Without evidence, package-pointer leaves are refused.
Every write stamps designer-receipt.json with its command, inputs and content hash; never hand-edit library files.
reselect and generate-starter are dry runs unless --write is supplied; apply requires an explicit changeset.
Exit codes: 0 = success, 1 = failed verdict or conflict, 2 = usage, invalid input or unavailable.
`;
type Command = "reselect" | "generate-starter" | "select" | "capture" | "status" | "check" | "emit" | "apply" | "recommend" | "dogfood" | "dogfood-consumer" | "needs" | "graph" | "receipt";
type Args = { leaf?: string; source?: string; starter?: string; driver?: string; out?: string; base?: string; command: Command; root: string; layer?: string; changeset?: string; json: boolean; drift: boolean; write: boolean; targets?: CompositeEmitTarget[]; paths: string[]; writeNeeds: boolean; status?: string; candidate?: string; closedBy?: string; contract?: string; observations?: string };
export interface LibraryCliIO { out(text: string): void; error(text: string): void }
const defaultIO: LibraryCliIO = { out: text => console.log(text), error: text => console.error(text) };

function parseArgs(argv: string[]): Args {
  const [command, ...flags] = argv;
  if (!["reselect", "generate-starter", "select", "capture", "status", "check", "emit", "apply", "recommend", "dogfood", "dogfood-consumer", "needs", "graph", "receipt"].includes(command ?? "")) throw new LibraryInputError("A known command is required");
  const values = new Map<string, string>(), toggles = new Set<string>(), targets: CompositeEmitTarget[] = [], paths: string[] = [];
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i]!;
    if (!flag.startsWith("-") && ["dogfood", "dogfood-consumer", "needs"].includes(command!)) { paths.push(flag); continue; }
    if (["--json", "--check", "--write", "--write-needs"].includes(flag)) {
      if (toggles.has(flag)) throw new LibraryInputError(`Duplicate ${flag}`);
      toggles.add(flag); continue;
    }
    if (!["--root", "--layer", "--changeset", "--target", "--status", "--candidate", "--closed-by", "--contract", "--observations", "--base", "--leaf", "--source", "--starter", "--driver", "--out"].includes(flag)) throw new LibraryInputError(`Unknown option ${flag}`);
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
  if ((toggles.has("--check") && command !== "emit" && command !== "graph") || (targets.length && command !== "emit")) throw new LibraryInputError("--check requires emit or graph; --target requires emit");
  if (toggles.has("--write") && !["graph", "reselect", "generate-starter", "select"].includes(command!)) throw new LibraryInputError("--write requires graph, reselect, generate-starter or select");
  if (command === "graph" && toggles.has("--check") === toggles.has("--write")) throw new LibraryInputError("graph requires exactly one of --check or --write");
  if (toggles.has("--json") && (["emit", "recommend", "graph", "select", "capture"].includes(command!))) throw new LibraryInputError("--json requires status, check or apply");
  if (toggles.has("--write-needs") && command !== "dogfood") throw new LibraryInputError("--write-needs requires dogfood");
  if (values.has("--observations") && !["check", "emit", "apply"].includes(command!)) throw new LibraryInputError("--observations requires check, emit or apply");
  if (values.has("--base") && command !== "receipt") throw new LibraryInputError("--base requires receipt");
  if ((command === "dogfood-consumer") !== values.has("--contract")) throw new LibraryInputError("dogfood-consumer requires --contract; other commands do not accept it");
  if (["dogfood", "dogfood-consumer"].includes(command!) && !paths.length) throw new LibraryInputError("dogfood requires source paths");
  if (command === "needs" && paths.length && (paths.length !== 2 || paths[0] !== "set")) throw new LibraryInputError("needs accepts only set NEED-NNN");
  if (["--status", "--candidate", "--closed-by"].some(flag => values.has(flag)) && command !== "needs") throw new LibraryInputError("NEED options require needs");
  if (command === "needs" && !paths.length && (values.has("--candidate") || values.has("--closed-by"))) throw new LibraryInputError("candidate and closed-by require needs set");
  for (const [flag, commands] of [["--leaf", ["reselect", "generate-starter", "capture"]], ["--source", ["reselect"]], ["--starter", ["select"]], ["--driver", ["capture"]], ["--out", ["capture"]]] as const) {
    if (values.has(flag) && !(commands as readonly string[]).includes(command!)) throw new LibraryInputError(`${flag} is not accepted by ${command}`);
  }
  if (["reselect", "generate-starter"].includes(command!) && !values.has("--leaf")) throw new LibraryInputError("--leaf is required");
  if (command === "reselect" && !values.has("--source")) throw new LibraryInputError("--source is required");
  if (command === "select" && !["shadcn-base", "custom"].includes(values.get("--starter") ?? "")) throw new LibraryInputError("--starter must be shadcn-base or custom");
  if (command === "capture" && (!values.has("--driver") || !values.has("--out"))) throw new LibraryInputError("capture requires --driver and --out");
  return { leaf: values.get("--leaf"), source: values.get("--source"), starter: values.get("--starter"), driver: values.get("--driver"), out: values.get("--out"), base: values.get("--base"), paths, contract: values.get("--contract"), observations: values.get("--observations"), writeNeeds: toggles.has("--write-needs"), status: values.get("--status"), candidate: values.get("--candidate"), closedBy: values.get("--closed-by"), command: command as Command, root, layer, changeset, json: toggles.has("--json"), drift: toggles.has("--check"), write: toggles.has("--write"), ...(targets.length ? { targets } : {}) };
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

async function readOptionalJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readRegularText(path)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
type ComponentOptions = NonNullable<CompositeEngineInput["componentOptions"]>;
/**
 * Package-export evidence for package-pointer components, shaped like a persisted library's
 * component-observations.json. An explicit file must exist; the library's own file is the default.
 * Absent evidence yields an empty inventory, so package pointers stay refused (fail-closed).
 */
async function readObservations(root: string, explicit?: string): Promise<ComponentOptions> {
  const path = explicit ? pathResolve(explicit) : pathResolve(root, "component-observations.json");
  let text: string;
  try { text = await readRegularText(path); }
  catch (error) {
    if (!explicit && (error as NodeJS.ErrnoException).code === "ENOENT") return { packageExports: {} };
    throw new LibraryInputError(`observations unavailable: ${(error as NodeJS.ErrnoException).code ?? (error instanceof Error ? error.message : String(error))} ${path}`);
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new LibraryInputError(`observations malformed: invalid JSON ${path}`); }
  const record = (input: unknown): input is Record<string, unknown> => !!input && typeof input === "object" && !Array.isArray(input);
  if (!record(value) || Object.keys(value).some(key => key !== "packageExports") || !record(value.packageExports)
    || Object.values(value.packageExports).some(names => !Array.isArray(names) || names.some(name => typeof name !== "string"))) throw new LibraryInputError(`observations malformed: expected { packageExports: { <module>: string[] } } ${path}`);
  return { packageExports: value.packageExports as ComponentOptions["packageExports"] & object };
}
let bundledComponentFills: ReturnType<typeof loadCatalogBundles>["componentFills"] | undefined;
type CompositeCatalogInput = Parameters<typeof readLibrary>[1] & { values: ReturnType<typeof loadCatalog>; components: { slots: readonly { id: string }[] }; surfaces: ReturnType<typeof foundrySurfaceCatalog> };
/**
 * Usage-graph inputs for one consumer library, derived only from existing producers: consumptionReport
 * (token/asset reads), the emitted components-consumption.json and declared buildSurfaceConsumption.
 * Routes live with the product's route registry, outside the library root, so no pages are derived here.
 */
async function libraryUsageGraphInputs(root: string, catalog: ReturnType<typeof loadCatalog>, compositeCatalog: CompositeCatalogInput): Promise<UsageGraphInputs> {
  const metadata = await readOptionalJson(pathResolve(root, "metadata.json")) as { format?: string } | undefined;
  if (!metadata) throw new LibraryInputError("graph requires a library metadata.json");
  const composite = metadata.format === "composite-v1" ? await readLibrary(root, compositeCatalog) : undefined;
  const tokenLibrary: EngineInput = composite ? { catalog, library: { ...composite.values, source: composite.source, adoptedAt: composite.adoptedAt } } : { catalog, library: await readLibrary(root, catalog) };
  const selection: Record<string, string> = {};
  for (const row of Object.values(choose(tokenLibrary).chosen)) { const meta = row.fill.$extensions["com.clossys.fill"]; selection[meta.slot] ??= meta.id; }
  const surfaceFills = (composite?.surfaces?.fills ?? []).map(fill => fill.$extensions["com.clossys.fill"]);
  for (const meta of [...(composite?.components.fills ?? []).map(fill => fill.$extensions["com.clossys.fill"]), ...surfaceFills]) selection[meta.slot] = meta.id;
  const layer = (name: string) => catalog.slots.filter(slot => slot.layer === name);
  const surfaceSlots = composite?.surfaces ? compositeCatalog.surfaces.slots : [];
  const emitted = composite ? await readOptionalJson(pathResolve(root, "components-consumption.json")) as { leaves?: { slot: string; reads?: { tokens?: Readonly<Record<string, string>>; assets?: string[] } }[]; reverseComposes?: Record<string, string[]> } | undefined : undefined;
  // emitComponents writes each leaf's token reads as { memberId: cssProperty } (ResolvedComponent.reads.tokens); the graph needs the member ids.
  const tokenReads = (tokens: unknown): string[] => {
    if (tokens === undefined) return [];
    if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) throw new LibraryInputError("components-consumption.json leaf token reads must map member ids to properties");
    return Object.keys(tokens).sort();
  };
  const surfaces = composite?.surfaces ? buildSurfaceConsumption({
    tokens: layer("tokens").map(slot => ({ id: slot.id, contract: { emit: "emit" in slot.contract ? slot.contract.emit : undefined } })) as Parameters<typeof buildSurfaceConsumption>[0]["tokens"],
    assets: layer("assets"), components: compositeCatalog.components.slots,
    sections: surfaceSlots.filter(slot => slot.layer === "sections") as unknown as Parameters<typeof buildSurfaceConsumption>[0]["sections"],
    frames: surfaceSlots.filter(slot => slot.layer === "frames") as unknown as Parameters<typeof buildSurfaceConsumption>[0]["frames"],
    // Declared contracts only: consumer surface source is not scanned here, so scanStatus stays "unavailable".
    fills: surfaceFills.map(meta => ({ id: meta.id, slot: meta.slot, source: meta.source })), sourceScans: [], themeCss: "",
  }) : undefined;
  return {
    inventory: {
      tokens: layer("tokens").map(slot => slot.id), assets: layer("assets").map(slot => slot.id),
      ...(composite ? { components: compositeCatalog.components.slots.map(slot => slot.id) } : {}),
      ...(composite?.surfaces ? { sections: surfaceSlots.filter(slot => slot.layer === "sections").map(slot => slot.id), frames: surfaceSlots.filter(slot => slot.layer === "frames").map(slot => slot.id) } : {}),
    },
    selection,
    consumption: { leaves: consumptionReport(tokenLibrary).leaves },
    ...(emitted ? { components: { fills: (emitted.leaves ?? []).filter(leaf => selection[leaf.slot]).map(leaf => ({ id: selection[leaf.slot]!, slot: leaf.slot, declaredReads: { tokens: tokenReads(leaf.reads?.tokens), assets: leaf.reads?.assets ?? [] } })), reverseComposes: emitted.reverseComposes ?? {} } } : {}),
    ...(surfaces ? { surfaces: { fills: surfaces.fills, reverseComposes: surfaces.reverseComposes } } : {}),
  };
}

/** Testable CLI entry point; importing this module never writes to a consumer library. */
export async function main(argv: string[], io: LibraryCliIO = defaultIO): Promise<number> {
  if (argv[0] === "ia-coverage") return (await import("../catalog/ia/check-coverage/cli.js")).main(argv.slice(1), io);
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0]!)) { io.out(USAGE); return 0; }
  try {
    const args = parseArgs(argv);
    if (args.command === "recommend") { io.error("recommend unavailable: the chooser has not shipped; no library was changed"); return 2; }
    if (args.command === "select") return selectStarter();
    if (args.command === "capture") {
      const { capture } = await import("./capture.js");
      const result = await capture({ root: args.root, driver: args.driver!, out: args.out!, leaf: args.leaf });
      io.out(JSON.stringify(result, null, 2)); return result.ok ? 0 : 1;
    }
    if (args.command === "receipt") {
      const verdict = await checkLibraryReceipt(args.root, args.base ? { base: JSON.parse(await readRegularText(pathResolve(args.base))) } : {});
      io.out(args.json ? JSON.stringify(verdict) : `${verdict.ok ? "Designer write receipt matches the library" : "Designer write receipt check failed"}; contentHash ${verdict.contentHash}${verdict.findings.map(finding => `\n${finding.code}${finding.path ? ` ${finding.path}` : ""} ${finding.message}`).join("")}`);
      return verdict.ok ? 0 : 1;
    }

    if (args.command === "needs") {
      if (args.paths.length) {
        if (!args.status || !NEED_STATUSES.includes(args.status as NeedStatus)) throw new LibraryInputError("needs set requires one valid --status");
        const candidate: unknown = args.candidate ? JSON.parse(args.candidate) : undefined;
        if (candidate !== undefined && !isNeedCandidate(candidate)) throw new LibraryInputError("Invalid NEED candidate");
        const need = await setNeed(args.root, args.paths[1]!, { status: args.status as NeedStatus, ...(candidate ? { candidate } : {}), ...(args.closedBy ? { closedBy: args.closedBy } : {}) }, undefined, { command: "designer-library needs set" });
        io.out(args.json ? JSON.stringify(need) : `${need.id} ${need.status}`); return 0;
      }
      const statuses = args.status?.split(",");
      if (statuses?.some(status => !NEED_STATUSES.includes(status as NeedStatus))) throw new LibraryInputError("Unknown NEED status");
      const needs = (await readNeeds(args.root)).filter(row => !statuses || statuses.includes(row.status));
      const open = needs.filter(row => row.status !== "closed"), parents = [...new Set(open.map(row => row.raisedBy))];
      io.out(args.json ? JSON.stringify({ needs, open: open.length, parents }) : `${open.length} needs are open; ${parents.length} block these parents.\nID\tStatus\tParent\tMissing\n${needs.map(row => `${row.id}\t${row.status}\t${row.raisedBy}\t${row.missing}`).join("\n")}`); return 0;
    }
    const catalog = loadCatalog();
    // The engine's normal component catalog: registry slots, the offline bundle fills and the registered composition rules.
    bundledComponentFills ??= loadCatalogBundles().componentFills;
    const compositeCatalog = { values: catalog, components: { slots: loadComponentRegistry().slots, fills: bundledComponentFills, rules: loadComponentCompositionRules() }, surfaces: foundrySurfaceCatalog() };
    // Package-pointer leaves are checked against the export inventory of the packages actually installed beside this CLI.
    const surfaceOptions = async (): Promise<SurfaceResolutionOptions> => ({ packages: await readSurfacePackageEvidence(compositeCatalog.surfaces.fills), measurements: [] });
    if (args.command === "reselect" || args.command === "generate-starter") {
      const input = { root: args.root, catalog: compositeCatalog, leaf: args.leaf!, write: args.write, componentOptions: await readObservations(args.root), surfaceOptions: await surfaceOptions() };
      const result = args.command === "reselect" ? await reselect({ ...input, source: args.source! }) : await generateStarter(input);
      io.out(JSON.stringify(result, null, args.json ? undefined : 2)); return result.verdict.ok ? 0 : 1;
    }
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
        const written = await writeNeeds(args.root, report.findings, undefined, { command: "designer-library dogfood --write-needs", inputs: { paths: args.paths } });
        for (const finding of report.findings) { const need = written.find(row => row.raisedBy === finding.raisedBy && row.missing === finding.missing); if (need) finding.needId = need.id; }
        report.needs = written.filter(need => report.findings.some(finding => finding.raisedBy === need.raisedBy && finding.missing === need.missing)).map(row => row.id);
      }
      io.out(args.json ? JSON.stringify(report) : `${report.findings.map(row => `${row.file}:${row.line} ${row.code} ${row.evidence}${row.needId ? ` (${row.needId})` : row.missing ? " (would open NEED; --write-needs to persist)" : ""}`).join("\n")}\nsummary: ${report.summary.elements} elements, ${report.summary.library} library, ${report.summary.structural} structural, ${report.summary.findings} findings; ${report.needs.length} needs`);
      return report.ok ? 0 : 1;
    }
    if (args.command === "graph") {
      const output = serializeUsageGraph(buildUsageGraph(await libraryUsageGraphInputs(args.root, catalog, compositeCatalog))), path = pathResolve(args.root, "usage-graph.json");
      if (args.write) { await writeUsageGraph(args.root, output, { command: "designer-library graph --write" }); io.out("usage-graph.json written"); return 0; }
      let current: string | undefined;
      try { current = await readRegularText(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (current !== output) { io.error("usage-graph.json is stale; run designer-library graph --root <library> --write"); return 1; }
      io.out("usage-graph.json is current"); return 0;
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
      const result = await checkLibrary(args.root, compositeCatalog, await readObservations(args.root, args.observations), await surfaceOptions()), findings = layerFindings(result.findings, args.layer);
      const ok = !findings.some(finding => finding.severity === "error");
      io.out(args.json ? JSON.stringify({ ok, findings }) : `${ok ? "Library check passed" : "Library check failed"}\n${findings.map(finding => `[${finding.severity}] ${finding.code} ${finding.message}`).join("\n")}`);
      return ok ? 0 : 1;
    }
    if (args.command === "emit") {
      const result = await emitLibrary(args.root, compositeCatalog, { check: args.drift, targets: args.targets, componentOptions: await readObservations(args.root, args.observations), surfaceOptions: await surfaceOptions(), ...(args.drift ? {} : { stamp: { command: "designer-library emit" } }) });
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
      if(!isCompositeChangeSet(changes,compositeCatalog))throw new LibraryInputError("Invalid composite changeset");const library=await writeCompositeLibrary(args.root,compositeCatalog,changes,await readObservations(args.root,args.observations),await surfaceOptions(),{command:"designer-library apply"});const result={ok:true,baseHash:compositeLibraryHash(library)};io.out(args.json?JSON.stringify(result):`Library changes applied; baseHash ${result.baseHash}`);return 0;
    }
    if (!isLibraryChangeSet(changes, catalog)) throw new LibraryInputError("Invalid library changeset");
    const library = await writeLibrary(args.root, catalog, changes, { command: "designer-library apply" });
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
