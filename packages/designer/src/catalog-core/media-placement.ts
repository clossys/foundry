import sectionSlots from "../catalog/slots/sections.json" with { type: "json" };
import frameSlots from "../catalog/slots/frames.json" with { type: "json" };
import { BACKDROP_REGISTRY, contractBackdropSlot, type BackdropRegistry } from "../tokens/interactive-backdrops.js";

/**
 * Media placement in contract data (foundry-build-0048 U23, owner 2026-11-18). Every media slot of
 * a surface contract declares where its media sits:
 *
 * - `figure`: contained in a box in the layout flow; it names its text alternative (`alt`), either
 *   a declared copy field (`{copy: <key>}`, required when the slot is) or an asset read
 *   (`{asset: <id>}` the contract may read, whose name metadata is the alternative).
 * - `backdrop`: fills behind the surface's content and is decorative (aria-hidden): it is optional,
 *   carries no alt and no copy, keeps text contrast through declared scrim members
 *   (`<slot>.scrim.*`), may paint only with registry colours the contract may read, and stills
 *   under reduced motion (every animated adopted component declares its reduced-motion policy,
 *   tokens/interactive-backdrops.ts). A section placing a backdrop runs the interactive.backdrop
 *   requirement. A surface accepts an interactive backdrop descriptor only when its contract
 *   declares a backdrop-placed slot (contractBackdropSlot); at most one slot per contract.
 *
 * Frames carry no media slots; a frame slot may still opt in with `placement: "backdrop"` under the
 * same backdrop rules, the interactive.backdrop requirement included. Non-media section slots carry
 * no placement. A figure the filled surface carries ships with its alt present and non-blank
 * (figureAltIssues).
 */

export type MediaPlacement = "figure" | "backdrop";
export type FigureAlt = { readonly copy: string } | { readonly asset: `assets.${string}` };

type Row = { readonly name?: string; readonly id?: string; readonly type?: string; readonly required?: boolean; readonly placement?: unknown; readonly alt?: unknown };
interface SurfaceContract {
  readonly slots?: readonly Row[];
  readonly members?: { readonly names?: readonly string[] };
  readonly copy?: { readonly fields?: readonly { readonly key: string; readonly required?: boolean }[] };
  readonly allowedReads?: { readonly themes?: readonly string[]; readonly assets?: readonly string[] };
  readonly requirements?: readonly { readonly check: string }[];
}
interface SurfaceSlot { readonly id: string; readonly contract: SurfaceContract }

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** The section requirement a backdrop-placing section runs at pin. */
export const BACKDROP_REQUIREMENT = "interactive.backdrop";

/** Findings shared by section and frame backdrop slots. */
function backdropRowFindings(at: string, name: string, row: Row, contract: SurfaceContract, registry: BackdropRegistry): string[] {
  const findings: string[] = [];
  if (row.required !== false) findings.push(`${at}: a backdrop is decorative and must be optional`);
  if (row.alt !== undefined) findings.push(`${at}: a backdrop is aria-hidden and carries no alt`);
  const copy = (contract.copy?.fields ?? []).filter(field => field.key === name || field.key.startsWith(`${name}.`) || field.key.startsWith(`${name}[`));
  if (copy.length) findings.push(`${at}: a backdrop carries no copy, but the contract declares ${copy.map(field => field.key).join(", ")}`);
  if (!(contract.members?.names ?? []).some(member => member.startsWith(`${name}.scrim.`))) findings.push(`${at}: a backdrop keeps text contrast through ${name}.scrim.* members; the contract declares none`);
  const themes = new Set(contract.allowedReads?.themes ?? []);
  const unread = registry.colors.filter(color => !themes.has(`themes.${color}`));
  if (unread.length) findings.push(`${at}: a backdrop paints with the registry colours; the contract may not read ${unread.map(color => `themes.${color}`).join(", ")}`);
  return findings;
}

/** Placement findings for one section slot's contract; [] when every media slot is placed by the rules above. */
export function sectionPlacementFindings(slot: SurfaceSlot, registry: BackdropRegistry = BACKDROP_REGISTRY): string[] {
  const findings: string[] = [];
  const { contract } = slot;
  const fields = new Map((contract.copy?.fields ?? []).map(field => [field.key, field]));
  const assets = new Set(contract.allowedReads?.assets ?? []);
  let backdrops = 0;
  for (const row of contract.slots ?? []) {
    const name = row.name ?? row.id ?? "";
    const at = `placement: ${slot.id} slot ${name}`;
    if (row.type !== "media") {
      if (row.placement !== undefined || row.alt !== undefined) findings.push(`${at}: only a media slot declares placement or alt`);
      continue;
    }
    if (row.placement === "figure") {
      const alt = row.alt;
      if (!record(alt) || Object.keys(alt).length !== 1 || (typeof alt.copy !== "string" && typeof alt.asset !== "string")) {
        findings.push(`${at}: a figure names its text alternative as alt {copy: <field>} or alt {asset: <asset read>}`);
        continue;
      }
      if (typeof alt.copy === "string") {
        const field = fields.get(alt.copy);
        if (!field) findings.push(`${at}: alt copy ${alt.copy} is not a declared copy field`);
        else if (row.required === true && field.required !== true) findings.push(`${at}: a required figure needs a required alt field, but ${alt.copy} is optional`);
      } else if (!assets.has(alt.asset as string)) findings.push(`${at}: alt asset ${String(alt.asset)} is not an asset the contract may read`);
    } else if (row.placement === "backdrop") {
      backdrops += 1;
      findings.push(...backdropRowFindings(at, name, row, contract, registry));
    } else findings.push(`${at}: a media slot declares placement figure or backdrop`);
  }
  if (backdrops > 1) findings.push(`placement: ${slot.id} places ${backdrops} backdrops; a surface has at most one`);
  if (backdrops && !(contract.requirements ?? []).some(requirement => requirement.check === BACKDROP_REQUIREMENT)) findings.push(`placement: ${slot.id} places a backdrop without the ${BACKDROP_REQUIREMENT} requirement`);
  return findings;
}

/** Placement findings for one frame slot's contract: an opt-in backdrop slot follows the backdrop rules; nothing else carries placement. */
export function framePlacementFindings(slot: SurfaceSlot, registry: BackdropRegistry = BACKDROP_REGISTRY): string[] {
  const findings: string[] = [];
  let backdrops = 0;
  for (const row of slot.contract.slots ?? []) {
    const name = row.id ?? row.name ?? "";
    const at = `placement: ${slot.id} slot ${name}`;
    if (row.alt !== undefined) findings.push(`${at}: a frame slot carries no alt`);
    if (row.placement === undefined) continue;
    if (row.placement !== "backdrop") { findings.push(`${at}: a frame slot places only a backdrop`); continue; }
    backdrops += 1;
    findings.push(...backdropRowFindings(at, name, row, slot.contract, registry));
  }
  if (backdrops > 1) findings.push(`placement: ${slot.id} places ${backdrops} backdrops; a surface has at most one`);
  if (backdrops && !(slot.contract.requirements ?? []).some(requirement => requirement.check === BACKDROP_REQUIREMENT)) findings.push(`placement: ${slot.id} places a backdrop without the ${BACKDROP_REQUIREMENT} requirement`);
  return findings;
}

/** Whether a filled value counts as present: anything but undefined, null or an empty list. */
const present = (value: unknown): boolean => value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
/** Whether a filled alt is present and non-blank: a non-blank string, or a `{$copy: <key>}` reference not yet resolved. */
const filledAlt = (value: unknown): boolean =>
  typeof value === "string" ? value.trim().length > 0 : record(value) && Object.keys(value).length === 1 && typeof value.$copy === "string" && value.$copy.trim().length > 0;

/** The values at a copy-field key path (`media.title`, `images.items[].label`) of a props tree; `[]` fans out over a list. */
function valuesAt(tree: unknown, key: string): unknown[] {
  let nodes: unknown[] = [tree];
  for (const part of key.split(".")) {
    const fan = part.endsWith("[]");
    const name = fan ? part.slice(0, -2) : part;
    nodes = nodes.flatMap(node => {
      const next = record(node) ? node[name] : undefined;
      return fan ? (Array.isArray(next) ? next : [undefined]) : [next];
    });
  }
  return nodes;
}

/**
 * Why a filled surface ships a figure without its text alternative (U23 review N1); [] when every
 * present figure has one. `props` is the props tree a gate sees (a candidate's preview fixtures at
 * submit and pin, a page's bound props at install), keyed by the contract's slot names and copy
 * field keys. A figure slot whose value is present needs its `alt {copy: <field>}` present and
 * non-blank at every position (a `[]` key fans out over the list); an absent optional figure needs
 * nothing. An `alt {asset}` reads the asset's own name metadata, which the contract rules judge.
 * Submit (Producer slot-model validator), pin (certify) and install (Publisher bind) call this.
 */
export function figureAltIssues(props: unknown, slot: string, contract: unknown): string[] {
  if (!record(contract) || !Array.isArray(contract.slots) || !record(props)) return [];
  const issues: string[] = [];
  for (const row of contract.slots as Row[]) {
    if (!record(row) || row.type !== "media" || row.placement !== "figure") continue;
    const name = row.name ?? row.id ?? "";
    if (!present(props[name])) continue;
    const alt = row.alt;
    if (!record(alt) || typeof alt.copy !== "string") continue;
    const blank = valuesAt(props, alt.copy).filter(value => !filledAlt(value)).length;
    if (blank) issues.push(`${slot} figure ${name} is filled, but its text alternative ${alt.copy} is absent or blank${blank > 1 ? ` at ${blank} positions` : ""}; a present figure ships with its alt`);
  }
  return issues;
}

/**
 * figureAltIssues over the props a code candidate's own preview mounts (`meta.preview.fixtures`, or its
 * `props` when the fixtures name a `file` to mount, as Publisher install reads them): what submit and pin judge.
 */
export function previewFigureAltIssues(item: unknown, slot: string, contract: unknown): string[] {
  const preview = record(item) && record(item.meta) ? item.meta.preview : undefined;
  const fixtures = record(preview) ? preview.fixtures : undefined;
  const props = record(fixtures) && typeof fixtures.file === "string" ? fixtures.props : fixtures;
  return figureAltIssues(props, slot, contract);
}

const SURFACES: ReadonlyMap<string, SurfaceContract> = new Map(
  [...sectionSlots, ...frameSlots].map(slot => [slot.id, slot.contract as unknown as SurfaceContract]),
);

/**
 * The catalog contract of a section or frame slot; undefined for any other slot (components,
 * assets, themes and unknown slots carry no surface contract, so they declare no backdrop).
 */
export function catalogSurfaceContract(slotId: string): SurfaceContract | undefined {
  return SURFACES.get(slotId);
}

/** The backdrop-placed slot name of a catalog surface; undefined when the surface declares none. */
export function catalogBackdropSlot(slotId: string): string | undefined {
  return contractBackdropSlot(catalogSurfaceContract(slotId));
}

/** Every catalog surface (section or frame) whose contract declares a backdrop-placed slot, sorted. */
export function catalogBackdropSurfaces(): string[] {
  return [...SURFACES.keys()].filter(id => catalogBackdropSlot(id) !== undefined).sort();
}
