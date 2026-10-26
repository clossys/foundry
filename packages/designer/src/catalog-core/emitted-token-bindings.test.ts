/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import * as client from "./index.js";
import { componentIntegration } from "./__fixtures__/component-integration.js";
import { TOKENS } from "../tokens/tokens.js";
import * as publicCatalog from "@clossys/designer/catalog";
import * as publicServer from "@clossys/designer/catalog/server";

const empty = (): client.LibraryData => ({ source: { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED" }, adoptedAt: "2026-10-25", fills: [] });
function selected(reads = ["tokens.line-height.snug", "tokens.letter-spacing.widest"]) {
  const input = componentIntegration();
  input.catalog.components.fills[0]!.components.button!.reads.tokens = reads;
  input.library = client.applyLibraryChange(input.catalog, input.library, { baseHash: client.libraryHash(input.library), changes: [
    { portion: "values", change: { op: "adopt", slot: "tokens.line-height", source: "tailwind-default", members: ["snug"] } },
    { portion: "values", change: { op: "adopt", slot: "tokens.letter-spacing", source: "tailwind-default", members: ["widest"] } },
    { portion: "components", change: { op: "adopt", slot: "components.button", source: "test-kit" } },
  ] });
  return input;
}
describe("selected emitted token bindings (SYNTHETIC component, real value catalog)", () => {
  it("public-entry/open-theme exposes the one canonical output map on client and server", () => {
    const profile = client.resolve(selected());
    expect(publicServer.emittedTokenProperties).toBe(publicCatalog.emittedTokenProperties);
    expect(publicServer.emittedTokenManifest).toBe(publicCatalog.emittedTokenManifest);
    const outputs = publicCatalog.emittedTokenProperties(profile.values);
    expect([...outputs]).toEqual([...client.emittedTokenProperties(profile.values)]);
    expect(outputs.get("tokens.line-height.snug")).toEqual({ property: "--leading-snug", theme: "--leading-snug" });
    expect(outputs.get("tokens.letter-spacing.widest")).toEqual({ property: "--tracking-widest", theme: "--tracking-widest" });
    const observed = { "tokens.line-height.snug": { property: outputs.get("tokens.line-height.snug")!.property, light: "1.375" }, "tokens.letter-spacing.widest": { property: outputs.get("tokens.letter-spacing.widest")!.property, light: "0.1em" } };
    expect(publicCatalog.componentTokensHash(observed)).not.toBe(publicCatalog.componentTokensHash({}));
    expect(profile.values.members["tokens.line-height.snug"]!.emit).toBeUndefined();
    const manifest = publicCatalog.emittedTokenManifest(profile.values, ["tailwind-theme"]);
    expect(manifest.tokens.find(row => row.id === "tokens.line-height.snug")).toMatchObject({ outputs: ["--leading-snug"], values: { light: "1.375", dark: "1.375" } });
    expect(manifest.tokens.find(row => row.id === "tokens.letter-spacing.widest")).toMatchObject({ outputs: ["--tracking-widest"], values: { light: "0.1em", dark: "0.1em" } });
  });
  it("checks the public full value catalog with an empty consumer without C4 errors", () => {
    expect(Object.keys(TOKENS)).toHaveLength(227);
    expect(client.check({ catalog: client.loadCatalog(), library: empty() }).findings.filter(f => f.code === "C4" && f.severity === "error")).toEqual([]);
  });
  it("shares actual selected theme outputs with component resolution, preserving 1.375 and 0.1em", () => {
    const profile = client.resolve(selected());
    const css = client.emit(profile.values, ["tailwind-theme"], { header: false })[0]!.contents;
    expect(css).toContain("--leading-snug: 1.375;");
    expect(css).toContain("--tracking-widest: 0.1em;");
    expect(profile.components.components["components.button"]!.reads.tokens).toEqual({ "tokens.line-height.snug": "--leading-snug", "tokens.letter-spacing.widest": "--tracking-widest" });
    expect(profile.values.members["tokens.line-height.snug"]!.emit).toBeUndefined();
    expect(profile.values.members["tokens.letter-spacing.widest"]!.emit).toBeUndefined();
    expect(css).not.toContain("--leading-snug: 1.15");
    expect(css).not.toContain("--tracking-widest: 0.18");
  });
  it("leaves catalog candidates and omitted selections unavailable to component reads and CSS", () => {
    const input = selected();
    input.library = client.applyLibraryChange(input.catalog, input.library, { baseHash: client.libraryHash(input.library), changes: [{ portion: "values", change: { op: "remove", slot: "tokens.line-height" } }] });
    expect(() => client.resolve(input)).toThrow(/unresolved token tokens.line-height.snug/);
    const values = client.resolve({ catalog: input.catalog.values, library: { ...input.library.values, source: input.library.source, adoptedAt: input.library.adoptedAt } });
    expect(client.emit(values, ["tailwind-theme"])[0]!.contents).not.toContain("--leading-snug:");
    expect(() => client.resolve(selected(["tokens.line-height.unknown"]))).toThrow(/unresolved token/);
  });
  it("keeps unknown, missing, and duplicate shipped bindings failing C4", () => {
    for (const fault of ["unknown", "missing", "duplicate"] as const) {
      const catalog = client.loadCatalog();
      const slot = catalog.slots.find(s => s.id === "tokens.letter-spacing")!;
      if (slot.contract.kind !== "token") throw new Error("fixture contract");
      const emit = { ...slot.contract.emit };
      if (fault === "unknown") emit.widest = "--tracking-widest";
      if (fault === "missing") delete emit.label;
      if (fault === "duplicate") emit.other = emit.label!;
      slot.contract = { ...slot.contract, emit };
      expect(client.check({ catalog, library: empty() }).findings.some(f => f.code === "C4" && f.severity === "error"), fault).toBe(true);
    }
  });
  it("refuses flattened duplicate theme output rather than silently choosing an alias", () => {
    const input = selected();
    input.library = client.applyLibraryChange(input.catalog, input.library, { baseHash: client.libraryHash(input.library), changes: [{ portion: "values", change: { op: "author", slot: "tokens.line-height", tokens: { "a-b": { $type: "number", $value: 1 }, "a.b": { $type: "number", $value: 2 } } } }] });
    expect(() => client.resolve(input)).toThrow(/output.*colli|duplicate.*output/i);
    const values = client.resolve({ catalog: input.catalog.values, library: { ...input.library.values, source: input.library.source, adoptedAt: input.library.adoptedAt } });
    expect(() => client.emit(values, ["tailwind-theme"])).toThrow(/output.*colli|duplicate.*output/i);
  });
  it("refuses a shipped binding colliding with another selected namespace output", () => {
    const input = selected();
    const slot = input.catalog.values.slots.find(s => s.id === "tokens.line-height")!;
    if (slot.contract.kind !== "token") throw new Error("fixture contract");
    slot.contract = { ...slot.contract, emit: { ...slot.contract.emit, snug: "--tracking-tight" } };
    input.library = client.applyLibraryChange(input.catalog, input.library, { baseHash: client.libraryHash(input.library), changes: [{ portion: "values", change: { op: "adopt", slot: "tokens.letter-spacing", source: "tailwind-default", members: ["tight"] } }] });
    expect(() => client.resolve(input)).toThrow(/output.*colli|duplicate.*output/i);
  });
  it("refuses mismatched or unresolved selected aliases instead of using candidate or legacy values", () => {
    const input = selected();
    input.library = client.applyLibraryChange(input.catalog, input.library, { baseHash: client.libraryHash(input.library), changes: [{ portion: "values", change: { op: "author", slot: "tokens.line-height", tokens: { snug: { $type: "number", $value: "{tokens.line-height.missing}" } } } }] });
    expect(() => client.resolve(input)).toThrow(/unresolved token|alias/);
  });
});
