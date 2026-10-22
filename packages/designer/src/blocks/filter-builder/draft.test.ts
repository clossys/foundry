import { describe, expect, it } from "vitest";
import { complete, newCondition, operatorsFor } from "./draft.js";
import type { TableColumnKind } from "../table-model/index.js";

describe("FilterBuilder kind contracts", () => {
  it.each([
    ["text", "contains", ["contains", "equals", "notEquals", "empty", "notEmpty"]],
    ["number", "range", ["range", "empty", "notEmpty"]],
    ["date", "range", ["range", "empty", "notEmpty"]],
    ["enum", "in", ["in", "notIn", "empty", "notEmpty"]],
    ["tags", "any", ["any", "all", "none", "empty", "notEmpty"]],
    ["boolean", "equals", ["equals", "empty", "notEmpty"]],
  ] as const)("starts %s drafts with %s and exposes the permitted operators", (kind, op, operators) => {
    expect(newCondition({ id: "value", kind })).toMatchObject({ column: "value", kind, op });
    expect(operatorsFor(kind)).toEqual(operators);
    expect(complete(newCondition({ id: "value", kind }))).toBe(kind === "boolean");
    expect(complete({ column: "value", kind: kind as TableColumnKind, op: "empty" })).toBe(true);
    expect(complete({ column: "value", kind: kind as TableColumnKind, op: "notEmpty" })).toBe(true);
  });
});
