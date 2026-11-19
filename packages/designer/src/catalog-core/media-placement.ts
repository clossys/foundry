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
 * same backdrop rules. Non-media section slots carry no placement.
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
  return findings;
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
