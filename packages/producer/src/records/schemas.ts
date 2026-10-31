import type { JsonSchema } from "./schema.js";

/**
 * Record schemas for the slot engine. Every package (Director, Designer,
 * Writer, Publisher, or a later agent) writes the same shapes; nothing here
 * names a package-specific field. Package identity is data (`package`,
 * `layer`, `kind`), never structure.
 *
 * On-disk layout in a consumer workspace:
 *   library/<slot>/<element>/v<n>/element.json   immutable once written
 *   library/<slot>/<element>/v<n>/preview.json   immutable once written
 *   library/<slot>/<element>/v<n>/<payload...>   the record's native payload
 *   selection.json                               pins plus append-only history
 *   releases/<n>.json                            snapshot of the pins
 */

const HASH = "^sha256:[0-9a-f]{64}$";
const ID = "^[a-z0-9][a-z0-9-]*$";
/** `<layer>.<leaf>`, for example `sections.hero` or `copy.home-hero`. */
const SLOT = "^[a-z0-9][a-z0-9-]*\\.[a-z0-9][a-z0-9.-]*$";
const ISO = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$";
const REL_PATH = "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[^\\\\\\u0000]+$";

export const RECORD_SCHEMA_IDS = {
  element: "clossys.element/1",
  preview: "clossys.preview/1",
  selection: "clossys.selection/1",
  release: "clossys.release/1",
  slotContract: "clossys.slot-contract/1",
  referencesManifest: "clossys.references-manifest/1",
} as const;

const referenceRef: JsonSchema = {
  type: "object",
  required: ["registry", "item", "version"],
  additionalProperties: false,
  properties: {
    registry: { type: "string", pattern: ID },
    item: { type: "string", minLength: 1 },
    version: { type: "string", minLength: 1 },
    hash: { type: "string", pattern: HASH },
    url: { type: "string", minLength: 1 },
  },
};

const pinState: JsonSchema = {
  type: "object",
  required: ["element", "version", "hash", "event"],
  additionalProperties: false,
  properties: {
    element: { type: "string", pattern: ID },
    version: { type: "integer", minimum: 1 },
    hash: { type: "string", pattern: HASH },
    event: { type: "string", minLength: 1 },
  },
};

const pinMap: JsonSchema = {
  type: "object",
  propertyNames: { type: "string", pattern: SLOT },
  additionalProperties: { $ref: "#/$defs/pinState" },
};

export const ELEMENT_SCHEMA: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: RECORD_SCHEMA_IDS.element,
  title: "Element record (element.json)",
  type: "object",
  required: [
    "schema", "id", "package", "layer", "slot", "kind", "version", "hash", "lineage",
    "license", "creator", "reason", "createdAt", "checks", "deps", "reads",
  ],
  additionalProperties: false,
  $defs: { referenceRef },
  properties: {
    schema: { const: RECORD_SCHEMA_IDS.element },
    id: { type: "string", pattern: ID, description: "Element id, unique within its slot." },
    package: { type: "string", pattern: ID, description: "The agent package that owns the slot." },
    layer: { type: "string", pattern: ID },
    slot: { type: "string", pattern: SLOT },
    kind: { type: "string", minLength: 1, description: "Payload kind, for example registry:block or cell:md." },
    version: { type: "integer", minimum: 1 },
    hash: { type: "string", pattern: HASH, description: "Content hash of the payload files (see records/hash.ts)." },
    lineage: {
      type: "object",
      required: ["mode"],
      additionalProperties: false,
      properties: {
        mode: { enum: ["verbatim", "customized", "original"] },
        source: { $ref: "#/$defs/referenceRef" },
        parent: {
          type: "object",
          required: ["version", "hash"],
          additionalProperties: false,
          properties: { version: { type: "integer", minimum: 1 }, hash: { type: "string", pattern: HASH } },
        },
      },
    },
    license: {
      type: "object",
      required: ["spdx"],
      additionalProperties: false,
      properties: {
        spdx: { type: "string", minLength: 1 },
        attribution: { type: "string", minLength: 1 },
        file: { type: "string", pattern: REL_PATH },
      },
    },
    creator: {
      type: "object",
      required: ["agent", "model"],
      additionalProperties: false,
      properties: {
        agent: { type: "string", minLength: 1 },
        model: { type: "string", minLength: 1 },
        by: { type: "string", minLength: 1 },
      },
    },
    reason: { type: "string", minLength: 1 },
    createdAt: { type: "string", pattern: ISO },
    checks: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "type", "status"],
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1 },
          suite: { type: "string", minLength: 1 },
          type: { enum: ["fixed", "measured", "judged"] },
          status: { enum: ["pass", "fail", "warn", "skip"] },
          detail: { type: "string" },
          value: { type: ["number", "string", "boolean"] },
          at: { type: "string", pattern: ISO },
        },
      },
    },
    deps: {
      type: "object",
      required: ["npm", "elements"],
      additionalProperties: false,
      properties: {
        npm: { type: "object", additionalProperties: { type: "string", minLength: 1 } },
        elements: {
          type: "array",
          uniqueItems: true,
          items: {
            type: "object",
            required: ["slot", "element", "version", "hash"],
            additionalProperties: false,
            properties: {
              slot: { type: "string", pattern: SLOT },
              element: { type: "string", pattern: ID },
              version: { type: "integer", minimum: 1 },
              hash: { type: "string", pattern: HASH },
            },
          },
        },
      },
    },
    reads: {
      type: "object",
      required: ["copyKeys", "themeVars"],
      additionalProperties: false,
      properties: {
        copyKeys: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
        themeVars: { type: "array", uniqueItems: true, items: { type: "string", pattern: "^--?[a-z0-9][a-z0-9-]*$" } },
      },
    },
    payload: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", pattern: REL_PATH },
      description: "Payload files relative to the version directory; defaults to every file but element.json and preview.json.",
    },
  },
};

export const PREVIEW_SCHEMA: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: RECORD_SCHEMA_IDS.preview,
  title: "Preview record (preview.json)",
  type: "object",
  required: ["schema", "fixtures", "copy", "container", "theme", "width"],
  additionalProperties: false,
  properties: {
    schema: { const: RECORD_SCHEMA_IDS.preview },
    fixtures: { type: "object", description: "Props or data the specimen renders with." },
    copy: { type: "object", additionalProperties: { type: "string" }, description: "Copy key to sample or pinned text." },
    container: { enum: ["canvas", "section-in-frame", "page"] },
    theme: { enum: ["light", "dark"] },
    width: { type: "integer", minimum: 240, maximum: 3840 },
  },
};

export const SELECTION_SCHEMA: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: RECORD_SCHEMA_IDS.selection,
  title: "Selection (selection.json): pins plus append-only pin history",
  type: "object",
  required: ["schema", "pins", "history"],
  additionalProperties: false,
  $defs: { pinState },
  properties: {
    schema: { const: RECORD_SCHEMA_IDS.selection },
    pins: pinMap,
    history: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "at", "by", "action", "slot"],
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1 },
          at: { type: "string", pattern: ISO },
          by: { type: "string", minLength: 1 },
          action: { enum: ["pin", "restore", "unpin"] },
          slot: { type: "string", pattern: SLOT },
          element: { type: "string", pattern: ID },
          version: { type: "integer", minimum: 1 },
          hash: { type: "string", pattern: HASH },
          from: { enum: ["option", "saved", "version", "reference"] },
          restores: { type: "string", minLength: 1, description: "Id of the earlier pin event a restore re-applies." },
          reason: { type: "string" },
        },
      },
    },
  },
};

export const RELEASE_SCHEMA: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: RECORD_SCHEMA_IDS.release,
  title: "Release snapshot (releases/<n>.json)",
  type: "object",
  required: ["schema", "number", "at", "by", "pins", "selectionEvent"],
  additionalProperties: false,
  $defs: { pinState },
  properties: {
    schema: { const: RECORD_SCHEMA_IDS.release },
    number: { type: "integer", minimum: 1 },
    at: { type: "string", pattern: ISO },
    by: { type: "string", minLength: 1 },
    pins: pinMap,
    selectionEvent: { type: ["string", "null"], description: "Last selection history event included in the snapshot." },
    notes: { type: "string" },
  },
};

export const SLOT_CONTRACT_SCHEMA: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: RECORD_SCHEMA_IDS.slotContract,
  title: "Slot contract",
  type: "object",
  required: ["schema", "slot", "package", "layer", "purpose", "inputs", "limits", "references", "checkSuite", "specimenKind"],
  additionalProperties: false,
  $defs: { referenceRef },
  properties: {
    schema: { const: RECORD_SCHEMA_IDS.slotContract },
    slot: { type: "string", pattern: SLOT },
    package: { type: "string", pattern: ID },
    layer: { type: "string", pattern: ID },
    purpose: { type: "string", minLength: 1 },
    inputs: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "kind", "required"],
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1 },
          kind: { enum: ["copy", "prop", "asset", "theme", "data", "cell"] },
          required: { type: "boolean" },
          description: { type: "string" },
        },
      },
    },
    limits: { type: "object", additionalProperties: { type: ["number", "string", "boolean"] } },
    references: { type: "array", items: { $ref: "#/$defs/referenceRef" } },
    checkSuite: { type: "string", minLength: 1 },
    specimenKind: { enum: ["visual", "text", "data", "media", "flow"] },
  },
};

export const REFERENCES_MANIFEST_SCHEMA: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: RECORD_SCHEMA_IDS.referencesManifest,
  title: "Package references manifest (references/manifest.json)",
  type: "object",
  required: ["schema", "package", "fetchedAt", "hashAlgorithm", "registries", "licenses", "items", "skipped"],
  additionalProperties: false,
  properties: {
    schema: { const: RECORD_SCHEMA_IDS.referencesManifest },
    package: { type: "string", pattern: ID },
    fetchedAt: { type: "string", pattern: ISO },
    fetchedWith: { type: "string" },
    hashAlgorithm: { const: "sha256-tree/1" },
    registries: {
      type: "object",
      propertyNames: { type: "string", pattern: ID },
      additionalProperties: {
        type: "object",
        required: ["namespace", "source", "version", "license", "licenseFiles"],
        additionalProperties: false,
        properties: {
          namespace: { type: "string", minLength: 1 },
          source: { type: "string", minLength: 1 },
          version: { type: "string", minLength: 1 },
          versionBasis: { type: "string" },
          upstream: { type: "string" },
          license: { type: "string", minLength: 1 },
          licenseFiles: { type: "array", minItems: 1, items: { type: "string", pattern: REL_PATH } },
        },
      },
    },
    licenses: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "sha256", "bytes", "sourceUrl"],
        additionalProperties: false,
        properties: {
          path: { type: "string", pattern: REL_PATH },
          sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
          bytes: { type: "integer", minimum: 0 },
          sourceUrl: { type: "string", minLength: 1 },
        },
      },
    },
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["registry", "name", "version", "dir", "type", "sourceUrl", "license", "direct", "slots", "hash", "files"],
        additionalProperties: false,
        properties: {
          registry: { type: "string", pattern: ID },
          name: { type: "string", minLength: 1 },
          version: { type: "string", minLength: 1 },
          dir: { type: "string", pattern: REL_PATH },
          type: { type: "string", minLength: 1 },
          sourceUrl: { type: "string", minLength: 1 },
          license: { type: "string", minLength: 1 },
          direct: { type: "boolean" },
          slots: { type: "array", uniqueItems: true, items: { type: "string", pattern: SLOT } },
          requiredBy: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
          registryDependencies: { type: "array", items: { type: "string", minLength: 1 } },
          dependencies: { type: "array", items: { type: "string", minLength: 1 } },
          hash: { type: "string", pattern: HASH },
          files: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["path", "sha256", "bytes", "origin"],
              additionalProperties: false,
              properties: {
                path: { type: "string", pattern: REL_PATH },
                sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
                bytes: { type: "integer", minimum: 0 },
                origin: { type: "string", minLength: 1 },
              },
            },
          },
        },
      },
    },
    skipped: {
      type: "array",
      items: {
        type: "object",
        required: ["ref", "reason"],
        additionalProperties: false,
        properties: {
          ref: { type: "string", minLength: 1 },
          slots: { type: "array", items: { type: "string", pattern: SLOT } },
          reason: { type: "string", minLength: 1 },
        },
      },
    },
  },
};
