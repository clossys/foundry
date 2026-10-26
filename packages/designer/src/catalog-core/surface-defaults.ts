/**
 * Default Sections and Frames fills from the catalog's surface candidates; the
 * surface counterpart of planComponentDefaults. Pure and offline.
 *
 * Eligibility is the static contract rule the surface checker (resolveSurfaces)
 * applies to a fill's declared mapping: every required content slot mapped, no
 * content slot, member or state port outside the contract, every frame state
 * port owned, a declared rendering that matches, and no retained blocker. The
 * importer's coverage records the same mapping facts. Source bytes, provenance,
 * dependency artifacts, token reads and runtime measurements are not gathered
 * here, so a default is statically eligible against its declared mapping, not
 * materialized or runtime-qualified, and adopting it through the source path
 * still needs a verified surface source bundle.
 */
import { surfacePrimary } from "./surface-library.js";
import type { SectionSlot } from "./sections-contract.js";
import type { SurfaceFinding, SurfaceSlot } from "./surface-types.js";
import type { FillMeta, FrameSlot } from "./types.js";

/** The mapping fields both package-pointer descriptors and source candidates declare. */
export interface SurfaceDefaultDescriptor {
  slot: string;
  /** Section content slots. */
  slotMap?: Readonly<Record<string, unknown>>;
  /** Frame content slots. */
  slots?: Readonly<Record<string, unknown>>;
  propMap: Readonly<Record<string, unknown>>;
  statePorts?: Readonly<Record<string, unknown>>;
  configs?: Readonly<Record<string, unknown>>;
  members?: readonly string[];
  rendering?: string;
  blockers?: readonly { code: string; message: string }[];
}
export interface SurfaceDefaultCandidateDocument {
  $extensions: { "com.clossys.fill": FillMeta };
  sections?: Readonly<Record<string, SurfaceDefaultDescriptor>>;
  frames?: Readonly<Record<string, SurfaceDefaultDescriptor>>;
}
export interface SurfaceDefaultsInput {
  catalog: { slots: readonly (SectionSlot | FrameSlot)[]; fills: readonly SurfaceDefaultCandidateDocument[] };
  /** Section and frame leaves to plan, in display order. */
  slots: readonly string[];
  /** Source order for slots without an owner pick or a choice. Unlisted sources are never defaulted. */
  preference: readonly string[];
  /** Owner decisions: exclusive; an ineligible pick stays unchosen rather than falling back. */
  picks?: Readonly<Record<string, string>>;
  /** Choose: overrides picks and preference, and is equally exclusive. */
  choices?: Readonly<Record<string, string>>;
}
export type SurfaceDefaultBasis = "choose" | "owner-pick" | "preference";
export interface SurfaceDefaultRow {
  slot: string;
  status: "chosen" | "default" | "not-chosen";
  basis?: SurfaceDefaultBasis;
  source?: string;
  fill?: string;
  /** Contract members, content slots and state ports the chosen candidate does not map. */
  unmapped?: readonly string[];
  reasons: readonly string[];
}
export interface SurfaceDefaultDecision {
  slot: SurfaceSlot;
  kind: "adopt";
  source: string;
  fill: string;
  note: string;
}
export interface SurfaceDefaultsPlan {
  rows: readonly SurfaceDefaultRow[];
  /** One adopt row per chosen or defaulted leaf, in row order. */
  decisions: readonly SurfaceDefaultDecision[];
  /** Whole selected set, static findings only; empty for a consistent plan. */
  findings: readonly SurfaceFinding[];
}

const unique = (values: readonly string[]): string[] => [...new Set(values)];

/** The static S5 mapping rule of resolveSurfaces, over one declared descriptor. */
function contractFindings(slot: SectionSlot | FrameSlot, fill: SurfaceDefaultDescriptor): string[] {
  const contract = slot.contract;
  const mapping: string[] = [], frame: string[] = [], other: string[] = [];
  if (fill.slot !== slot.id) other.push(`S1 descriptor slot ${fill.slot} differs`);
  const allowed = contract.kind === "section" ? contract.slots.map(row => row.name) : contract.slots.map(row => row.id);
  const required = contract.kind === "section" ? contract.slots.filter(row => row.required).map(row => row.name) : contract.slots.filter(row => row.required).map(row => row.id);
  const mapped = Object.keys((contract.kind === "section" ? fill.slotMap : fill.slots) ?? {});
  for (const name of required) if (!mapped.includes(name)) mapping.push(`required slot ${name} is not mapped`);
  for (const name of mapped) if (!allowed.includes(name)) mapping.push(`slot ${name} is outside the contract`);
  for (const member of unique([...Object.keys(fill.propMap), ...fill.members ?? []])) if (!contract.members.names.includes(member)) mapping.push(`member ${member} is outside the contract`);
  if (contract.kind === "section") {
    for (const config of Object.values(fill.configs ?? {})) {
      const members = (config as { members?: unknown }).members;
      if (Array.isArray(members) && members.some(member => !(fill.members ?? Object.keys(fill.propMap)).includes(member))) other.push("S5 config member unavailable");
    }
  } else {
    if (fill.rendering !== undefined && fill.rendering !== contract.rendering) frame.push(`rendering ${fill.rendering} differs from ${contract.rendering}`);
    const owned = Object.keys(fill.statePorts ?? {});
    for (const port of contract.statePorts) if (!owned.includes(port.id)) frame.push(`state port ${port.id} is not owned`);
    for (const port of owned) if (!contract.statePorts.some(row => row.id === port)) frame.push(`state port ${port} is outside the contract`);
  }
  for (const blocker of fill.blockers ?? []) other.push(`S5 ${blocker.code}: ${blocker.message}`);
  return [
    ...(mapping.length ? [`S5 content/member mapping differs: ${mapping.join(", ")}`] : []),
    ...(frame.length ? [`S5 frame rendering/state ownership differs: ${frame.join(", ")}`] : []),
    ...unique(other),
  ];
}

export function planSurfaceDefaults(input: SurfaceDefaultsInput): SurfaceDefaultsPlan {
  const rows: SurfaceDefaultRow[] = input.slots.map(slot => {
    const contract = input.catalog.slots.find(row => row.id === slot);
    if (!contract) return { slot, status: "not-chosen", reasons: ["no surface contract"] };
    const docs = input.catalog.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot && doc.$extensions["com.clossys.fill"].mode === "implementation");
    const choice = input.choices?.[slot], pick = input.picks?.[slot];
    const basis: SurfaceDefaultBasis = choice ? "choose" : pick ? "owner-pick" : "preference";
    const order = choice ? [choice] : pick ? [pick] : input.preference;
    const why: string[] = [];
    for (const source of order) {
      const doc = docs.find(candidate => candidate.$extensions["com.clossys.fill"].source === source);
      if (!doc) { if (basis !== "preference") why.push(`${source}: no implementation candidate`); continue; }
      const entries = Object.values((contract.layer === "sections" ? doc.sections : doc.frames) ?? {});
      const own = entries.length === 1 ? contractFindings(contract, entries[0]!) : [`S1 expected one ${contract.layer} descriptor`];
      if (own.length) { why.push(`${source}: ${own.join("; ")}`); continue; }
      const meta = doc.$extensions["com.clossys.fill"];
      return { slot, status: basis === "choose" ? "chosen" : "default", basis, source, fill: meta.id, ...(meta.unmapped?.length ? { unmapped: [...meta.unmapped] } : {}), reasons: [] };
    }
    if (basis === "owner-pick") why.push(`owner pick ${pick} is not eligible; another source needs the owner's choice`);
    if (basis === "preference" && !docs.length) why.push("no implementation candidate");
    return { slot, status: "not-chosen", reasons: why.length ? why : ["no eligible candidate"] };
  });

  // Whole set: one primary export name per surface across both kinds, as resolveSurfaces requires.
  const findings: SurfaceFinding[] = [];
  const primaries = new Set<string>();
  for (const row of rows) {
    if (row.status === "not-chosen") continue;
    const primary = surfacePrimary(row.slot);
    if (primaries.has(primary)) findings.push({ code: "S1", rule: "surfaces", severity: "error", subject: row.slot, message: "cross-kind primary collision" });
    primaries.add(primary);
  }
  const decisions: SurfaceDefaultDecision[] = rows.filter(row => row.status !== "not-chosen").map(row => ({ slot: row.slot as SurfaceSlot, kind: "adopt", source: row.source!, fill: row.fill!, note: `Default fill (${row.basis})` }));
  return { rows, decisions, findings };
}
