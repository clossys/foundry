/**
 * `defineWebTemplate` — validates and freezes a `DefineWebTemplateOptions`
 * candidate into a real `WebTemplate`, the same "shape-check before it
 * ever reaches a renderer" discipline `core/validate.ts` holds for a
 * `SurfaceDocument`. Every check here runs at DEFINITION time — when a
 * consumer calls this function, typically once at module load — not at
 * first render, so a malformed template is caught next to the code that
 * declared it, not deep inside a request handler the first time someone
 * happens to name it on a `SurfaceDocument.template`.
 *
 * WHY THIS THROWS `RenderError`, NOT A SECOND ERROR TYPE
 * ---------------------------------------------------------
 * A malformed template definition and a document that fails to resolve
 * against a valid one are different MOMENTS (definition vs. render) but
 * the same KIND of problem from a caller's point of view: "this package
 * refused to hand back something renderable, and here is exactly why."
 * `internal/errors.ts`'s own `RenderError`/`RenderErrorReason` already
 * exists to be the one thing every failure in this package's renderers
 * throws, specifically so a caller can `catch` once and switch on
 * `reason` instead of maintaining a second `instanceof` check for a
 * competing error class. `"invalid-template-definition"` extends that
 * same closed set rather than introducing a parallel `TemplateError` —
 * see `errors.ts`'s own doc comment for the two members added alongside
 * this file.
 *
 * WHAT THIS DOES NOT VALIDATE
 * -------------------------------
 * `slotKinds`/`repeatingSlots`/`flow` are checked for INTERNAL
 * consistency only — unique keys, known content-kind names, no slot
 * claimed as both flowed and repeating. This function has no visibility
 * into any particular `SurfaceDocument` that will eventually be resolved
 * against this template, so it cannot and does not check whether a real
 * document's bindings will actually satisfy it — that is `resolveDocument`
 * and `renderWebDocument`'s job, at render time, against a real document.
 */

import type { DefineWebTemplateOptions, WebSlotContentKind, WebTemplate } from "../types.js";
import { RenderError } from "../../internal/errors.js";

const KNOWN_SLOT_KINDS: readonly WebSlotContentKind[] = ["copy", "asset", "node"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function fail(message: string): never {
  throw new RenderError("invalid-template-definition", `defineWebTemplate refused: ${message}`);
}

/**
 * Validates `options` against the same "non-empty, unique slot keys"
 * discipline `core/validate.ts`'s `validateLayoutSpecShape` already holds
 * a `LayoutSpec` to, applied here to a `FlowLayoutSpec` at definition time
 * instead of first render, plus the additional checks this registry's own
 * shape needs (`slotKinds` naming only real, known-kind, in-`flow` slots;
 * `repeatingSlots` never colliding with a flowed slot or with itself, and
 * every structured repeating field declaring one unique non-empty name).
 * Returns a FROZEN `WebTemplate` — `flow.slots`, `repeatingSlots`, and
 * `slotKinds` (and each of their own nested arrays/objects) are all
 * `Object.freeze`d, so a reference held after this call cannot be mutated
 * out from under a renderer that has already registered it.
 */
export function defineWebTemplate(options: DefineWebTemplateOptions): WebTemplate {
  if (!isPlainObject(options)) {
    fail(`options must be an object, got ${JSON.stringify(options)}.`);
  }

  const { name, flow, slotKinds, repeatingSlots, build } = options;

  if (!isNonEmptyString(name)) {
    fail(`name must be a non-empty string, got ${JSON.stringify(name)}.`);
  }

  if (!isPlainObject(flow) || !Array.isArray((flow as { slots?: unknown }).slots)) {
    fail(`flow must be an object with a "slots" array (a FlowLayoutSpec), got ${JSON.stringify(flow)}.`);
  }
  const flowSlots = (flow as { slots: unknown[] }).slots;

  const flowSlotKeys = new Set<string>();
  flowSlots.forEach((slot, index) => {
    if (!isPlainObject(slot) || !isNonEmptyString(slot.key)) {
      fail(`flow.slots[${index}] must be an object with a non-empty string "key", got ${JSON.stringify(slot)}.`);
    }
    if (flowSlotKeys.has(slot.key)) {
      fail(`flow.slots[${index}].key "${slot.key}" duplicates another slot key within the same flow — every flowed slot key must be unique.`);
    }
    if (slot.required !== undefined && typeof slot.required !== "boolean") {
      fail(`flow.slots[${index}].required must be a boolean when present, got ${JSON.stringify(slot.required)}.`);
    }
    flowSlotKeys.add(slot.key);
  });

  const repeatingKeys = new Set<string>();
  if (repeatingSlots !== undefined) {
    if (!Array.isArray(repeatingSlots)) {
      fail(`repeatingSlots must be an array when present, got ${JSON.stringify(repeatingSlots)}.`);
    }
    repeatingSlots.forEach((spec, index) => {
      if (!isPlainObject(spec) || !isNonEmptyString(spec.key)) {
        fail(`repeatingSlots[${index}] must be an object with a non-empty string "key", got ${JSON.stringify(spec)}.`);
      }
      if (spec.required !== undefined && typeof spec.required !== "boolean") {
        fail(`repeatingSlots[${index}].required must be a boolean when present, got ${JSON.stringify(spec.required)}.`);
      }
      if (flowSlotKeys.has(spec.key)) {
        fail(`repeatingSlots[${index}].key "${spec.key}" duplicates a flow.slots key — a slot must be either flowed or repeating, never both.`);
      }
      if (repeatingKeys.has(spec.key)) {
        fail(`repeatingSlots[${index}].key "${spec.key}" duplicates another repeating slot key.`);
      }
      if (spec.fields !== undefined) {
        if (!Array.isArray(spec.fields) || spec.fields.length === 0) {
          fail(`repeatingSlots[${index}].fields must be a non-empty array when present, got ${JSON.stringify(spec.fields)}.`);
        }
        const fieldKeys = new Set<string>();
        spec.fields.forEach((field, fieldIndex) => {
          if (!isPlainObject(field) || !isNonEmptyString(field.key)) {
            fail(`repeatingSlots[${index}].fields[${fieldIndex}] must be an object with a non-empty string "key", got ${JSON.stringify(field)}.`);
          }
          if (field.required !== undefined && typeof field.required !== "boolean") {
            fail(`repeatingSlots[${index}].fields[${fieldIndex}].required must be a boolean when present, got ${JSON.stringify(field.required)}.`);
          }
          if (fieldKeys.has(field.key)) {
            fail(`repeatingSlots[${index}].fields[${fieldIndex}].key "${field.key}" duplicates another field key for repeating slot "${spec.key}".`);
          }
          fieldKeys.add(field.key);
        });
      }
      repeatingKeys.add(spec.key);
    });
  }

  if (slotKinds !== undefined) {
    if (!isPlainObject(slotKinds)) {
      fail(`slotKinds must be an object when present, got ${JSON.stringify(slotKinds)}.`);
    }
    for (const [key, kinds] of Object.entries(slotKinds)) {
      if (!flowSlotKeys.has(key)) {
        fail(`slotKinds names slot "${key}", which flow.slots does not declare. Known flowed slot(s): ${[...flowSlotKeys].join(", ") || "(none)"}. (A repeating slot's content kinds are not declared through slotKinds — every repeating item already carries copy/node/assetId independently; see SurfaceSlotBindingItem.)`);
      }
      if (!Array.isArray(kinds) || kinds.length === 0) {
        fail(`slotKinds["${key}"] must be a non-empty array of "copy"/"asset"/"node", got ${JSON.stringify(kinds)}.`);
      }
      const seen = new Set<string>();
      for (const kind of kinds) {
        if (!KNOWN_SLOT_KINDS.includes(kind as WebSlotContentKind)) {
          fail(`slotKinds["${key}"] contains "${String(kind)}", which is not one of ${KNOWN_SLOT_KINDS.join(", ")}.`);
        }
        if (seen.has(kind)) {
          fail(`slotKinds["${key}"] lists "${kind}" more than once.`);
        }
        seen.add(kind);
      }
    }
  }

  if (typeof build !== "function") {
    fail(`build must be a function, got ${JSON.stringify(build)}.`);
  }

  const frozenFlow = Object.freeze({ slots: Object.freeze(flowSlots.map((slot) => Object.freeze({ ...(slot as object) }))) });
  const frozenRepeatingSlots =
    repeatingSlots === undefined
      ? undefined
      : Object.freeze(
          repeatingSlots.map((spec) =>
            Object.freeze({
              ...spec,
              ...(spec.fields === undefined ? {} : { fields: Object.freeze(spec.fields.map((field) => Object.freeze({ ...field }))) }),
            }),
          ),
        );
  const frozenSlotKinds =
    slotKinds === undefined ? undefined : Object.freeze(Object.fromEntries(Object.entries(slotKinds).map(([key, kinds]) => [key, Object.freeze([...kinds])])));

  return Object.freeze({
    name,
    flow: frozenFlow,
    ...(frozenRepeatingSlots === undefined ? {} : { repeatingSlots: frozenRepeatingSlots }),
    ...(frozenSlotKinds === undefined ? {} : { slotKinds: frozenSlotKinds }),
    build,
  }) as WebTemplate;
}
