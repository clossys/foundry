import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emitCopyPortTypes } from "../../../scripts/generate-copy-ports.mjs";

const local = (path: string) => new URL(path, import.meta.url);
const passages = JSON.parse(readFileSync(local("../../../../writer/src/catalog/slots/passages.json"), "utf8"));
const current = () => readFileSync(local("./copy-ports.ts"), "utf8");
describe("Writer-derived section copy ports", () => {
  it("keeps the generated types synchronized with every actual passage key and kind", () => {
    expect(current()).toContain(emitCopyPortTypes(passages));
    const output = emitCopyPortTypes(passages);
    expect(output).toContain('readonly "states.empty.label": string');
    expect(output).toContain('readonly "pagination.total-text"?: WriterIcuMessage<"pagination.total-text">');
  });
  it("makes Writer contract drift visible rather than accepting invented Designer keys", () => {
    const changed = structuredClone(passages);
    const section = changed.find((slot: { id: string }) => slot.id === "passages.data-table");
    section.contract.copy.fields.push({ key: "labels.writerAdded", kind: "plain", required: true });
    expect(current()).not.toContain(emitCopyPortTypes(changed));
    section.contract.copy.fields.push({ key: "labels.writerAdded", kind: "plain", required: true });
    expect(() => emitCopyPortTypes(changed)).toThrow(/duplicate/i);
  });
});
