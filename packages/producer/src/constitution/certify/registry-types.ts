/**
 * Which check a Designer element candidate is held to, by its registry item `type` (foundry-build-0048 HOOK-SLOT).
 * This table is the only place that mapping lives; the element certifier (element.ts), the specimen certifier
 * (specimen/library-source.ts `certifyCandidate`) and the specimen record store that Studio and the specimen preflight
 * read (library-source.ts `libraryRecordStore`) all read it through `elementCheckOf`.
 *
 * - `render`: a visual item. Its specimen mounts a component, which is rendered on the server with the slot's
 *   contract fixture (element.ts `renderFit`).
 * - `hook`: a React hook module, never rendered. It is held to the contract fixture (the file and export it names),
 *   loads in the certifier's module system (every import resolves, a package only when installed at its declared
 *   exact version), ships only hook and lib files, and every `registry:hook` file exports a function named `use*`.
 * - `lib`: a code module, never rendered. The same as a hook, except that its files export at least one function and
 *   none needs a `use*` name.
 * - `layer`: an item that is not code the certifier types itself (a theme, a font, a style, a file, a base, a generic
 *   item). The slot layer's specimen kind decides, as Publisher's `specimenKindOf` maps it: a visual specimen is
 *   rendered, any other needs no fixture.
 *
 * The slot decides which of these it accepts (planner decision P1), derived in code from its contract and layer, never
 * from a hand list per slot (`slotClassOf`): a slot whose contract fixture names a `use*` export is a hook slot and
 * accepts only `registry:hook`; one whose fixture names another lower-case export (not `default`) is a lib slot and
 * accepts only `registry:lib`; any other slot of a visual layer accepts only an item that is rendered there; a slot of
 * any other layer accepts anything but a hook or lib. So the candidate's own `type` can never turn a visual slot's
 * render off. A `registry:*` type with no row fails closed with REGISTRY-TYPE-UNKNOWN, and a type its slot does not
 * accept with REGISTRY-TYPE-SLOT-MISMATCH, both `RegistryTypeError`s and both before any check is chosen. The rows are
 * exactly the element candidate schema's `type` enum (candidate.schema.json), which a test holds them to.
 */
import { specimenKindOf } from "@clossys/publisher/specimen";

export type RegistryCheck = "render" | "hook" | "lib" | "layer";

export const REGISTRY_TYPE_CHECKS: Readonly<Record<string, RegistryCheck>> = Object.freeze({
  "registry:ui": "render",
  "registry:block": "render",
  "registry:component": "render",
  "registry:page": "render",
  "registry:hook": "hook",
  "registry:lib": "lib",
  "registry:theme": "layer",
  "registry:font": "layer",
  "registry:style": "layer",
  "registry:file": "layer",
  "registry:base": "layer",
  "registry:item": "layer",
});

/** The file types a code item (`hook`, `lib`) may ship: anything else (a `registry:ui` file) is refused, never rendered. */
export const CODE_ITEM_FILE_TYPES: Readonly<Record<"hook" | "lib", readonly string[]>> = Object.freeze({
  hook: Object.freeze(["registry:hook", "registry:lib"]),
  lib: Object.freeze(["registry:lib"]),
});

/** What the element certifier runs for one candidate: a server render, a code check, or nothing (no component mounts). */
export type ElementCheck = "render" | "hook" | "lib" | "none";

/** A React hook export name: `use`, then an upper-case letter, a digit, `_`, `$` or nothing (React's own rule). */
export const HOOK_NAME = /^use(?:[A-Z0-9_$]|$)/;

/** The layers whose slots hold visual elements: such a slot accepts only an item that is rendered there (P1). */
export const VISUAL_LAYERS: readonly string[] = Object.freeze(["components", "sections", "frames", "pages"]);

/** What a slot is, derived from its contract and layer (`slotClassOf`): which registry types it accepts follows from it. */
export type SlotClass = "hook" | "lib" | "visual" | "layer";

/** The export a slot's contract fixture names (`contract.fixture.fixtures.export`), if it names one. */
export function fixtureExportOf(contract: Readonly<Record<string, unknown>> | undefined): string | undefined {
  const fixture = contract?.fixture;
  const fixtures = fixture && typeof fixture === "object" ? (fixture as { fixtures?: unknown }).fixtures : undefined;
  const name = fixtures && typeof fixtures === "object" ? (fixtures as { export?: unknown }).export : undefined;
  return typeof name === "string" && name ? name : undefined;
}

/**
 * The class of a slot, from its contract fixture's export and its layer: a `use*` export is a hook slot; any other
 * lower-case export but `default` (a React component is never lower-case) is a lib slot; otherwise a slot of a visual
 * layer is visual, and any other slot is held to its layer.
 */
export function slotClassOf(layer: string | undefined, contract: Readonly<Record<string, unknown>> | undefined): SlotClass {
  const name = fixtureExportOf(contract);
  if (name !== undefined && HOOK_NAME.test(name)) return "hook";
  if (name !== undefined && name !== "default" && /^[a-z_$]/.test(name)) return "lib";
  return layer !== undefined && VISUAL_LAYERS.includes(layer) ? "visual" : "layer";
}

/** Whether a slot of `slotClass` accepts an item whose own check (its type in that layer) is `check`. */
function accepts(slotClass: SlotClass, check: ElementCheck): boolean {
  switch (slotClass) {
    case "hook": return check === "hook";
    case "lib": return check === "lib";
    case "visual": return check === "render";
    case "layer": return check !== "hook" && check !== "lib";
  }
}

/** The named errors for a registry type the table has no row for, and for one its slot does not accept. */
export const REGISTRY_TYPE_UNKNOWN = "REGISTRY-TYPE-UNKNOWN";
export const REGISTRY_TYPE_SLOT_MISMATCH = "REGISTRY-TYPE-SLOT-MISMATCH";
export class RegistryTypeError extends Error {
  override readonly name = "RegistryTypeError";
  constructor(readonly code: typeof REGISTRY_TYPE_UNKNOWN | typeof REGISTRY_TYPE_SLOT_MISMATCH, readonly where: string, readonly type: string, detail: string) {
    super(`${code} ${where}: ${detail}`);
  }
}

/** The check an item of `type` would get in `layer`, from the table alone (no slot rule). */
function typeCheckOf(where: string, type: unknown, layer: string | undefined): ElementCheck {
  if (typeof type === "string" && type.startsWith("registry:")) {
    const check = Object.hasOwn(REGISTRY_TYPE_CHECKS, type) ? REGISTRY_TYPE_CHECKS[type] : undefined;
    if (!check) throw new RegistryTypeError(REGISTRY_TYPE_UNKNOWN, where, type, `registry type ${type} has no row in REGISTRY_TYPE_CHECKS, so no check is known for it`);
    if (check !== "layer") return check;
  }
  return specimenKindOf({ id: where, kind: type, ...(layer ? { layer } : {}) }) === "visual" ? "render" : "none";
}

/**
 * The registry types a slot of `layer` with `contract` accepts, in table order (derived, never a hand list). A layer
 * row whose check this layer cannot name (Publisher knows no specimen kind for it there) is not accepted.
 */
export function slotAcceptedTypes(layer: string | undefined, contract: Readonly<Record<string, unknown>> | undefined): string[] {
  const slotClass = slotClassOf(layer, contract);
  return Object.keys(REGISTRY_TYPE_CHECKS).filter(type => {
    let check: ElementCheck;
    try { check = typeCheckOf(type, type, layer); } catch { return false; }
    return accepts(slotClass, check);
  });
}

/**
 * The check for an item of registry `type` in a slot of `layer` whose contract is `contract`. A `registry:*` type reads
 * the table and fails closed when it has no row; any other value (none, or a library record kind) is mapped by
 * Publisher's `specimenKindOf`, as before this table, which throws on a kind it does not know either. Then the slot
 * decides (P1): a type its class does not accept is refused with REGISTRY-TYPE-SLOT-MISMATCH, before any check runs.
 */
export function elementCheckOf(where: string, type: unknown, layer: string | undefined, contract: Readonly<Record<string, unknown>> | undefined): ElementCheck {
  const check = typeCheckOf(where, type, layer);
  const slotClass = slotClassOf(layer, contract);
  if (!accepts(slotClass, check)) {
    const shown = typeof type === "string" ? type : JSON.stringify(type) ?? "no type";
    const named = fixtureExportOf(contract);
    const because = slotClass === "hook" || slotClass === "lib" ? `its contract fixture names ${named}` : `it is a slot of the ${layer} layer`;
    throw new RegistryTypeError(REGISTRY_TYPE_SLOT_MISMATCH, where, shown,
      `the slot is a ${slotClass} slot (${because}) and accepts only ${slotAcceptedTypes(layer, contract).join(", ")}; it refuses ${shown}, which would get ${check === "none" ? "no check" : `the ${check} check`}`);
  }
  return check;
}
