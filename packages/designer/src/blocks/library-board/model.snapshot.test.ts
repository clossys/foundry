/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { assertRuntimeSnapshot, runtimeHash, runtimeSnapshot } from "../../catalog-core/runtime-ports.js";
import { assertLibraryBoardRecords, type LibraryBoardRecords } from "./model.js";

/** Public, generated records; no consumer data or qualification observations. */
function records(count = 1): LibraryBoardRecords {
  return {
    columns: { version: 1, items: [{ id: "example", label: "Example", role: "consumer", license: "MIT", source: "example", referenceOnly: false }] },
    rows: { version: 1, layer: "components", boardId: "components/example", label: "Example", items: Array.from({ length: count }, (_, index) => ({
      id: `components.example-${index}`, label: `Example ${index}`, scope: "slot", selectedSource: "example",
      candidates: [{ source: "example", usable: false, findings: [{ code: "pending", severity: "notice", message: "Pending" }], provenance: { source: "example", layer: "components", fill: {
        id: `example-${index}`, slot: `components.example-${index}`, source: "example", mode: "implementation", sourceAddress: "example", relation: "same-contract",
        builtOn: [], conforms: [], evidence: [], author: "consumer", trust: "consumer", license: "MIT", status: "draft",
      } } }],
      prompt: { consumer: "example", board: { id: "components/example", label: "Example" }, slot: { id: `components.example-${index}`, label: `Example ${index}` }, variants: [], tokens: [{ id: "tokens.example", value: "value" }], siblings: [], returnStep: "Return" },
    })) },
    controls: { version: 1, mode: "view", canSave: false, pending: false },
  };
}

it("validates board records twice without discarded snapshot allocations or input changes", () => {
  const input = records(59), hash = runtimeHash(input);
  const freeze = vi.spyOn(Object, "freeze"), entries = vi.spyOn(Object, "fromEntries"), descriptors = vi.spyOn(Object, "getOwnPropertyDescriptors");
  let copies = 0, objects = 0, visits = 0, snapshotVisits = 0, snapshotCopies = 0;
  try {
    runtimeSnapshot(input);
    snapshotVisits = descriptors.mock.calls.length;
    snapshotCopies = freeze.mock.calls.length;
    freeze.mockClear(); entries.mockClear(); descriptors.mockClear();
    assertLibraryBoardRecords(input);
    copies = freeze.mock.calls.length; objects = entries.mock.calls.length; visits = descriptors.mock.calls.length;
  } finally { freeze.mockRestore(); entries.mockRestore(); descriptors.mockRestore(); }
  expect(snapshotVisits).toBeGreaterThan(59);
  expect(snapshotCopies).toBe(snapshotVisits);
  expect(visits).toBe(2 * snapshotVisits);
  expect(copies).toBe(0); expect(objects).toBe(0);
  expect(runtimeHash(input)).toBe(hash);
  expect(Object.isFrozen(input)).toBe(false);
  expect(Object.isFrozen(input.rows.items[0]!.prompt.tokens)).toBe(false);
  console.info("runtime board validation allocations", JSON.stringify({ rows: 59, passes: 2, descriptorVisits: visits, copiedContainersBefore: 2 * snapshotCopies, copiedContainersAfter: copies, copiedObjectsAfter: objects }));
});

it("rejects accessors before schema reads and still rejects schema errors", () => {
  let reads = 0;
  const input = records();
  Object.defineProperty(input, "rows", { enumerable: true, get() { reads++; return {}; } });
  expect(() => assertLibraryBoardRecords(input)).toThrow("runtime: snapshot accessor or hidden field");
  expect(reads).toBe(0);
  expect(() => assertLibraryBoardRecords({ ...records(), extra: true })).toThrow("Unknown or missing library board field");
  expect(() => assertLibraryBoardRecords({ ...records(), controls: { ...records().controls, mode: "other" } })).toThrow("Unsupported library board record version or mode");
});

it("retains the second descriptor pass after schema inspection", () => {
  const original = records();
  const fill = original.rows.items[0]!.candidates[0]!.provenance.fill;
  let inspected = false;
  const input = { ...original, controls: new Proxy(original.controls, { get(target, key, receiver) {
    if (key === "pending") { inspected = true; Object.assign(fill, { callback() {} }); }
    return Reflect.get(target, key, receiver);
  } }) };
  expect(() => assertLibraryBoardRecords(input)).toThrow("runtime: plain finite snapshot required");
  expect(inspected).toBe(true);
});

it("reports the board's two descriptor passes with and without discarded copies", () => {
  const input = records(59), rounds = 20;
  // Isolate the two serializability passes; identical board schema work is excluded.
  const legacy = () => { runtimeSnapshot(input); runtimeSnapshot(input); };
  const current = () => { assertRuntimeSnapshot(input); assertRuntimeSnapshot(input); };
  for (let index = 0; index < 3; index++) { legacy(); current(); }
  const measure = (run: () => void) => { const start = performance.now(); for (let index = 0; index < rounds; index++) run(); return performance.now() - start; };
  const copiedMs = measure(legacy), validationMs = measure(current);
  console.info("runtime board validation microbenchmark", JSON.stringify({ rows: 59, rounds, copiedMs, validationMs, note: "Diagnostic only; same two descriptor passes, board schema work excluded. No wall-time assertion or browser clearance." }));
  expect(input.rows.items).toHaveLength(59);
});


it("deep-validates each detached board snapshot identity once", () => {
  const first = runtimeSnapshot(records()), second = runtimeSnapshot(records());
  const descriptors = vi.spyOn(Object, "getOwnPropertyDescriptors");
  let initialVisits = 0, repeatVisits = 0, secondVisits = 0;
  try {
    assertLibraryBoardRecords(first);
    initialVisits = descriptors.mock.calls.length;
    descriptors.mockClear();
    for (let render = 0; render < 4; render++) assertLibraryBoardRecords(first);
    repeatVisits = descriptors.mock.calls.length;
    descriptors.mockClear();
    assertLibraryBoardRecords(second);
    secondVisits = descriptors.mock.calls.length;
  } finally { descriptors.mockRestore(); }
  expect(initialVisits).toBeGreaterThan(2);
  expect(repeatVisits).toBe(0);
  expect(secondVisits).toBe(initialVisits);
});

it("never caches mutable, shallow-frozen or proxy board clearance", () => {
  for (const wrap of [(value: LibraryBoardRecords) => value, Object.freeze, (value: LibraryBoardRecords) => new Proxy(value, {})]) {
    const input = wrap(records());
    assertLibraryBoardRecords(input);
    Object.assign(input.rows.items[0]!.prompt.tokens[0]!, { callback() {} });
    expect(() => assertLibraryBoardRecords(input)).toThrow("runtime: plain finite snapshot required");
  }
  const invalid = runtimeSnapshot({ ...records(), controls: { ...records().controls, mode: "other" } });
  for (let attempt = 0; attempt < 2; attempt++) expect(() => assertLibraryBoardRecords(invalid)).toThrow("Unsupported library board record version or mode");
});
