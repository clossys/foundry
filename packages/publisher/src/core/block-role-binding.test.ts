import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import * as core from "./index.js";
import type { BlockRoleDescriptor } from "./block-role.js";
import { checkImportPurity } from "../../../../scripts/lib/import-purity.mjs";

const { validateBlockRoleBinding } = core;
beforeAll(() => expect(validateBlockRoleBinding, "Publisher/core must export validateBlockRoleBinding").toBeTypeOf("function"));
const frame: BlockRoleDescriptor & { role: "frame" } = {
  blockId: "shared", role: "frame", medium: "web",
  adapter: { owner: "@clossys/publisher", subpath: "web", export: "SiteFrame", config: {} },
  regions: [{ key: "main", required: true, childRoles: ["view"], content: ["document"] }],
  content: ["document"], runtime: ["server"], lifecycle: { requires: [], provides: ["skip-focus"] },
  layout: "flow", web: { main: "sole", skipTarget: "main" },
  evidence: { sourceRevision: "a".repeat(40), measuredAt: "2026-10-17" },
};
const view: BlockRoleDescriptor & { role: "view" } = {
  ...frame, role: "view", adapter: { ...frame.adapter, export: "LandingView", config: { landmark: "none" } },
  regions: [{ key: "body", required: true, childRoles: [], content: ["document"] }],
  lifecycle: { requires: [], provides: [] }, web: { main: "none" },
};
const binding = { context: { consumer: "example", brand: "standard", medium: "web" as const }, frameBlockRef: frame, viewBlockRef: view };
const known = [frame, view];
const validate = (input: unknown) => validateBlockRoleBinding(input, known);
const sha = (value: string) => "sha256:" + createHash("sha256").update(value).digest("hex");

describe("two-ref Instance binding", () => {
  it("checks separate and coincident Block ids under two independent roles", () => {
    for (const blockId of ["shared", "other"]) {
      const result = validate({ ...binding, viewBlockRef: { ...view, blockId } });
      expect(result).toMatchObject({ status: "unverified", reasons: [
        { ref: "frameBlockRef", code: "measurement-required" }, { ref: "viewBlockRef", code: "measurement-required" },
      ], identity: { context: binding.context, frameBlockRef: { blockId: "shared", role: "frame" }, viewBlockRef: { blockId, role: "view" } } });
    }
    expect(validate({ ...binding, viewBlockRef: { ...view, adapter: { ...view.adapter, export: "Unknown" } } })).toMatchObject({
      status: "unverified", reasons: [{ ref: "frameBlockRef", code: "measurement-required" }, { ref: "viewBlockRef", code: "unknown-adapter" }],
    });
    expect(validate({ ...binding, viewBlockRef: { ...view, evidence: {} } })).toMatchObject({ status: "shape-error", path: "viewBlockRef.evidence" });
  });
  it("refuses missing and swapped refs with typed paths or compatibility reasons", () => {
    for (const ref of ["frameBlockRef", "viewBlockRef"] as const) {
      const input = { ...binding }; delete (input as Partial<typeof binding>)[ref];
      expect(validate(input)).toMatchObject({ status: "shape-error", path: ref });
    }
    expect(validate({ ...binding, frameBlockRef: view, viewBlockRef: frame })).toMatchObject({ status: "unsupported", reasons: [
      { ref: "frameBlockRef", code: "role-mismatch" }, { ref: "viewBlockRef", code: "role-mismatch" },
    ] });
  });
  it("refuses pair and context medium mismatches even with known candidates", () => {
    const print = { ...view, medium: "print" as const, web: undefined };
    for (const input of [{ ...binding, viewBlockRef: print }, { ...binding, context: { ...binding.context, medium: "email" } }]) {
      expect(validateBlockRoleBinding(input, [...known, print])).toMatchObject({ status: "unsupported", reasons: [{ ref: "pair", code: "medium-mismatch" }] });
    }
  });
  it("uses non-web declarations without inventing HTML obligations", () => {
    const printFrame = { ...frame, medium: "print" as const, web: undefined };
    const printView = { ...view, medium: "print" as const, web: undefined };
    expect(validateBlockRoleBinding({ context: { ...binding.context, medium: "print" }, frameBlockRef: printFrame, viewBlockRef: printView }, [printFrame, printView])).toMatchObject({ status: "unverified" });
  });
  it("never qualifies a pair from one ref or caller flags and result-shaped objects", () => {
    for (const ref of ["frameBlockRef", "viewBlockRef"] as const) {
      const descriptor = binding[ref];
      expect(validate({ ...binding, [ref]: { ...descriptor, qualified: true, status: "qualified" } }).status).toBe("unverified");
      expect(validate({ ...binding, [ref]: { ...descriptor, configDigest: "sha256:forged" } })).toHaveProperty(`identity.${ref}.configDigest`, sha(JSON.stringify(descriptor.adapter.config)));
      expect(validate({ ...binding, [ref]: { status: "qualified", descriptor } }).status).toBe("shape-error");
      expect(validate({ ...binding, [ref]: true }).status).toBe("shape-error");
      expect(validate({ ...binding, [ref]: { ...descriptor, medium: "video", web: undefined } }).status).toBe("unsupported");
    }
    expect(validate({ ...binding, frameBlockRef: { ...frame, adapter: { ...frame.adapter, export: "Unknown" } }, viewBlockRef: { ...view, adapter: { ...view.adapter, export: "Unknown" } } })).toMatchObject({
      reasons: [{ ref: "frameBlockRef", code: "unknown-adapter" }, { ref: "viewBlockRef", code: "unknown-adapter" }],
    });
  });
  it("refuses a framed web view owning main with a compatibility reason", () => {
    const result = validate({ ...binding, viewBlockRef: { ...view, web: { main: "sole" } } });
    expect(result).toMatchObject({ status: "unsupported", reasons: [{ ref: "viewBlockRef", code: "web-main" }] });
    expect(result).not.toHaveProperty("path");
    expect(validate({ ...binding, viewBlockRef: { ...view, web: { main: 1 } } })).toMatchObject({ status: "shape-error", path: "viewBlockRef.web" });
  });
  it("derives a closed identity from adapter, exact config, revision and context", () => {
    const result = validate(binding);
    expect(result).toHaveProperty("identity");
    if (!("identity" in result) || !result.identity) throw new Error("Missing identity");
    expect(result.identity.frameBlockRef.configDigest).toBe("sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
    expect(result.identity).toEqual({ context: binding.context,
      frameBlockRef: { blockId: frame.blockId, role: "frame", medium: "web",
        adapter: { owner: frame.adapter.owner, subpath: "web", export: "SiteFrame" },
        configDigest: sha("{}"), sourceRevision: frame.evidence.sourceRevision },
      viewBlockRef: { blockId: view.blockId, role: "view", medium: "web",
        adapter: { owner: view.adapter.owner, subpath: "web", export: "LandingView" },
        configDigest: sha('{"landmark":"none"}'), sourceRevision: view.evidence.sourceRevision },
    });
    const changes: [object, string, string][] = [
      [{ context: { ...binding.context, consumer: "another" } }, "context.consumer", "another"],
      [{ context: { ...binding.context, brand: "another" } }, "context.brand", "another"],
      [{ viewBlockRef: { ...view, evidence: { ...view.evidence, sourceRevision: "b".repeat(40) } } }, "viewBlockRef.sourceRevision", "b".repeat(40)],
      [{ viewBlockRef: { ...view, adapter: { ...view.adapter, config: { landmark: "none", changed: true } } } }, "viewBlockRef.configDigest", sha('{"changed":true,"landmark":"none"}')],
    ];
    for (const [change, path, value] of changes) {
      const changed = validate({ ...binding, ...change });
      expect(changed).toHaveProperty("identity." + path, value);
      expect(changed).not.toHaveProperty("identity", result.identity);
    }
  });
  it("hashes canonical UTF-8 JSON with lexical keys, ordered arrays and JSON numbers", () => {
    const config = { z: { b: 2, a: 1 }, a: [-0, 1e-7, 1e21, null, true, "é😀\ud800"], "2": 2, "10": 10 };
    const candidate = { ...view, adapter: { ...view.adapter, config } };
    const result = validateBlockRoleBinding({ ...binding, viewBlockRef: candidate }, [frame, candidate]);
    expect(result).toHaveProperty("identity.viewBlockRef.configDigest", sha('{"10":10,"2":2,"a":[0,1e-7,1e+21,null,true,"é😀\\ud800"],"z":{"a":1,"b":2}}'));
    const reordered = { ...candidate, adapter: { ...candidate.adapter, config: { "10": 10, "2": 2, a: config.a, z: { a: 1, b: 2 } } } };
    expect(validateBlockRoleBinding({ ...binding, viewBlockRef: reordered }, [frame, candidate])).toEqual(result);
    const reversed = { ...candidate, adapter: { ...candidate.adapter, config: { ...config, a: [...config.a].reverse() } } };
    expect(validateBlockRoleBinding({ ...binding, viewBlockRef: reversed }, [frame, reversed])).toHaveProperty("identity.viewBlockRef.configDigest", sha('{"10":10,"2":2,"a":["é😀\\ud800",true,null,1e+21,1e-7,0],"z":{"a":1,"b":2}}'));
    for (const length of [0, 44, 45, 52, 53, 116, 117, 1000]) {
      const long = { ...view, adapter: { ...view.adapter, config: { text: (length === 1000 ? "😀" : "x").repeat(length) } } };
      expect(validateBlockRoleBinding({ ...binding, viewBlockRef: long }, [frame, long])).toHaveProperty("identity.viewBlockRef.configDigest", sha(JSON.stringify(long.adapter.config)));
    }
  });
  it("handles own data safely and returns independent snapshots", () => {
    let reads = 0;
    const accessor = { ...binding, get viewBlockRef() { reads++; throw new Error("no read"); } };
    const revoked = Proxy.revocable(binding, {}); revoked.revoke();
    for (const input of [accessor, revoked.proxy, Object.create(binding), { ...binding, context: Object.create(binding.context) }]) expect(validate(input).status).toBe("shape-error");
    expect(validate(new Proxy(binding, { get() { reads++; throw new Error("no get trap"); } })).status).toBe("unverified");
    expect(reads).toBe(0);
    const before = JSON.stringify(binding); const result = validate(binding);
    expect(JSON.stringify(binding)).toBe(before);
    if ("identity" in result && result.identity) { result.identity.context.brand = "changed"; expect(binding.context.brand).toBe("standard"); }
  });
  it("checks a generated real-entry near-miss corpus against a hand-pinned accepted set", () => {
    const corpus: [string, unknown][] = [["valid", binding]];
    for (const key of ["frameBlockRef", "viewBlockRef", "context"]) {
      const variants = [...key].map((_, i) => key.slice(0, i) + key.slice(i + 1));
      for (const edited of [...variants, key.toUpperCase(), key[0]!.toUpperCase() + key.slice(1), key + "s", key + "_", key + "-", key.replace("a", "а").replace("i", "і")]) {
        const input: Record<string, unknown> = { ...binding }; input[edited] = input[key]; delete input[key]; corpus.push([key + ":" + edited, input]);
      }
      for (const value of [null, true, 0, "frame", [], {}]) corpus.push([key + ":" + JSON.stringify(value), { ...binding, [key]: value }]);
    }
    for (const key of ["consumer", "brand", "medium"]) for (const value of [undefined, null, 1, true, [], {}, "", " web", "Web", "wеb"]) {
      if ((key === "consumer" || key === "brand") && typeof value === "string" && value.trim() === value && value.length) continue;
      corpus.push(["context." + key + ":" + JSON.stringify(value), { ...binding, context: { ...binding.context, [key]: value } }]);
    }
    corpus.push(["swapped", { ...binding, frameBlockRef: view, viewBlockRef: frame }]);
    expect(corpus.filter(([, value]) => { const r = validate(value); return r.status === "unverified" && r.reasons.every(reason => reason.code === "measurement-required"); }).map(([name]) => name)).toEqual(["valid"]);
    expect(corpus.every(([, value]) => validate(value).status !== "qualified")).toBe(true);
  });
  it("keeps the binding import graph free of DOM, React and network imports", () => {
    expect(checkImportPurity({ root: process.cwd(), entries: ["src/core/block-role-binding.ts"], allowedBuiltins: [], allowedPackages: [] }).findings).toEqual([]);
  });
});
