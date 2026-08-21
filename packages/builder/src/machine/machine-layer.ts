import { dirname, isAbsolute, join } from "node:path";
import { CONVENTION_ADAPTERS, CONVENTION_DOCUMENTS, DOCUMENTS_ROOT, ADAPTERS_ROOT } from "@vespeneventures/controller/conventions";
import { MACHINE_DECLARATION_SCHEMA_VERSION } from "./types.js";
import type {
  DiscoveryPort,
  MachineLayerDeclaration,
  MachineLayerDeclarationFinding,
  MachineLayerDestinationDeclaration,
  MachineLayerIndeterminateReason,
  MachineLayerInstallKind,
  MachineLayerResult,
} from "./types.js";
import { loadManifest } from "../manifest.js";
import type { CopyEntry, LinkEntry, ManagedBlockEntry, Manifest } from "../types.js";

/**
 * Class 1: package-owned, account-neutral content — machine guidance, agent
 * policy rules, shell integration, command hooks — already shipped by
 * `@vespeneventures/controller/conventions`, composed through exactly the
 * same `composeInstallationPlans` classes 2 (`discovery.ts`) and 3
 * (`third-party.ts`) already use. See `./types.ts`'s doc comment on
 * `MachineLayerDeclaration` for WHERE the destination map for this class
 * lives and why (#410); this module is HOW a declaration in that shape
 * becomes a `Manifest`.
 *
 * Two tiers, deliberately split the way `packages/observer`'s
 * `coverage-declaration.ts` splits shape validation from parsing, and the
 * way `packages/integrator`'s `detectSupersession` splits internal parsing
 * (throws) from its public entry point (never throws):
 *
 *   - `validateMachineLayerDeclarationShape` / `parseMachineLayerDeclaration`
 *     / `writeMachineLayerDeclaration`: pure, catalog-agnostic shape
 *     validation. These never import `@vespeneventures/controller/conventions`'s
 *     catalog — a declaration can be well-FORMED without every `id` it names
 *     actually existing in that catalog, which is a different question tier 2
 *     below answers.
 *   - `buildClassOneManifest`: catalog-AWARE. Throws on an id this version of
 *     the catalog does not ship, or on templated content declared `"link"` —
 *     the same discipline `detectSupersession`'s internal `parseManifestNames`
 *     / `parseSupersessionMap` follow, and for the identical reason: a caller
 *     about to compose a machine is not a place for "continue with the parts
 *     that made sense."
 *   - `loadClassOnePolicy`: the public entry point. Reads the declaration
 *     through the same `DiscoveryPort` `discovery.ts` and `third-party.ts`
 *     already use, and NEVER throws — every failure in either tier above is
 *     caught here and folded into a named `indeterminate` reason, exactly the
 *     ternary this whole subpath enforces everywhere else.
 */

/** Overrides `BUILDER_MACHINE_LAYER_DECLARATION_PATH`, same shape as `resolveWorkspacesRoot` / `resolveThirdPartyRoot`. */
export const MACHINE_LAYER_DECLARATION_PATH_ENV_VAR = "BUILDER_MACHINE_LAYER_DECLARATION_PATH";

/** The source identifier this class's `NamedSourcePlan` composes under. */
export const CLASS_ONE_SOURCE = "package-conventions";

const INSTALL_KINDS: readonly MachineLayerInstallKind[] = ["link", "copy", "managed-block"];

/**
 * Where every catalog `source` this module builds resolves from — the parent
 * directory `@vespeneventures/controller/conventions`'s own `DOCUMENTS_ROOT`
 * and `ADAPTERS_ROOT` both live under. Verified once at module load, not
 * merely assumed: if a future restructuring of `controller` ever separates
 * those two roots, this module must fail loudly here rather than silently
 * resolve every class-1 source to the wrong directory.
 */
export const CLASS_ONE_SOURCE_ROOT = dirname(DOCUMENTS_ROOT);
if (dirname(ADAPTERS_ROOT) !== CLASS_ONE_SOURCE_ROOT) {
  throw new Error(
    "builder/machine/machine-layer: @vespeneventures/controller/conventions's DOCUMENTS_ROOT and ADAPTERS_ROOT " +
      "no longer share a parent directory — this module's shared-source-root assumption is stale and must be revisited.",
  );
}

export function resolveClassOneDeclarationPath(options: {
  readonly path?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): string | undefined {
  if (options.path !== undefined && options.path !== "") return options.path;
  const fromEnv = options.env?.[MACHINE_LAYER_DECLARATION_PATH_ENV_VAR];
  return fromEnv !== undefined && fromEnv !== "" ? fromEnv : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Formats an arbitrary, possibly-malformed value for a "got X" diagnostic.
 * Never throws — unlike bare `JSON.stringify`, which throws on a top-level
 * `BigInt` or a circular reference. Copied from
 * `packages/observer/src/coverage-declaration.ts`'s identical helper rather
 * than imported, so this module adds no dependency on `observer` to get it.
 */
function describeUnknown(value: unknown): string {
  if (typeof value === "bigint") return `${value}n`;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

function finding(rule: string, message: string): MachineLayerDeclarationFinding {
  return { rule, message };
}

function hasPathTraversal(destination: string): boolean {
  return destination.split(/[\\/]/).includes("..");
}

/**
 * Validates that `raw` — ANY value, not necessarily one this module produced
 * — has the shape of a well-formed `MachineLayerDeclaration`. Pure, offline,
 * and catalog-agnostic: it checks structure, not whether any `id` actually
 * exists in `@vespeneventures/controller/conventions`'s catalog (that is
 * `buildClassOneManifest`'s job, deliberately kept separate — see this
 * module's header). Returns every finding, never throws.
 */
export function validateMachineLayerDeclarationShape(raw: unknown): readonly MachineLayerDeclarationFinding[] {
  const findings: MachineLayerDeclarationFinding[] = [];

  if (!isRecord(raw)) {
    findings.push(finding("machine-layer-declaration/not-an-object", "A machine layer declaration must be an object."));
    return findings;
  }

  if (raw.schemaVersion !== MACHINE_DECLARATION_SCHEMA_VERSION) {
    findings.push(
      finding(
        "machine-layer-declaration/unsupported-schema-version",
        `"schemaVersion" must be ${JSON.stringify(MACHINE_DECLARATION_SCHEMA_VERSION)}, got ${describeUnknown(raw.schemaVersion)}.`,
      ),
    );
  }

  const destinations = raw.destinations;
  if (!Array.isArray(destinations)) {
    findings.push(finding("machine-layer-declaration/destinations-not-array", '"destinations" must be an array (an empty array is syntactically valid, though `loadClassOnePolicy` reports it indeterminate — see its doc comment).'));
    return findings;
  }

  const seenIds = new Set<string>();
  const seenDestinations = new Set<string>();
  destinations.forEach((entry: unknown, index: number) => {
    const path = `destinations[${index}]`;
    if (!isRecord(entry)) {
      findings.push(finding("machine-layer-declaration/entry-not-object", `${path} must be an object.`));
      return;
    }

    const id = entry.id;
    if (typeof id !== "string" || id.trim() === "") {
      findings.push(finding("machine-layer-declaration/missing-id", `${path}.id is required and must be a non-empty string.`));
    } else if (seenIds.has(id)) {
      findings.push(finding("machine-layer-declaration/duplicate-id", `${path}.id ${JSON.stringify(id)} is declared more than once in this declaration.`));
    } else {
      seenIds.add(id);
    }

    const install = entry.install;
    if (typeof install !== "string" || !INSTALL_KINDS.includes(install as MachineLayerInstallKind)) {
      findings.push(
        finding(
          "machine-layer-declaration/invalid-install",
          `${path}.install must be one of ${INSTALL_KINDS.map((k) => JSON.stringify(k)).join(", ")}, got ${describeUnknown(install)}.`,
        ),
      );
    }

    const destination = entry.destination;
    if (typeof destination !== "string" || destination.trim() === "") {
      findings.push(finding("machine-layer-declaration/missing-destination", `${path}.destination is required and must be a non-empty string.`));
    } else if (isAbsolute(destination) || hasPathTraversal(destination)) {
      findings.push(
        finding(
          "machine-layer-declaration/destination-not-relative",
          `${path}.destination must be relative to home, with no ".." segment: got ${JSON.stringify(destination)}.`,
        ),
      );
    } else if (seenDestinations.has(destination)) {
      findings.push(finding("machine-layer-declaration/duplicate-destination", `${path}.destination ${JSON.stringify(destination)} is claimed by more than one entry in this declaration.`));
    } else {
      seenDestinations.add(destination);
    }

    const startMarker = entry.startMarker;
    const endMarker = entry.endMarker;
    if (install === "managed-block") {
      if (typeof startMarker !== "string" || startMarker.trim() === "") {
        findings.push(finding("machine-layer-declaration/missing-start-marker", `${path}.startMarker is required when install is "managed-block".`));
      }
      if (typeof endMarker !== "string" || endMarker.trim() === "") {
        findings.push(finding("machine-layer-declaration/missing-end-marker", `${path}.endMarker is required when install is "managed-block".`));
      }
      if (typeof startMarker === "string" && typeof endMarker === "string" && startMarker === endMarker) {
        findings.push(finding("machine-layer-declaration/markers-not-distinct", `${path}: startMarker and endMarker must be distinct.`));
      }
    } else if (startMarker !== undefined || endMarker !== undefined) {
      findings.push(finding("machine-layer-declaration/markers-not-applicable", `${path}: startMarker/endMarker are only meaningful when install is "managed-block".`));
    }
  });

  return findings;
}

export interface ParsedMachineLayerDeclaration {
  readonly ok: true;
  readonly declaration: MachineLayerDeclaration;
}
export interface InvalidMachineLayerDeclaration {
  readonly ok: false;
  readonly findings: readonly MachineLayerDeclarationFinding[];
}

/**
 * Validates `raw` and, when it passes, returns it narrowed to
 * `MachineLayerDeclaration`. Never throws — a malformed declaration is data
 * for `loadClassOnePolicy` to grade, not a program error.
 */
export function parseMachineLayerDeclaration(raw: unknown): ParsedMachineLayerDeclaration | InvalidMachineLayerDeclaration {
  const findings = validateMachineLayerDeclarationShape(raw);
  if (findings.length > 0) return { ok: false, findings };
  return { ok: true, declaration: raw as MachineLayerDeclaration };
}

export interface WriteMachineLayerDeclarationInput {
  readonly destinations: readonly MachineLayerDestinationDeclaration[];
}

/**
 * Builds and serializes one `MachineLayerDeclaration` as a JSON string, ready
 * to be written to the path `resolveClassOneDeclarationPath` resolves. Pure —
 * this function never writes a file itself. Throws if the assembled
 * declaration would not pass `validateMachineLayerDeclarationShape`, mirroring
 * `packages/observer/src/coverage-declaration.ts`'s `writeCoverageDeclaration`.
 */
export function writeMachineLayerDeclaration(input: WriteMachineLayerDeclarationInput): string {
  const declaration: MachineLayerDeclaration = {
    schemaVersion: MACHINE_DECLARATION_SCHEMA_VERSION,
    destinations: input.destinations,
  };
  const findings = validateMachineLayerDeclarationShape(declaration);
  if (findings.length > 0) {
    throw new Error(
      `writeMachineLayerDeclaration: refusing to serialize an invalid declaration — ${findings.map((f) => `${f.rule}: ${f.message}`).join("; ")}`,
    );
  }
  return JSON.stringify(declaration, null, 2);
}

interface CatalogEntry {
  readonly filename: string;
  readonly templated: boolean;
  readonly mode?: string;
  readonly relativeDir: "documents" | "adapters";
}

function catalogEntryFor(id: string): CatalogEntry {
  const document = CONVENTION_DOCUMENTS.find((entry) => entry.id === id);
  if (document !== undefined) {
    return { filename: document.filename, templated: document.templated, relativeDir: "documents" };
  }
  const adapter = CONVENTION_ADAPTERS.find((entry) => entry.id === id);
  if (adapter !== undefined) {
    return {
      filename: adapter.filename,
      templated: adapter.templated,
      relativeDir: "adapters",
      ...(adapter.mode !== undefined ? { mode: adapter.mode } : {}),
    };
  }
  throw new Error(
    `buildClassOneManifest: unknown convention id ${JSON.stringify(id)} — not one of @vespeneventures/controller/conventions's ` +
      `CONVENTION_DOCUMENTS or CONVENTION_ADAPTERS ids. Known document ids: ${CONVENTION_DOCUMENTS.map((d) => d.id).join(", ")}. ` +
      `Known adapter ids: ${CONVENTION_ADAPTERS.map((a) => a.id).join(", ")}.`,
  );
}

/**
 * Builds a `Manifest` from an already shape-valid `MachineLayerDeclaration`,
 * ready to hand to `loadManifest`/`createRuntimeContext`/`planInstallation`
 * completely unchanged — the same discipline `skills-manifest.ts`'s
 * `buildSkillsManifest` follows for classes 2 and 3.
 *
 * Catalog-aware and THROWS, on purpose — see this module's header. Two
 * checks only this tier can make, because they need
 * `@vespeneventures/controller/conventions`'s own catalog as ground truth:
 * every declared `id` must exist in it, and templated content (which carries
 * `${TOKEN}` placeholders `CONVENTION_DOCUMENTS/CONVENTION_ADAPTERS` already
 * flag) must never be declared `"link"` — a reader of a linked, templated
 * file receives the literal token, exactly the hazard `loadManifest` already
 * refuses for a single manifest's own `links` entries.
 */
export function buildClassOneManifest(declaration: MachineLayerDeclaration): Manifest {
  const links: LinkEntry[] = [];
  const copies: CopyEntry[] = [];
  const managedBlocks: ManagedBlockEntry[] = [];

  for (const entry of declaration.destinations) {
    const catalog = catalogEntryFor(entry.id);
    const source = join(catalog.relativeDir, catalog.filename);
    const destination = `\${HOME}/${entry.destination}`;

    if (catalog.templated && entry.install === "link") {
      throw new Error(
        `buildClassOneManifest: ${entry.id} carries \${TOKEN} placeholders and must never be linked — a reader would ` +
          `receive the literal token. Declare it as "copy" or "managed-block" instead.`,
      );
    }

    switch (entry.install) {
      case "link":
        links.push({ source, destination });
        break;
      case "copy":
        copies.push({
          source,
          destination,
          template: catalog.templated,
          ...(catalog.mode !== undefined ? { mode: catalog.mode } : {}),
        });
        break;
      case "managed-block":
        managedBlocks.push({
          source,
          destination,
          startMarker: entry.startMarker as string,
          endMarker: entry.endMarker as string,
          template: catalog.templated,
        });
        break;
    }
  }

  return loadManifest({ version: 1, links, copies, managedBlocks, privateDirectories: [] });
}

/**
 * The public entry point: reads the declaration at `options.path` through
 * `port`, and NEVER throws — every failure in either tier above is folded
 * into a named `indeterminate` reason, the same ternary `discoverAccountWorkspaces`
 * and `loadThirdPartySkills` already enforce for classes 2 and 3.
 *
 * An empty `destinations` array is `indeterminate`, not `satisfied` — the
 * same #338 reasoning `loadThirdPartySkills` and `detectSupersession`'s
 * empty-map case already apply: a declaration that places nothing is not
 * evidence class 1 has been composed, it is nothing having been evaluated.
 */
export function loadClassOnePolicy(port: DiscoveryPort, options: { readonly path: string | undefined }): MachineLayerResult {
  if (options.path === undefined) {
    return {
      verdict: "indeterminate",
      path: undefined,
      reason: "path-not-declared",
      detail: `No machine layer declaration path was supplied and ${MACHINE_LAYER_DECLARATION_PATH_ENV_VAR} is not set.`,
    };
  }

  const raw = port.readTextFile(options.path);
  if (raw === undefined) {
    return {
      verdict: "indeterminate",
      path: options.path,
      reason: "declaration-unreadable",
      detail: `${options.path}: could not be read as text`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      verdict: "indeterminate",
      path: options.path,
      reason: "declaration-malformed",
      detail: `${options.path}: ${(error as Error).message}`,
    };
  }

  const result = parseMachineLayerDeclaration(parsed);
  if (!result.ok) {
    return {
      verdict: "indeterminate",
      path: options.path,
      reason: "declaration-invalid-schema",
      detail: result.findings.map((f) => `${f.rule}: ${f.message}`).join("; "),
    };
  }

  if (result.declaration.destinations.length === 0) {
    return {
      verdict: "indeterminate",
      path: options.path,
      reason: "declaration-empty",
      detail: `${options.path} declares zero destinations — an empty declaration is not evidence class 1 has been composed, it is nothing having been evaluated.`,
    };
  }

  try {
    const manifest = buildClassOneManifest(result.declaration);
    return { verdict: "satisfied", path: options.path, manifest, sourceRoot: CLASS_ONE_SOURCE_ROOT };
  } catch (error) {
    return {
      verdict: "indeterminate",
      path: options.path,
      reason: "declaration-semantically-invalid",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
