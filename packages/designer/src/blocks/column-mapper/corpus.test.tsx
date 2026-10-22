import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ColumnMapper, type ColumnMapperProps } from "../ColumnMapper.js";
import { columnMapperSample } from "./sample.js";

type Entry = { name: string; accepted: boolean; change: (p: ColumnMapperProps) => unknown };
const mapping = (value: unknown) => (p: ColumnMapperProps) => ({ ...p, mapping: { ...p.mapping, email: value } });
const kind = (value: unknown) => (p: ColumnMapperProps) => ({ ...p, targets: [{ ...p.targets[0], kind: value }, ...p.targets.slice(1)] });
// Keep exactly the seven cutter-written classes; accepted cases are handwritten.
const entries: Entry[] = [];
for (const [group, values, change] of [
  ["single-character source", ["emal"], mapping], ["single-character kind", ["numbr"], kind],
  ["case kind", ["Text", "DATE"], kind], ["case source", ["Email"], mapping],
  ["separators", ["email ", "e-mail", "e_mail"], mapping], ["lookalikes", ["\u0435mail"], mapping],
  ["neighbour kinds", ["string", "integer", "datetime", "select", "list"], kind],
  ["neighbour mappings", ["none", "ignore", ""], mapping],
  ["wrong-type mapping", [0, false, undefined, ["email"]], mapping],
] as const) for (const value of values) entries.push({ name: `${group}: ${String(value)}`, accepted: false, change: change(value) });
entries.push(
  { name: "wrong-type required", accepted: false, change: p => ({ ...p, targets: [{ ...p.targets[0], required: "yes" }, ...p.targets.slice(1)] }) },
  { name: "wrong-type samples", accepted: false, change: p => ({ ...p, sourceColumns: [{ ...p.sourceColumns[0], samples: "Ada" }, ...p.sourceColumns.slice(1)] }) },
  { name: "container: mapping array", accepted: false, change: p => ({ ...p, mapping: [["email", "email"]] }) },
  { name: "container: mapping Map", accepted: false, change: p => ({ ...p, mapping: new Map([["email", "email"]]) }) },
  { name: "container: targets object", accepted: false, change: p => ({ ...p, targets: { name: p.targets[0] } }) },
  { name: "container: sources object", accepted: false, change: p => ({ ...p, sourceColumns: { name: p.sourceColumns[0] } }) },
  { name: "accepted null", accepted: true, change: mapping(null) },
  { name: "accepted missing", accepted: true, change: p => { const value = { ...p.mapping }; delete value.email; return { ...p, mapping: value }; } },
  { name: "accepted source name", accepted: true, change: mapping("name") },
  { name: "accepted source email", accepted: true, change: mapping("email") },
  { name: "accepted source team", accepted: true, change: mapping("team") },
  { name: "accepted source joined", accepted: true, change: mapping("joined") },
  { name: "accepted kind text", accepted: true, change: kind("text") },
  { name: "accepted kind number", accepted: true, change: kind("number") },
  { name: "accepted kind date", accepted: true, change: kind("date") },
  { name: "accepted kind enum", accepted: true, change: kind("enum") },
  { name: "accepted kind tags", accepted: true, change: kind("tags") },
  { name: "accepted kind boolean", accepted: true, change: kind("boolean") },
);

describe("ColumnMapper immutable near-miss render corpus (MC1, MC2, MC5)", () => {
  it.each(entries)("$name", ({ change, accepted }) => {
    const attempt = () => render(<ColumnMapper {...change(columnMapperSample) as ColumnMapperProps} />);
    if (accepted) expect(attempt).not.toThrow();
    else expect(attempt).toThrow(TypeError);
  });
});
