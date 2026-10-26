/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { standardM1FixtureEngine, standardM1Runtime } from "./__fixtures__/standard-m1-runtime.js";
import { checkConsumerRuntimePorts, runtimeHash, runtimeSnapshot } from "./runtime-ports.js";
import { libraryHash } from "./api.js";
import type { RuntimeFillDescriptor } from "./runtime-ports.js";
const engine = standardM1FixtureEngine();
const fixture = () => standardM1Runtime({ engine: structuredClone(engine), identity: { kind: "git", head: "1".repeat(40), tree: "2".repeat(40) }, source: { entry: "synthetic.tsx", files: { "synthetic.tsx": "// SYNTHETIC source descriptor; no browser clearance" }, dependencies: {} }, css: [{ id: "fixture.css", contents: "body{margin:0}" }] });
describe("consumer runtime port conformance", () => {
  it("accepts explicit consumer identity, source, slots and callback bindings", () => {
    const input = fixture(); const hash = libraryHash(input.engine.library);
    expect(checkConsumerRuntimePorts(input.ports, input.contracts, { consumer: input.engine.library.source.id, libraryHash: hash, selectionHash: hash })).toEqual({ status: "valid", findings: [] });
    expect(JSON.parse(JSON.stringify(input.ports.manifest))).toEqual(input.ports.manifest);
  });
  it.each(["consumer", "libraryHash", "selectionHash"] as const)("refuses stale %s", key => {
    const input = fixture(); const hash = libraryHash(input.engine.library);
    const ports = { ...input.ports, manifest: { ...input.ports.manifest, [key]: "different" } };
    expect(checkConsumerRuntimePorts(ports, input.contracts, { consumer: input.engine.library.source.id, libraryHash: hash, selectionHash: hash }).status).toBe("refused");
  });
  it.each(["foreign", "leaf", "kind", "duplicate", "slot", "member", "state", "source", "callback"])("refuses %s runtime drift", change => {
    const input = fixture(); const hash = libraryHash(input.engine.library);
    const fills: RuntimeFillDescriptor[] = structuredClone(input.ports.manifest.fills);
    const original = fills[0]!;
    if (change === "foreign") fills[0] = { ...original, library: "other" };
    if (change === "leaf") fills[0] = { ...original, leaf: "frames.missing" };
    if (change === "kind") fills[0] = { ...original, kind: "section" };
    if (change === "duplicate") fills.push(original);
    if (change === "slot") fills[0] = { ...original, slots: ["main"] };
    if (change === "member") fills[0] = { ...original, members: ["invented.value"] };
    if (change === "state") fills[0] = { ...original, states: [] };
    if (change === "source") fills[0] = { ...original, renderer: { ...original.renderer, source: { ...original.renderer.source, files: { "synthetic.tsx": "changed bytes" } } } };
    const ports = { ...input.ports, manifest: { ...input.ports.manifest, fills }, renderers: change === "callback" ? {} : input.ports.renderers };
    expect(checkConsumerRuntimePorts(ports, input.contracts, { consumer: input.engine.library.source.id, libraryHash: hash, selectionHash: hash }).status).toBe("refused");
  });
  it("requires pinned dependency artifact versions and closed relative source paths", () => {
    const input = fixture(); const hash = libraryHash(input.engine.library); const first = input.ports.manifest.fills[0]!;
    for (const source of [
      { entry: "../outside.ts", files: { "../outside.ts": "bytes" }, dependencies: {} },
      { ...first.renderer.source, dependencies: { react: { version: "latest", artifact: runtimeHash("fixture") } } },
    ]) {
      const fill = { ...first, renderer: { ...first.renderer, source, sourceHash: runtimeHash(source) } };
      expect(checkConsumerRuntimePorts({ ...input.ports, manifest: { ...input.ports.manifest, fills: [fill] } }, input.contracts, { consumer: input.engine.library.source.id, libraryHash: hash, selectionHash: hash }).status).toBe("refused");
    }
  });
  it("takes immutable plain snapshots without invoking accessors", () => {
    const value = { a: [{ b: "before" }] }; const snapshot = runtimeSnapshot(value); value.a[0]!.b = "after";
    expect(snapshot.a[0]!.b).toBe("before"); expect(Object.isFrozen(snapshot.a[0])).toBe(true);
    let reads = 0;
    for (const invalid of [{ get value() { reads++; return "hidden"; } }, { fn() {} }, [undefined], Array(2), { n: NaN }, new Date()]) expect(() => runtimeSnapshot(invalid)).toThrow();
    expect(reads).toBe(0);
    const cycle: { self?: unknown } = {}; cycle.self = cycle; expect(() => runtimeHash(cycle)).toThrow();
  });
});
