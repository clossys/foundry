import type { JsonSchema } from "./schema.js";

const frameRegionInputs: JsonSchema = {
  type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 },
};
export const FRAME_OWNERSHIP_SCHEMA: JsonSchema = {
  oneOf: [
    {
      type: "object", required: ["kind", "regions"], additionalProperties: false,
      properties: {
        kind: { const: "app" },
        regions: {
          type: "object", required: ["navigation"], additionalProperties: false,
          properties: { navigation: frameRegionInputs },
        },
      },
    },
    {
      type: "object", required: ["kind", "regions"], additionalProperties: false,
      properties: {
        kind: { const: "page" },
        regions: {
          type: "object", required: ["header", "chat", "body"], additionalProperties: false,
          properties: { header: frameRegionInputs, chat: frameRegionInputs, body: frameRegionInputs },
        },
      },
    },
  ],
};

/** Optional source-slot binding on a frame input. */
export const FRAME_INPUT_SLOT_SCHEMA: JsonSchema = { type: "string", pattern: "^[a-z0-9][a-z0-9-]*\\.[a-z0-9][a-z0-9.-]*$" };

/** Extend the canonical contract without replacing any existing schema constraints. */
export function withFrameOwnershipSchema(schema: JsonSchema): JsonSchema {
  const inputs = schema.properties!.inputs!;
  return {
    ...schema,
    properties: {
      ...schema.properties,
      ownership: FRAME_OWNERSHIP_SCHEMA,
      inputs: {
        ...inputs,
        items: {
          ...inputs.items,
          properties: { ...inputs.items!.properties, slot: FRAME_INPUT_SLOT_SCHEMA },
        },
      },
    },
  };
}
