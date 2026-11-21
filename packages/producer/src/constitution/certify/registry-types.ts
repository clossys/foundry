/**
 * Which check a Designer element candidate is held to, by its registry item `type` (foundry-build-0048 HOOK-SLOT).
 * This table is the only place that mapping lives; the element certifier (element.ts) and the specimen certifier
 * (specimen/library-source.ts `certifyCandidate`) both read it through `elementCheckOf`.
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
 * A `registry:*` type with no row fails closed with `RegistryTypeError` (REGISTRY-TYPE-UNKNOWN). The rows are exactly
 * the element candidate schema's `type` enum (candidate.schema.json), which a test holds them to.
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

/** The named error for a registry type the table has no row for. */
export const REGISTRY_TYPE_UNKNOWN = "REGISTRY-TYPE-UNKNOWN";
export class RegistryTypeError extends Error {
  override readonly name = "RegistryTypeError";
  readonly code = REGISTRY_TYPE_UNKNOWN;
  constructor(readonly where: string, readonly type: string) {
    super(`${REGISTRY_TYPE_UNKNOWN} ${where}: registry type ${type} has no row in REGISTRY_TYPE_CHECKS, so no check is known for it`);
  }
}

/**
 * The check for an item of registry `type` in a slot of `layer`. A `registry:*` type reads the table and fails closed
 * when it has no row. Any other value (none, or a library record kind) is mapped by Publisher's `specimenKindOf`, as
 * before this table, which throws on a kind it does not know either.
 */
export function elementCheckOf(where: string, type: unknown, layer: string | undefined): ElementCheck {
  if (typeof type === "string" && type.startsWith("registry:")) {
    const check = Object.hasOwn(REGISTRY_TYPE_CHECKS, type) ? REGISTRY_TYPE_CHECKS[type] : undefined;
    if (!check) throw new RegistryTypeError(where, type);
    if (check !== "layer") return check;
  }
  return specimenKindOf({ id: where, kind: type, ...(layer ? { layer } : {}) }) === "visual" ? "render" : "none";
}
