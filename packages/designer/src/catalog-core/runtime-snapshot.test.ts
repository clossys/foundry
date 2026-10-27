/** @vitest-environment node */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assertRuntimeSnapshot, runtimeHash, runtimeSnapshot } from "./runtime-ports.js";
import { stableStringify } from "./stable.js";

const plain = (value: object) => Object.assign(Object.create(null), value);
const shared = { value: "shared" };
const ownPrototypeKey = Object.defineProperty({}, "__proto__", { value: { value: "own" }, enumerable: true });
const valid = [
  { name: "null", input: null, expected: null },
  { name: "boolean", input: false, expected: false },
  { name: "string", input: "value", expected: "value" },
  { name: "finite number", input: Number.MAX_VALUE, expected: Number.MAX_VALUE },
  { name: "negative zero", input: -0, expected: -0 },
  { name: "optional undefined object field", input: { missing: undefined, present: null }, expected: { present: null } },
  { name: "null prototype object", input: plain({ nested: plain({ value: 1 }) }), expected: { nested: { value: 1 } } },
  { name: "null prototype array", input: Object.setPrototypeOf([1, null], null), expected: [1, null] },
  { name: "shared DAG", input: { left: shared, right: shared }, expected: { left: { value: "shared" }, right: { value: "shared" } } },
  { name: "already frozen input", input: Object.freeze({ items: Object.freeze([true]) }), expected: { items: [true] } },
  { name: "own prototype key", input: ownPrototypeKey, expected: ownPrototypeKey },
];

const descriptor = (key: PropertyKey, field: PropertyDescriptor) => () => Object.defineProperty({}, key, field);
const arrayField = (key: PropertyKey, field: PropertyDescriptor) => () => Object.defineProperty([1], key, field);
const invalid = [
  { name: "undefined root", make: () => undefined },
  { name: "function", make: () => ({ value() {} }) },
  { name: "bigint", make: () => 1n },
  { name: "symbol value", make: () => Symbol("value") },
  { name: "NaN", make: () => ({ value: NaN }) },
  { name: "infinity", make: () => Infinity },
  { name: "negative infinity", make: () => -Infinity },
  { name: "Date", make: () => new Date(0) },
  { name: "Map", make: () => new Map() },
  { name: "Set", make: () => new Set() },
  { name: "typed array", make: () => new Uint8Array([1]) },
  { name: "boxed primitive", make: () => Object("value") },
  { name: "custom object prototype", make: () => Object.create({ inherited: true }) },
  { name: "custom array prototype", make: () => Object.setPrototypeOf([1], {}) },
  { name: "undefined array entry", make: () => [undefined] },
  { name: "sparse array", make: () => Array(2) },
  { name: "array extra field", make: arrayField("extra", { value: true, enumerable: true }) },
  { name: "array symbol field", make: arrayField(Symbol("extra"), { value: true, enumerable: true }) },
  { name: "hidden array index", make: arrayField("0", { value: 1, enumerable: false }) },
  { name: "object symbol field", make: descriptor(Symbol("extra"), { value: 1, enumerable: true }) },
  { name: "undefined symbol field", make: descriptor(Symbol("extra"), { value: undefined, enumerable: true }) },
  { name: "hidden data field", make: descriptor("hidden", { value: 1 }) },
  { name: "hidden undefined field", make: descriptor("hidden", { value: undefined }) },
  { name: "setter", make: descriptor("value", { set() {}, enumerable: true }) },
  { name: "object cycle", make: () => { const value: { self?: unknown } = {}; value.self = value; return value; } },
  { name: "array cycle", make: () => { const value: unknown[] = []; value.push(value); return value; } },
  { name: "indirect cycle", make: () => { const a: { next?: unknown } = {}, b = { next: a }; a.next = b; return a; } },
];

describe("runtime snapshot validation parity", () => {
  it.each(valid)("accepts $name without changing snapshot bytes or hashes", ({ input, expected }) => {
    expect(assertRuntimeSnapshot(input)).toBeUndefined();
    const snapshot = runtimeSnapshot(input);
    expect(snapshot).toEqual(expected);
    expect(stableStringify(snapshot)).toBe(stableStringify(expected));
    expect(runtimeHash(input)).toBe(`sha256:${createHash("sha256").update(stableStringify(expected)).digest("hex")}`);
  });

  it.each(invalid)("rejects $name in both modes", ({ make }) => {
    for (const run of [assertRuntimeSnapshot, runtimeSnapshot, runtimeHash]) expect(() => run(make())).toThrow(TypeError);
  });

  it.each(["object", "hidden", "symbol", "array"])("never reads a %s accessor", kind => {
    let reads = 0;
    const field = { get() { reads++; return "value"; }, enumerable: kind !== "hidden" };
    const input = kind === "array" ? Object.defineProperty([1], "0", field)
      : Object.defineProperty({}, kind === "symbol" ? Symbol("value") : "value", field);
    for (const run of [assertRuntimeSnapshot, runtimeSnapshot]) expect(() => run(input)).toThrow(TypeError);
    expect(reads).toBe(0);
  });

  it("does not freeze or change caller descriptors, and still makes detached frozen copies", () => {
    const leaf = plain({ value: "before" });
    const input = { left: leaf, right: leaf, items: [leaf], missing: undefined };
    const descriptors = Object.getOwnPropertyDescriptors(input);
    assertRuntimeSnapshot(input);
    expect(Object.getOwnPropertyDescriptors(input)).toEqual(descriptors);
    for (const value of [input, leaf, input.items]) expect(Object.isFrozen(value)).toBe(false);
    const snapshot = runtimeSnapshot(input);
    expect(snapshot.left).not.toBe(snapshot.right);
    expect(snapshot.left).not.toBe(leaf);
    expect(Object.getPrototypeOf(snapshot.left)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(snapshot.left, "value")).toEqual({ value: "before", enumerable: true, configurable: false, writable: false });
    for (const value of [snapshot, snapshot.left, snapshot.right, snapshot.items, snapshot.items[0]]) expect(Object.isFrozen(value)).toBe(true);
    expect(Object.hasOwn(snapshot, "missing")).toBe(false);
    leaf.value = "after";
    expect(snapshot.left.value).toBe("before");
    expect(Object.isFrozen(leaf)).toBe(false);
    expect(Object.hasOwn(input, "missing")).toBe(true);
  });

  it("preserves array length descriptors and treats an own __proto__ as data", () => {
    const snapshot = runtimeSnapshot({ array: Object.freeze([1]), object: ownPrototypeKey });
    expect(Object.getOwnPropertyDescriptor(snapshot.array, "length")).toEqual({ value: 1, enumerable: false, configurable: false, writable: false });
    expect(Object.getPrototypeOf(snapshot.object)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(snapshot.object, "__proto__")).toEqual({ value: { value: "own" }, enumerable: true, configurable: false, writable: false });
  });

  it("checks the same descriptors without allocating or freezing snapshot copies", () => {
    const input = { one: [{ value: 1 }], two: { optional: undefined } };
    const measure = (run: () => unknown) => {
      const freeze = vi.spyOn(Object, "freeze"), entries = vi.spyOn(Object, "fromEntries"), descriptors = vi.spyOn(Object, "getOwnPropertyDescriptors");
      try {
        run();
        return { freezes: freeze.mock.calls.length, objects: entries.mock.calls.length, visits: descriptors.mock.calls.length };
      } finally { freeze.mockRestore(); entries.mockRestore(); descriptors.mockRestore(); }
    };
    expect(measure(() => runtimeSnapshot(input))).toEqual({ freezes: 4, objects: 3, visits: 4 });
    expect(measure(() => assertRuntimeSnapshot(input))).toEqual({ freezes: 0, objects: 0, visits: 4 });
  });
});
