import { beforeAll, describe, expect, it } from "vitest";
import * as core from "./index.js";
import type { BlockRoleDescriptor, BlockRoleAdapterContract } from "./block-role.js";
import { checkImportPurity } from "../../../../scripts/lib/import-purity.mjs";

const { validateBlockRole } = core;
beforeAll(() => expect(validateBlockRole, "Publisher/core must export validateBlockRole").toBeTypeOf("function"));

const frame: BlockRoleDescriptor = {
  blockId: "site", role: "frame", medium: "web",
  adapter: { owner: "@clossys/publisher", subpath: "web", export: "SiteFrame", config: {} },
  regions: [{ key: "main", required: true, childRoles: ["view"], content: ["document"] }],
  content: ["document"], runtime: ["server"], lifecycle: { requires: [], provides: ["skip-focus"] },
  layout: "flow", web: { main: "sole", skipTarget: "main" },
  evidence: { sourceRevision: "a".repeat(40), measuredAt: "2026-10-17" },
};
const view: BlockRoleDescriptor = {
  ...frame, role: "view",
  adapter: { ...frame.adapter, export: "LandingView", config: { landmark: "none", example: { enabled: true, order: [1, 2] } } },
  regions: [{ key: "body", required: true, childRoles: [], content: ["document"] }],
  lifecycle: { requires: [], provides: [] }, web: { main: "none" },
};
const known: readonly BlockRoleAdapterContract[] = [frame, view];
const validate = (value: unknown) => validateBlockRole(value, known);
const status = (value: unknown) => validate(value).status;
const reason = (value: unknown) => { const result = validate(value); return result.status === "shape-error" ? result.path : result.reasons[0]; };

describe("Block role descriptor contract", () => {
  it("validates both roles without manufacturing measured qualification", () => {
    expect(validate(frame)).toEqual({ status: "unverified", reasons: ["measurement-required"], descriptor: frame });
    expect(reason(view)).toBe("measurement-required");
    expect(reason({ ...frame, role: undefined })).toBe("role");
    expect(reason({ role: "frame", qualified: true })).toBe("role-claim");
    expect(reason({ ...frame, qualified: true })).toBe("measurement-required");
    expect(status({ ...frame, qualified: true })).toBe("unverified");
    expect(reason({ ...view, adapter: { ...view.adapter, config: { example: { order: [1, 2], enabled: true }, landmark: "none" } } })).toBe("measurement-required");
  });
  it("keeps bare boolean, exact role strings and role-only declarations unverified without a descriptor", () => {
    for (const claim of [true, false, "frame", "view", { role: "frame" }, { role: "view", qualified: true }]) {
      const result = validate(claim);
      expect(result).toEqual({ status: "unverified", reasons: ["role-claim"], claim });
      expect(result).not.toHaveProperty("descriptor");
    }
    expect(status("Frame")).toBe("shape-error");
  });
  it("refuses unknown adapters and configurations without treating either as shape errors", () => {
    expect(reason({ ...frame, adapter: { ...frame.adapter, export: "Unknown" } })).toBe("unknown-adapter");
    expect(reason({ ...frame, adapter: { ...frame.adapter, config: { framed: true } } })).toBe("adapter-config");
    expect(status({ ...frame, adapter: { ...frame.adapter, export: "Unknown" } })).toBe("unverified");
    for (const field of [{ owner: "bad/owner" }, { subpath: "../web" }, { export: "Site-Frame" }]) {
      expect(reason({ ...frame, adapter: { ...frame.adapter, ...field } })).toBe("adapter");
    }
  });
  it("requires dated exact source evidence, never an inherited or undated claim", () => {
    for (const evidence of [undefined, {}, { sourceRevision: "main", measuredAt: "2026-10-17" }, { ...frame.evidence, measuredAt: "2026-02-29" }, { ...frame.evidence, measuredAt: "2026-04-31" }, Object.create(frame.evidence)]) {
      expect(reason({ ...frame, evidence })).toBe("evidence");
    }
    expect(reason({ ...frame, evidence: { ...frame.evidence, measuredAt: "2024-02-29" } })).toBe("measurement-required");
  });
  it("distinguishes role-medium incompatibility and unsupported video from invalid shape", () => {
    expect(reason({ ...frame, medium: "print" })).toBe("role-medium");
    expect(status({ ...frame, medium: "print" })).toBe("unsupported");
    expect(reason({ ...frame, medium: "video", layout: "sequence", web: undefined })).toBe("video-unsupported");
    expect(reason({ ...frame, medium: "document" })).toBe("medium");
    expect(status(null)).toBe("shape-error");
  });
  it("refuses duplicate, absent and incompatible region, child, content and lifecycle obligations", () => {
    expect(reason({ ...frame, regions: [...frame.regions, ...frame.regions] })).toBe("regions");
    expect(reason({ ...frame, regions: [] })).toBe("regions");
    const optional = { ...frame, regions: [...frame.regions, { key: "aside", childRoles: [], content: [] }] };
    expect(validateBlockRole(optional, [optional])).toMatchObject({ reasons: ["measurement-required"] });
    expect(validateBlockRole(frame, [optional])).toMatchObject({ reasons: ["regions"] });
    expect(reason({ ...frame, regions: [{ ...frame.regions[0]!, key: "other" }] })).toBe("regions");
    expect(reason({ ...frame, regions: [{ ...frame.regions[0]!, required: false }] })).toBe("regions");
    expect(reason({ ...frame, regions: [{ ...frame.regions[0]!, childRoles: ["frame"] }] })).toBe("child-content");
    expect(reason({ ...frame, regions: [{ ...frame.regions[0]!, content: ["image"] }] })).toBe("child-content");
    expect(reason({ ...frame, content: ["image"] })).toBe("child-content");
    expect(reason({ ...frame, lifecycle: { requires: ["mounted"], provides: [] } })).toBe("lifecycle");
    expect(reason({ ...frame, runtime: ["browser"] })).toBe("lifecycle");
  });
  it("requires the web frame's sole main and skip target, and a main-free web view", () => {
    for (const web of [undefined, { main: "none" }, { main: "sole" }, { main: "sole", skipTarget: "absent" }]) expect(reason({ ...frame, web })).toBe("web-landmarks");
    expect(reason({ ...view, web: { main: "sole", skipTarget: "body" } })).toBe("web-landmarks");
    expect(reason({ ...view, web: { main: "none", skipTarget: "body" } })).toBe("web-landmarks");
    const dual = { ...frame, regions: [...frame.regions, { ...frame.regions[0]!, key: "other" }] };
    expect(validateBlockRole(dual, [dual])).toMatchObject({ reasons: ["measurement-required"] });
    expect(validateBlockRole({ ...dual, regions: [...dual.regions].reverse() }, [dual])).toMatchObject({ reasons: ["measurement-required"] });
    expect(validateBlockRole({ ...dual, web: { main: "sole", skipTarget: "other" } }, [dual])).toMatchObject({ reasons: ["web-landmarks"] });
  });
  it("uses non-web geometry and flow obligations without claiming HTML or video support", () => {
    for (const [medium, layout] of [["email", "flow"], ["print", "flow"], ["slides", "sequence"], ["image", "geometry"]] as const) {
      const descriptor: BlockRoleDescriptor = { ...frame, medium, layout, web: undefined };
      expect(validateBlockRole(descriptor, [descriptor]).status).toBe("unverified");
      expect(validateBlockRole({ ...descriptor, layout: layout === "flow" ? "geometry" : "flow" }, [descriptor])).toMatchObject({ reasons: ["layout"] });
      expect(validateBlockRole({ ...descriptor, web: frame.web }, [descriptor])).toMatchObject({ reasons: ["web-landmarks"] });
    }
  });
  it("checks a generated near-miss corpus through the real entry with a hand-pinned accepted set", () => {
    const corpus: [string, unknown][] = [["valid-frame", frame], ["valid-view", view]];
    for (const value of ["frame", "view"]) {
      const edits = [...value].map((_, i) => value.slice(0, i) + value.slice(i + 1));
      for (const edit of [...edits, value.toUpperCase(), value[0]!.toUpperCase() + value.slice(1), value + "s", value + "_", value + "-", " " + value, value.replace("a", "а").replace("i", "і")]) corpus.push([`role:${edit}`, { ...frame, role: edit }]);
    }
    for (const field of ["blockId", "role", "medium", "adapter", "regions", "content", "runtime", "lifecycle", "layout", "web", "evidence"]) {
      for (const value of [undefined, null, true, 0, "", [], {}]) corpus.push([`${field}:${JSON.stringify(value)}`, { ...frame, [field]: value }]);
    }
    for (const medium of ["Web", "WEB", "wеb", "web "]) corpus.push([`medium:${medium}`, { ...frame, medium }]);
    for (const value of [true, "frame", [], null, Object.create(frame)]) corpus.push([`container:${String(value)}`, value]);
    expect(corpus.filter(([, value]) => reason(value) === "measurement-required").map(([name]) => name)).toEqual(["valid-frame", "valid-view"]);
    expect(corpus.every(([, value]) => status(value) !== "qualified")).toBe(true);
  });
  it("rejects non-JSON configs and accessors without executing them or changing caller data", () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    const getter = { get sourceRevision() { throw new Error("must not evaluate"); }, measuredAt: "2026-10-17" };
    for (const config of [cyclic, { value: undefined }, { value: Infinity }, { value: () => 1 }, { value: new Array(1) }, new Array(1)]) expect(reason({ ...frame, adapter: { ...frame.adapter, config } })).toBe("adapter");
    expect(reason({ ...frame, evidence: getter })).toBe("evidence");
    const before = JSON.stringify([frame, view, known]); validate(frame); validate(view);
    expect(JSON.stringify([frame, view, known])).toBe(before);
  });
  it.each(["evidence", "role", "blockId"] as const)("requires own %s instead of prototype evidence", (field) => {
    const input: Record<string, unknown> = { ...frame }; delete input[field];
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, field);
    let result;
    try {
      Object.defineProperty(Object.prototype, field, { value: frame[field], configurable: true });
      result = validate(input);
    } finally {
      if (previous) Object.defineProperty(Object.prototype, field, previous); else Reflect.deleteProperty(Object.prototype, field);
    }
    expect(result).toMatchObject({ status: "shape-error", path: field });
  });
  it("refuses deep and cyclic configuration without throwing", () => {
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 10000; i++) deep = { child: deep };
    const cyclic: Record<string, unknown> = {}; cyclic.child = cyclic;
    for (const config of [deep, cyclic]) expect(validate({ ...frame, adapter: { ...frame.adapter, config } })).toMatchObject({ status: "shape-error", path: "adapter" });
  });
  it("can revalidate its own data snapshots", () => {
    const result = validate(frame);
    expect(result.status).toBe("unverified");
    if ("descriptor" in result) expect(validate(result.descriptor)).toEqual(result);
  });
  it("handles throwing and revoked proxies without property get traps", () => {
    const revoked = Proxy.revocable(frame, {}); revoked.revoke();
    for (const input of [revoked.proxy, new Proxy(frame, { getPrototypeOf() { throw revoked.proxy; } }), new Proxy(frame, { getPrototypeOf() { throw new Error("prototype trap"); } }), new Proxy(frame, { ownKeys() { throw new Error("keys trap"); } })]) expect(status(input)).toBe("shape-error");
    let reads = 0;
    const proxy = new Proxy(frame, { get() { reads++; throw new Error("get trap"); } });
    expect(reason(proxy)).toBe("measurement-required");
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, "qualified");
    let result;
    try {
      Object.defineProperty(Object.prototype, "qualified", { get() { reads++; throw new Error("inherited getter"); }, configurable: true });
      result = validate({ role: "frame" });
    } finally {
      if (previous) Object.defineProperty(Object.prototype, "qualified", previous); else Reflect.deleteProperty(Object.prototype, "qualified");
    }
    expect(result).toMatchObject({ status: "unverified", reasons: ["role-claim"] });
    expect(reads).toBe(0);
  });
  it("keeps the descriptor import graph free of DOM, React, network and ambient effects", () => {
    expect(checkImportPurity({ root: process.cwd(), entries: ["src/core/block-role.ts"], allowedBuiltins: [], allowedPackages: [] }).findings).toEqual([]);
  });
});
