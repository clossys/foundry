import { describe, expect, it } from "vitest";
import { defineDomainModel, validateDomainModel } from "@vespeneventures/domain-model";

describe("domain-model compatibility package", () => {
  it("re-exports the canonical domain API", () => {
    const model = defineDomainModel({ id: "example", schemaVersion: "1.0.0" });

    expect(validateDomainModel(model)).toEqual([]);
  });
});
