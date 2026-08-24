import { describe, expect, it } from "vitest";
import {
  compareDomainModels,
  defineDomainModel,
  defineDomainSnapshot,
  normalizeDomainModel,
  normalizeDomainSnapshot,
  serializeDomainModel,
  serializeDomainSnapshot,
  validateDomainModel,
  validateDomainSnapshot,
} from "./index.js";
import type { DomainModelDefinition, DomainSnapshotDefinition, ValueTypeDefinition } from "./types.js";

function exampleModel(overrides: Partial<DomainModelDefinition> = {}): DomainModelDefinition {
  return {
    id: "example",
    schemaVersion: "0.1.0",
    valueTypes: [{ id: "example.score", primitive: "number" }],
    vocabularies: [{ id: "example.state", values: ["draft", "published"] }],
    types: [
      {
        id: "example.article",
        fields: [
          { id: "example.article.title", valueType: "string", required: true },
          { id: "example.article.state", valueType: "example.state" },
        ],
      },
      { id: "example.source", fields: [{ id: "example.source.url", valueType: "string", required: true }] },
    ],
    relations: [
      {
        id: "example.article.cites",
        from: "example.article",
        to: "example.source",
        cardinality: "many-to-many",
        properties: [{ id: "example.article.cites.score", valueType: "example.score" }],
      },
    ],
    ...overrides,
  };
}

describe("defineDomainModel", () => {
  it("detaches authored data and supplies empty collections", () => {
    const source = exampleModel({ types: [] });
    const model = defineDomainModel(source);
    (source.valueTypes as ValueTypeDefinition[]).push({ id: "example.other", primitive: "string" });
    expect(model.valueTypes).toHaveLength(1);
    expect(model.types).toEqual([]);
    expect(model.relations).toHaveLength(1);
  });
});

describe("validateDomainModel", () => {
  it("accepts a complete, attributed relation model", () => {
    expect(validateDomainModel(exampleModel())).toEqual([]);
  });

  it("reports malformed input rather than throwing", () => {
    expect(validateDomainModel(null).map((entry) => entry.rule)).toEqual(["model-shape"]);
    expect(validateDomainModel({ id: "Example", schemaVersion: "", types: "not-an-array" }).map((entry) => entry.rule)).toEqual(
      expect.arrayContaining(["model-id-shape", "required-string", "collection-shape"]),
    );
  });

  it("checks stable ids, field parentage, and references", () => {
    const model = exampleModel({
      types: [{ id: "example.article", fields: [{ id: "example.wrong", valueType: "example.missing", required: "yes" as never }] }],
      relations: [{ id: "example.link", from: "example.missing", to: "example.article", cardinality: "some" as never }],
    });
    expect(validateDomainModel(model).map((entry) => entry.rule)).toEqual(
      expect.arrayContaining(["field-parent", "unknown-value-type", "required-shape", "relation-from-known", "relation-cardinality-known"]),
    );
  });

  it("checks duplicate closed vocabulary values and relation property types", () => {
    const model = exampleModel({
      vocabularies: [{ id: "example.state", values: ["draft", "draft"] }],
      relations: [{ id: "example.article.cites", from: "example.article", to: "example.source", cardinality: "many-to-many", properties: [{ id: "example.article.cites.rank", valueType: "example.none" }] }],
    });
    expect(validateDomainModel(model).map((entry) => entry.rule)).toEqual(expect.arrayContaining(["duplicate-vocabulary-value", "unknown-value-type"]));
  });

  it("does not permit one stable id to name multiple top-level declarations", () => {
    const model = exampleModel({
      valueTypes: [{ id: "example.article", primitive: "string" }],
    });
    expect(validateDomainModel(model).map((entry) => entry.rule)).toContain("duplicate-id");
  });
});

describe("normalization and serialization", () => {
  it("sorts collections and makes omitted required explicit", () => {
    const unordered = exampleModel({
      valueTypes: [{ id: "example.zeta", primitive: "string" }, { id: "example.alpha", primitive: "string" }],
      vocabularies: [{ id: "example.state", values: ["published", "draft"] }],
      types: [
        { id: "example.zeta", fields: [{ id: "example.zeta.value", valueType: "string" }] },
        { id: "example.alpha", fields: [{ id: "example.alpha.value", valueType: "string" }] },
      ],
      relations: [],
    });
    const normalized = normalizeDomainModel(unordered);
    expect(normalized.valueTypes.map((entry) => entry.id)).toEqual(["example.alpha", "example.zeta"]);
    expect(normalized.vocabularies[0]?.values).toEqual(["draft", "published"]);
    expect(normalized.types[0]?.fields?.[0]?.required).toBe(false);
  });

  it("serializes equal definitions to equal JSON regardless of input order", () => {
    const first = exampleModel();
    const second = exampleModel({
      types: [...(first.types ?? [])].reverse(),
      valueTypes: [...(first.valueTypes ?? [])].reverse(),
      vocabularies: [{ id: "example.state", values: ["published", "draft"] }],
    });
    expect(serializeDomainModel(first)).toBe(serializeDomainModel(second));
    expect(serializeDomainModel(first).endsWith("\n")).toBe(true);
  });
});

describe("compareDomainModels", () => {
  it("classifies additions and label/schema-version edits without treating labels as contracts", () => {
    const previous = exampleModel();
    const next = exampleModel({
      schemaVersion: "0.2.0",
      types: [
        ...(previous.types ?? []),
        { id: "example.collection", fields: [{ id: "example.collection.name", valueType: "string" }] },
      ],
      relations: previous.relations?.map((relation) => ({ ...relation, label: "Citation" })),
    });
    const report = compareDomainModels(previous, next);
    expect(report.compatible).toBe(true);
    expect(report.changes).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "additive", subject: "type", id: "example.collection" })]));
  });

  it("classifies field requiredness and value type changes as breaking", () => {
    const previous = exampleModel();
    const next = exampleModel({
      types: [
        {
          id: "example.article",
          fields: [
            { id: "example.article.title", valueType: "number", required: true },
            { id: "example.article.state", valueType: "example.state", required: true },
          ],
        },
        ...(previous.types ?? []).filter((entry) => entry.id === "example.source"),
      ],
    });
    const report = compareDomainModels(previous, next);
    expect(report.compatible).toBe(false);
    expect(report.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "breaking", subject: "field", id: "example.article.title" }),
      expect.objectContaining({ kind: "breaking", subject: "field", id: "example.article.state" }),
    ]));
  });

  it("classifies vocabulary removals, relation endpoint/cardinality changes, and required relation properties as breaking", () => {
    const previous = exampleModel();
    const next = exampleModel({
      vocabularies: [{ id: "example.state", values: ["draft"] }],
      relations: [{
        id: "example.article.cites",
        from: "example.source",
        to: "example.article",
        cardinality: "one-to-many",
        properties: [
          { id: "example.article.cites.score", valueType: "example.score" },
          { id: "example.article.cites.requiredNote", valueType: "string", required: true },
        ],
      }],
    });
    const report = compareDomainModels(previous, next);
    expect(report.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "breaking", subject: "vocabulary-value", id: "example.state.published" }),
      expect.objectContaining({ kind: "breaking", subject: "relation", id: "example.article.cites" }),
      expect.objectContaining({ kind: "breaking", subject: "relation-property", id: "example.article.cites.requiredNote" }),
    ]));
  });

  it("classifies removed types, value types, fields, and relations as breaking", () => {
    const previous = exampleModel();
    const next = exampleModel({
      valueTypes: [],
      types: [{ id: "example.article", fields: [] }],
      relations: [],
    });
    const report = compareDomainModels(previous, next);
    expect(report.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "breaking", subject: "value-type", id: "example.score" }),
      expect.objectContaining({ kind: "breaking", subject: "type", id: "example.source" }),
      expect.objectContaining({ kind: "breaking", subject: "field", id: "example.article.title" }),
      expect.objectContaining({ kind: "breaking", subject: "relation", id: "example.article.cites" }),
    ]));
  });

  it("returns validation findings instead of comparing invalid data", () => {
    const report = compareDomainModels(exampleModel(), { id: "example", schemaVersion: "0.2.0", types: "bad" as never });
    expect(report.compatible).toBe(false);
    expect(report.changes).toEqual([]);
    expect(report.nextFindings.map((entry) => entry.rule)).toContain("collection-shape");
  });
});

function exampleSnapshot(overrides: Partial<DomainSnapshotDefinition> = {}): DomainSnapshotDefinition {
  return {
    records: [
      {
        id: "article-1",
        type: "example.article",
        values: { "example.article.title": "A title", "example.article.state": "draft" },
      },
      {
        id: "source-1",
        type: "example.source",
        values: { "example.source.url": "https://example.test/source" },
      },
    ],
    relations: [
      {
        type: "example.article.cites",
        from: "article-1",
        to: "source-1",
        values: { "example.article.cites.score": 1 },
      },
    ],
    ...overrides,
  };
}

describe("domain snapshots", () => {
  it("detaches authoring values and supplies explicit collections and value objects", () => {
    const source = exampleSnapshot({ relations: [] });
    const snapshot = defineDomainSnapshot(source);
    (source.records?.[0]?.values as Record<string, unknown>)["example.article.title"] = "Changed";
    expect(snapshot.records[0]?.values["example.article.title"]).toBe("A title");
    expect(snapshot.relations).toEqual([]);
  });

  it("validates declared record fields, value types, and closed vocabularies", () => {
    const snapshot = exampleSnapshot({
      records: [
        {
          id: "article-1",
          type: "example.article",
          values: {
            "example.article.title": 42,
            "example.article.state": "unknown",
            "example.article.extra": true,
          },
        },
        { id: "source-1", type: "example.source", values: {} },
      ],
      relations: [{ type: "example.article.cites", from: "article-1", to: "source-1", values: { "example.article.cites.score": "high" } }],
    });
    expect(validateDomainSnapshot(exampleModel(), snapshot).map((entry) => entry.rule)).toEqual(
      expect.arrayContaining(["value-type", "vocabulary-value", "unknown-value", "required-value"]),
    );
  });

  it("validates snapshot structure, record identities, and relation endpoints", () => {
    const snapshot = exampleSnapshot({
      records: [
        { id: "article-1", type: "example.article", values: { "example.article.title": "A", "example.article.state": "draft" } },
        { id: "article-1", type: "example.article", values: {} },
        { id: "unknown", type: "example.none", values: {} },
      ],
      relations: [
        { type: "example.none", from: "article-1", to: "missing", values: {} },
        { type: "example.article.cites", from: "article-1", to: "missing", values: {} },
      ],
    });
    expect(validateDomainSnapshot(exampleModel(), snapshot).map((entry) => entry.rule)).toEqual(
      expect.arrayContaining(["duplicate-record-id", "unknown-record-type", "unknown-relation-type", "relation-to-record"]),
    );
  });

  it("validates primitive date representations without accepting calendar overflow", () => {
    const model = exampleModel({
      types: [{ id: "example.event", fields: [{ id: "example.event.day", valueType: "date", required: true }, { id: "example.event.at", valueType: "datetime", required: true }] }],
      relations: [],
    });
    const snapshot = {
      records: [{ id: "event-1", type: "example.event", values: { "example.event.day": "2026-02-30", "example.event.at": "2026-02-30T24:00:00Z" } }],
    };
    expect(validateDomainSnapshot(model, snapshot).map((entry) => entry.rule)).toEqual(["value-type", "value-type"]);
  });

  it.each([
    ["one-to-one", ["article-1", "source-1"], ["article-1", "source-2"]],
    ["one-to-many", ["article-1", "source-1"], ["article-2", "source-1"]],
    ["many-to-one", ["article-1", "source-1"], ["article-1", "source-2"]],
  ] as const)("enforces %s relation cardinality", (cardinality, first, second) => {
    const model = exampleModel({ relations: [{ id: "example.article.cites", from: "example.article", to: "example.source", cardinality, properties: [] }] });
    const records = [
      { id: "article-1", type: "example.article", values: { "example.article.title": "One", "example.article.state": "draft" } },
      { id: "article-2", type: "example.article", values: { "example.article.title": "Two", "example.article.state": "draft" } },
      { id: "source-1", type: "example.source", values: { "example.source.url": "https://example.test/one" } },
      { id: "source-2", type: "example.source", values: { "example.source.url": "https://example.test/two" } },
    ];
    const relations = [first, second].map(([from, to]) => ({ type: "example.article.cites", from, to, values: {} }));
    expect(validateDomainSnapshot(model, { records, relations }).map((entry) => entry.rule)).toContain("relation-cardinality");
  });

  it("does not treat repeated identical relation facts as cardinality violations", () => {
    const model = exampleModel({ relations: [{ id: "example.article.cites", from: "example.article", to: "example.source", cardinality: "many-to-one", properties: [] }] });
    const snapshot = exampleSnapshot({
      relations: [
        { type: "example.article.cites", from: "article-1", to: "source-1", values: {} },
        { type: "example.article.cites", from: "article-1", to: "source-1", values: {} },
      ],
    });
    expect(validateDomainSnapshot(model, snapshot)).toEqual([]);
  });

  it("allows many-to-many relations and serializes equivalent snapshots identically", () => {
    const model = exampleModel();
    const first = exampleSnapshot({
      records: [
        { id: "source-1", type: "example.source", values: { "example.source.url": "https://example.test/source" } },
        { id: "article-1", type: "example.article", values: { "example.article.state": "draft", "example.article.title": "A title" } },
      ],
    });
    const second = exampleSnapshot({ records: [...(first.records ?? [])].reverse() });
    expect(validateDomainSnapshot(model, first)).toEqual([]);
    expect(serializeDomainSnapshot(first)).toBe(serializeDomainSnapshot(second));
    expect(normalizeDomainSnapshot(first).records.map((record) => record.id)).toEqual(["article-1", "source-1"]);
    expect(serializeDomainSnapshot(first).endsWith("\n")).toBe(true);
  });

  it("reports invalid models instead of treating a snapshot as independently valid", () => {
    const model = exampleModel({ types: "bad" as never });
    expect(validateDomainSnapshot(model, exampleSnapshot()).map((entry) => entry.rule)).toContain("model-collection-shape");
  });
});
