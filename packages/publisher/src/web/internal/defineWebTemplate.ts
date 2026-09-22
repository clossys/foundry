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
 * Consumer templates are DATA: a name, slots, and a sequence of block
 * kinds this package already knows how to render. They do not accept an
 * arbitrary `build` function — that path is reserved for shipped views
 * declared in `webTemplates.ts` (issue #1103).
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

import type { DefineWebTemplateOptions, WebSlotContentKind, WebTemplate, WebTemplateBlockKind, WebTemplateBlockSpec } from "../types.js";
import { RenderError } from "../../internal/errors.js";
import { compileConsumerTemplateBlocks } from "./compileConsumerTemplateBlocks.js";

const KNOWN_SLOT_KINDS: readonly WebSlotContentKind[] = ["copy", "asset", "node"];

const KNOWN_BLOCK_KINDS: readonly WebTemplateBlockKind[] = ["page-header", "marketing-chapter", "node-chapter", "stat-grid", "copy-footer"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function fail(message: string): never {
  throw new RenderError("invalid-template-definition", `defineWebTemplate refused: ${message}`);
}

function validateBlockSpec(
  block: unknown,
  index: number,
  flowSlotKeys: Set<string>,
  repeatingKeys: Set<string>,
  slotKinds: Record<string, WebSlotContentKind[]> | undefined,
): WebTemplateBlockSpec {
  if (!isPlainObject(block) || !isNonEmptyString(block.kind)) {
    fail(`blocks[${index}] must be an object with a non-empty string "kind", got ${JSON.stringify(block)}.`);
  }
  const kind = block.kind as string;
  if (!KNOWN_BLOCK_KINDS.includes(kind as WebTemplateBlockKind)) {
    fail(`blocks[${index}].kind "${kind}" is not one of ${KNOWN_BLOCK_KINDS.join(", ")}.`);
  }

  const requireFlowSlot = (slotKey: string, role: string): void => {
    if (!flowSlotKeys.has(slotKey)) {
      fail(`blocks[${index}] (${kind}) names ${role} slot "${slotKey}", which flow.slots does not declare.`);
    }
  };

  const requireNodeSlot = (slotKey: string): void => {
    requireFlowSlot(slotKey, "node");
    const kinds = slotKinds?.[slotKey] ?? ["copy", "asset"];
    if (!kinds.includes("node")) {
      fail(`blocks[${index}] (${kind}) names node slot "${slotKey}", but slotKinds does not declare "node" for that slot.`);
    }
  };

  switch (kind) {
    case "page-header": {
      if (!isNonEmptyString(block.title)) fail(`blocks[${index}] (page-header) requires a non-empty string "title" slot key.`);
      requireFlowSlot(block.title, "title");
      if (block.description !== undefined) {
        if (!isNonEmptyString(block.description)) fail(`blocks[${index}] (page-header) "description" must be a non-empty slot key when present.`);
        requireFlowSlot(block.description, "description");
      }
      return { kind: "page-header", title: block.title, ...(block.description === undefined ? {} : { description: block.description }) };
    }
    case "marketing-chapter": {
      if (!isNonEmptyString(block.title)) fail(`blocks[${index}] (marketing-chapter) requires a non-empty string "title" slot key.`);
      requireFlowSlot(block.title, "title");
      if (block.description !== undefined) {
        if (!isNonEmptyString(block.description)) fail(`blocks[${index}] (marketing-chapter) "description" must be a non-empty slot key when present.`);
        requireFlowSlot(block.description, "description");
      }
      if (block.body !== undefined) {
        if (!isNonEmptyString(block.body)) fail(`blocks[${index}] (marketing-chapter) "body" must be a non-empty slot key when present.`);
        requireFlowSlot(block.body, "body");
      }
      return {
        kind: "marketing-chapter",
        title: block.title,
        ...(block.description === undefined ? {} : { description: block.description }),
        ...(block.body === undefined ? {} : { body: block.body }),
      };
    }
    case "node-chapter": {
      if (!isNonEmptyString(block.node)) fail(`blocks[${index}] (node-chapter) requires a non-empty string "node" slot key.`);
      requireNodeSlot(block.node);
      if (block.title !== undefined) {
        if (!isNonEmptyString(block.title)) fail(`blocks[${index}] (node-chapter) "title" must be a non-empty slot key when present.`);
        requireFlowSlot(block.title, "title");
      }
      if (block.description !== undefined) {
        if (!isNonEmptyString(block.description)) fail(`blocks[${index}] (node-chapter) "description" must be a non-empty slot key when present.`);
        requireFlowSlot(block.description, "description");
      }
      return {
        kind: "node-chapter",
        node: block.node,
        ...(block.title === undefined ? {} : { title: block.title }),
        ...(block.description === undefined ? {} : { description: block.description }),
      };
    }
    case "stat-grid": {
      if (!isNonEmptyString(block.repeating)) fail(`blocks[${index}] (stat-grid) requires a non-empty string "repeating" slot key.`);
      if (!repeatingKeys.has(block.repeating)) {
        fail(`blocks[${index}] (stat-grid) names repeating slot "${block.repeating}", which repeatingSlots does not declare.`);
      }
      return { kind: "stat-grid", repeating: block.repeating };
    }
    case "copy-footer": {
      if (!isNonEmptyString(block.copy)) fail(`blocks[${index}] (copy-footer) requires a non-empty string "copy" slot key.`);
      requireFlowSlot(block.copy, "copy");
      return { kind: "copy-footer", copy: block.copy };
    }
    default:
      fail(`blocks[${index}].kind "${kind}" is not supported.`);
  }
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

  const { name, flow, slotKinds, repeatingSlots, blocks } = options;

  if ("build" in options && (options as { build?: unknown }).build !== undefined) {
    fail(`build is not accepted on consumer templates — declare a non-empty "blocks" array of Designer block kinds instead.`);
  }

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

  if (!Array.isArray(blocks) || blocks.length === 0) {
    fail(`blocks must be a non-empty array of known Designer block kinds — consumer templates are data, not a React build function.`);
  }

  const frozenBlocks = Object.freeze(blocks.map((block, index) => Object.freeze(validateBlockSpec(block, index, flowSlotKeys, repeatingKeys, slotKinds))));

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

  const build = compileConsumerTemplateBlocks(frozenBlocks);

  return Object.freeze({
    name,
    flow: frozenFlow,
    blocks: frozenBlocks,
    ...(frozenRepeatingSlots === undefined ? {} : { repeatingSlots: frozenRepeatingSlots }),
    ...(frozenSlotKinds === undefined ? {} : { slotKinds: frozenSlotKinds }),
    build,
  }) as WebTemplate;
}
