import { describe, expect, it } from "vitest";
import { loadCatalog, loadFoundrySurfaceHistory, resolveSurfacePackageDescriptor, type SurfacePackageEntry } from "../catalog-core/index.js";
import { surfaceEntryOf, surfacePackageDescriptorHash } from "../catalog-core/surface-library.js";
import type { CompositeCatalogData } from "../catalog-core/types.js";
import { foundrySurfaceCatalog } from "../library-cli/surface-catalog.js";

// Exact public descriptor and contract from source 8a2b880693642689ac23eb02ae53659625f67551.
const hash = "sha256:e891cbf660bfd5461f23cbacd162bab907869c9883f1090a40e89b1d002ec6f6";
const identity = { source: "foundry", fill: "foundry/sections.hero", license: "MIT", descriptorHash: hash, pin: { package: "@clossys/designer", version: "0.12.0", export: "./blocks#Hero" } };
const historical = [
  ["frames.app-shell", "sha256:6e1d05c03a31919afbd1a644c8f6521672090321ba730195dc2fd7c85721270a"], // 1988bfd3d2f19cbbd53185a5b014fe074938464a
  ["sections.content", "sha256:ee0513e37e4e2e0a2fa5530a6bc24eedb959cf06da0eaad22528160cd33aaf02"],
  ["sections.empty-state", "sha256:3c920636372ee73fd262f1e75931d936ea4209075a87bc0ebbe25d58bac300b6"],
  ["sections.section-header", "sha256:ac0351dbd01506c7a97282a49e915189f2e6d54d0cfb9cbe12d78d35fa192054"], // Sections: 8bd1db89f8f2d0a195e0e87412dec4bb2d7f9075
  ["sections.hero", hash],
] as const;
function catalog(): CompositeCatalogData {
  return { values: loadCatalog(), components: { slots: [], fills: [] }, surfaces: { ...foundrySurfaceCatalog(), packageHistory: structuredClone(loadFoundrySurfaceHistory()) } };
}

describe("authentic Foundry package history", () => {
  it.each(historical)("resolves the genuine prior %s descriptor and contract", (slot, descriptorHash) => {
    const data = catalog();
    const row = loadFoundrySurfaceHistory()[descriptorHash]![0]!;
    const meta = row.document.$extensions["com.clossys.fill"];
    const resolved = resolveSurfacePackageDescriptor(data, slot, { source: meta.source, fill: meta.id, license: meta.license, pin: meta.pin!, descriptorHash });
    expect(surfacePackageDescriptorHash(surfaceEntryOf(resolved.document) as SurfacePackageEntry)).toBe(descriptorHash);
    expect(resolved.contract.id).toBe(slot);
  });
  it("retains the exact prior Hero body, contract and source identity", () => {
    const data = catalog();
    const registration = resolveSurfacePackageDescriptor(data, "sections.hero", identity);
    expect(surfacePackageDescriptorHash(surfaceEntryOf(registration.document) as SurfacePackageEntry)).toBe(hash);
    expect(registration.contract.id).toBe("sections.hero");
    expect(registration.document.$extensions["com.clossys.fill"].pin).toEqual(identity.pin);
    expect(registration.document.sections!.hero!.consumption!.sourceFiles).toContainEqual({ path: "packages/designer/src/blocks/Hero.tsx", sha256: "63d56433e2c187ccf1ce7995d6506e118ef72c634f3e62e31cfedd8fac04d210" });
  });

  it.each(["missing", "duplicate", "wrong-pin", "changed-body"] as const)("still rejects %s historical registration", mutation => {
    const data = catalog();
    const history = structuredClone(loadFoundrySurfaceHistory()) as Record<string, Array<ReturnType<typeof resolveSurfacePackageDescriptor>>>;
    data.surfaces!.packageHistory = history;
    if (mutation === "missing") delete history[hash];
    if (mutation === "duplicate") history[hash]!.push(structuredClone(history[hash]![0]!));
    if (mutation === "wrong-pin") history[hash]![0]!.document.$extensions["com.clossys.fill"].pin!.version = "0.11.0";
    if (mutation === "changed-body") history[hash]![0]!.document.sections!.hero!.notes = ["Changed historical body"];
    expect(() => resolveSurfacePackageDescriptor(data, "sections.hero", identity)).toThrow(/S2/);
  });
});
