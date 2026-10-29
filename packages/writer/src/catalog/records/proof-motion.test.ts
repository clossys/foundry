import { describe, expect, it } from "vitest";
import site from "./site.en.json" with { type: "json" };
import passages from "../slots/passages.json" with { type: "json" };
import { validateWriterRecord } from "../../model/validate.js";

describe("draft proof-section motion copy", () => {
  it.each([
    ["logo-cloud", "pause"], ["logo-cloud", "resume"],
    ["testimonials", "previous"], ["testimonials", "next"],
  ])("declares the %s %s control as authored draft copy and a passage field", (section, control) => {
    const alias = `st.proof.${section}.${control}`;
    const id = (site.aliases as Record<string, string>)[alias];
    expect(id).toMatch(/^st\.[0123456789abcdefghjkmnpqrstvwxyz]{10}$/);
    const record = site.records.find(row => row.id === id)!;
    expect(record).toMatchObject({ status: "draft", origin: "authored", leaf: "strings.field-labels" });
    expect(record).not.toHaveProperty("approval");
    expect(validateWriterRecord(record, "strings")).toEqual([]);
    const schema = passages.find(row => row.id === `passages.${section}`)!;
    expect(schema.contract.copy.fields).toContainEqual(expect.objectContaining({ key: `controls.${control}`, kind: "plain" }));
  });
});
