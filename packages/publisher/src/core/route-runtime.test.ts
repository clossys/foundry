import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runtimeHash } from "@clossys/designer/catalog";
import type { ConsumerRuntimeManifest } from "@clossys/designer/catalog";
import { compileRegisteredRouteFixture, syntheticRegisteredRoute, type CompiledRegisteredRoute } from "../web/__fixtures__/registered-route-runtime.js";
import { resolveSelectedRouteRuntimeBinding } from "./route-runtime.js";

/** SYNTHETIC verified-descriptor members, in the order a compiled app-shell fill declares them. */
const DESCRIPTOR = ["layout.immersive", "layout.standard", "stage.contained", "stage.full", "theme.dark", "theme.light", "theme.system"];
let temporary: string, compiled: CompiledRegisteredRoute;
beforeAll(async () => {
  temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "SYNTHETIC-route-runtime-")));
  compiled = await compileRegisteredRouteFixture(temporary);
}, 60000);
afterAll(async () => { await fs.rm(temporary, { recursive: true, force: true }); });

function project(frame: Record<string, unknown> = {}, descriptor: readonly string[] = DESCRIPTOR, descriptorConfig: string | null = null) {
  const { route, engine, manifest } = syntheticRegisteredRoute(compiled);
  Object.assign(route.composition.binding.frame, frame);
  const verified: ConsumerRuntimeManifest = { ...manifest, fills: manifest.fills.map(fill => fill.kind === "frame" ? { ...fill, config: descriptorConfig, members: [...descriptor] } : fill) };
  const before = runtimeHash(verified);
  const result = resolveSelectedRouteRuntimeBinding(route.composition.binding, engine, verified);
  // The selection narrows a projection; it never rewrites the verified descriptor.
  expect(runtimeHash(verified)).toBe(before);
  return { result, descriptor: verified.fills.find(fill => fill.kind === "frame")! };
}

describe("route runtime frame member selection", () => {
  it("projects only the selected members, in verified descriptor order", () => {
    const { result } = project({ members: { theme: "system", layout: "standard", stage: "full" } });
    expect(result.status, JSON.stringify(result)).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.binding.frame.members).toEqual(["layout.standard", "stage.full", "theme.system"]);
  });
  it("narrows only the axes a partial selection names; every other axis projects as it does without one", () => {
    const { result } = project({ members: { layout: "standard" } });
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.binding.frame.members).toEqual(["layout.standard", "stage.contained", "stage.full", "theme.dark", "theme.light", "theme.system"]);
  });
  it("keeps the frame config's member when a partial selection omits its axis (reviewer repro)", () => {
    const descriptor = ["layout.immersive", "theme.system"];
    const { result } = project({ config: "layout.immersive", members: { theme: "system" } }, descriptor, "layout.immersive");
    expect(result.status, JSON.stringify(result)).toBe("resolved");
    if (result.status === "resolved") expect(result.binding.frame.members).toEqual(["layout.immersive", "theme.system"]);
  });
  it("narrows an omitted config axis to the config member, never to another member on that axis", () => {
    const { result } = project({ config: "layout.immersive", members: { theme: "system" } }, DESCRIPTOR, "layout.immersive");
    expect(result.status, JSON.stringify(result)).toBe("resolved");
    if (result.status === "resolved") expect(result.binding.frame.members).toEqual(["layout.immersive", "stage.contained", "stage.full", "theme.system"]);
    const standard = project({ config: "layout.standard", members: { stage: "full", theme: "system" } }, DESCRIPTOR, "layout.standard").result;
    expect(standard.status === "resolved" && standard.binding.frame.members).toEqual(["layout.standard", "stage.full", "theme.system"]);
  });
  it.each([
    ["an unknown axis", { density: "compact" }],
    ["an unknown member on a known axis", { layout: "floating" }],
    ["a non-string choice", { layout: 1 }],
    ["an axis that addresses a member", { "layout.standard": "standard" }],
    ["an empty selection", {}],
  ])("refuses %s without projecting any member", (_, members) => {
    expect(project({ members }).result).toEqual({ status: "refused", findings: ["frame: frame member selection is not one verified descriptor member per axis"] });
  });
  it("refuses a member the verified descriptor does not contain", () => {
    const descriptor = DESCRIPTOR.filter(member => member !== "theme.system");
    expect(project({ members: { theme: "system" } }, descriptor).result.status).toBe("refused");
    expect(project({ members: { theme: "light" } }, descriptor).result.status).toBe("resolved");
  });
  it("refuses a choice that conflicts with the member the frame config selects", () => {
    expect(project({ config: "layout.immersive", members: { layout: "standard" } }, DESCRIPTOR, "layout.immersive").result.status).toBe("refused");
    expect(project({ config: "layout.immersive", members: { layout: "immersive", theme: "system" } }, DESCRIPTOR, "layout.immersive").result.status).toBe("resolved");
  });
  it("keeps the projection byte-identical when no selection is present", () => {
    const { result, descriptor } = project();
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(JSON.stringify(result.binding.frame)).toBe(JSON.stringify({ leaf: descriptor.leaf, fill: descriptor.fill, config: null, members: DESCRIPTOR, content: {} }));
  });
});
