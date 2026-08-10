import { describe, expect, it } from "vitest";
import { compareDomainModels, defineDomainModel, normalizeDomainModel, serializeDomainModel, validateDomainModel } from "./index.js";
import type { DomainModelDefinition, ValueTypeDefinition } from "./types.js";

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
