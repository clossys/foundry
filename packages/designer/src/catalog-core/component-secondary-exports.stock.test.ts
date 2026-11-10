// @vitest-environment node
import { describe, expect, it } from "vitest";
import profile from "../studio/default-component-preview-profile.json" with { type: "json" };
import { componentSecondaryExports } from "./component-secondary-exports.js";
import { sha256 } from "./digest.js";
import type { ComponentCandidate } from "./resolve-components.js";

// R2F-33c (a): unmodified stock sources prove their function exports by the generated AST proof table.
const entry = "components/combo-box/combobox.tsx";
const stock = profile.files.find(file => file.path === entry)!.content;
const rows = ["ComboboxContent", "ComboboxInput", "ComboboxItem", "ComboboxList"].map(name => ({ name, export: name }));
const fill = { slot: "components.combo-box", impl: { kind: "source", entry, export: "Combobox" }, secondaryExports: rows, outputSha256: [{ path: entry, sha256: sha256(stock) }] } as unknown as ComponentCandidate;

describe("secondary exports of an unmodified stock source", () => {
  it("accepts the stock combobox anatomy, whose context and refs the bounded grammar cannot read", () => {
    expect(componentSecondaryExports(fill, [{ path: entry, content: stock }]).map(row => row.name)).toEqual(rows.map(row => row.name));
  });
  it("refuses the same exports from modified or hand-written bytes", () => {
    expect(() => componentSecondaryExports(fill, [{ path: entry, content: `${stock}\n` }])).toThrow(/unsupported secondary export source/);
    const copy = stock.replace("function ComboboxInput(", "function ComboboxInputCopy(");
    expect(() => componentSecondaryExports(fill, [{ path: entry, content: copy }])).toThrow(/unsupported secondary export source/);
  });
  it("refuses stock bytes outside the fill's own output receipt", () => {
    const relocated = "components/combo-box/relocated.tsx";
    expect(() => componentSecondaryExports({ ...fill, impl: { ...fill.impl, entry: relocated } } as ComponentCandidate, [{ path: relocated, content: stock }])).toThrow(/unsupported secondary export source/);
    expect(() => componentSecondaryExports({ ...fill, outputSha256: undefined } as unknown as ComponentCandidate, [{ path: entry, content: stock }])).toThrow(/unsupported secondary export source/);
  });
});
