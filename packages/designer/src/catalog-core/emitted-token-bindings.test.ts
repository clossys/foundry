/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import * as client from "./index.js";
import { componentIntegration } from "./__fixtures__/component-integration.js";
import { TOKENS } from "../tokens/tokens.js";
import { completedTokenLibrary } from "../importers/__fixtures__/completed-token-library.js";
import * as publicCatalog from "@clossys/designer/catalog";
import * as publicServer from "@clossys/designer/catalog/server";

const empty = (): client.LibraryData => ({ source: { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED" }, adoptedAt: "2026-10-25", fills: [] });
function selected(reads = ["themes.shadow.sm", "themes.tracking-tight.default"]) {
  const input = componentIntegration();
  input.catalog.components.fills[0]!.components.button!.reads.themes = reads;
  input.library = client.applyLibraryChange(input.catalog, input.library, { baseHash: client.libraryHash(input.library), changes: [
    { portion: "values", change: { op: "adopt", slot: "themes.shadow", source: "tailwind-default", members: ["sm"] } },
    { portion: "values", change: { op: "adopt", slot: "themes.tracking-tight", source: "tailwind-default" } },
    { portion: "components", change: { op: "adopt", slot: "components.button", source: "test-kit" } },
  ] });
  return input;
}
const shadowSm = "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)";
describe("selected emitted token bindings (SYNTHETIC component, real value catalog)", () => {
  it("public-entry/open-theme exposes the one canonical output map on client and server", () => {
    const profile = client.resolve(selected());
    expect(publicServer.emittedTokenProperties).toBe(publicCatalog.emittedTokenProperties);
    expect(publicServer.emittedTokenManifest).toBe(publicCatalog.emittedTokenManifest);
    const outputs = publicCatalog.emittedTokenProperties(profile.values);
    expect([...outputs]).toEqual([...client.emittedTokenProperties(profile.values)]);
    expect(outputs.get("themes.shadow.sm")).toEqual({ property: "--shadow-sm", theme: "--shadow-sm" });
    expect(outputs.get("themes.tracking-tight.default")).toEqual({ property: "--tracking-tight", theme: "--tracking-tight" });
    expect(outputs.has("themes.shadow.md")).toBe(false);
    const observed = { "themes.shadow.sm": { property: outputs.get("themes.shadow.sm")!.property, light: shadowSm }, "themes.tracking-tight.default": { property: outputs.get("themes.tracking-tight.default")!.property, light: "-0.025em" } };
    expect(publicCatalog.componentTokensHash(observed)).not.toBe(publicCatalog.componentTokensHash({}));
    expect(profile.values.members["themes.shadow.sm"]!.emit).toBe("--shadow-sm");
    const manifest = publicCatalog.emittedTokenManifest(profile.values, ["tailwind-theme"]);
    expect(manifest.tokens.find(row => row.id === "themes.shadow.sm")).toMatchObject({ outputs: ["--shadow-sm"], values: { light: shadowSm, dark: shadowSm } });
    expect(manifest.tokens.find(row => row.id === "themes.tracking-tight.default")).toMatchObject({ outputs: ["--tracking-tight"], values: { light: "-0.025em", dark: "-0.025em" } });
  });
  it("emits the owner-signed animation leaves into their Tailwind namespace", () => {
    const catalog = client.loadCatalog();
    const library = completedTokenLibrary(catalog, { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-26");
    const outputs = client.emittedTokenProperties(client.resolve({ catalog, library }));
    expect(outputs.get("themes.animate-marquee.default")).toEqual({ property: "--animate-marquee", theme: "--animate-marquee" });
    expect(outputs.get("themes.animate-marquee-vertical.default")).toEqual({ property: "--animate-marquee-vertical", theme: "--animate-marquee-vertical" });
    expect(outputs.get("themes.animate-shiny-text.default")).toEqual({ property: "--animate-shiny-text", theme: "--animate-shiny-text" });
  });
  it("checks the public full value catalog with an empty consumer without C4 errors", () => {
    expect(Object.keys(TOKENS)).toHaveLength(232);
    expect(client.check({ catalog: client.loadCatalog(), library: empty() }).findings.filter(f => f.code === "C4" && f.severity === "error")).toEqual([]);
  });
  it("shares actual selected theme outputs with component resolution, preserving the selected shadow and tracking values", () => {
    const profile = client.resolve(selected());
    const css = client.emit(profile.values, ["tailwind-theme"], { header: false })[0]!.contents;
    expect(css).toContain(`--shadow-sm: ${shadowSm};`);
    expect(css).toContain("--tracking-tight: -0.025em;");
    expect(profile.components.components["components.button"]!.reads.themes).toEqual({ "themes.shadow.sm": "--shadow-sm", "themes.tracking-tight.default": "--tracking-tight" });
    expect(profile.values.members["themes.shadow.sm"]!.emit).toBe("--shadow-sm");
    expect(profile.values.members["themes.tracking-tight.default"]!.emit).toBe("--tracking-tight");
    // Only the selected shadow member is emitted, never the rest of the candidate scale.
    expect(css).not.toContain("--shadow-md:");
    expect(css).not.toContain("--shadow-2xl:");
  });
  it("leaves catalog candidates and omitted selections unavailable to component reads and CSS", () => {
    const input = selected();
    input.library = client.applyLibraryChange(input.catalog, input.library, { baseHash: client.libraryHash(input.library), changes: [{ portion: "values", change: { op: "remove", slot: "themes.shadow" } }] });
    expect(() => client.resolve(input)).toThrow(/unresolved token themes.shadow.sm/);
    const values = client.resolve({ catalog: input.catalog.values, library: { ...input.library.values, source: input.library.source, adoptedAt: input.library.adoptedAt } });
    expect(client.emit(values, ["tailwind-theme"])[0]!.contents).not.toContain("--shadow-sm:");
    expect(() => client.resolve(selected(["themes.shadow.unknown"]))).toThrow(/unresolved token/);
  });
  it("keeps unknown, missing, and duplicate shipped bindings failing C4", () => {
    for (const fault of ["unknown", "missing", "duplicate"] as const) {
      const catalog = client.loadCatalog();
      const slot = catalog.slots.find(s => s.id === "themes.tracking-tight")!;
      if (slot.contract.kind !== "token") throw new Error("fixture contract");
      const emit = { ...slot.contract.emit };
      if (fault === "unknown") emit.widest = "--tracking-widest";
      if (fault === "missing") delete emit.default;
      if (fault === "duplicate") emit.other = emit.default!;
      slot.contract = { ...slot.contract, emit };
      expect(client.check({ catalog, library: empty() }).findings.some(f => f.code === "C4" && f.severity === "error"), fault).toBe(true);
    }
  });
  it("refuses a shipped binding colliding with another selected namespace output", () => {
    const input = selected();
    const slot = input.catalog.values.slots.find(s => s.id === "themes.shadow")!;
    if (slot.contract.kind !== "token") throw new Error("fixture contract");
    slot.contract = { ...slot.contract, emit: { ...slot.contract.emit, sm: "--tracking-tight" } };
    expect(() => client.resolve(input)).toThrow(/output.*colli|duplicate.*output/i);
  });
  it("refuses mismatched or unresolved selected aliases instead of using candidate or legacy values", () => {
    const input = selected();
    input.library = client.applyLibraryChange(input.catalog, input.library, { baseHash: client.libraryHash(input.library), changes: [{ portion: "values", change: { op: "author", slot: "themes.shadow", tokens: { sm: { $type: "shadow", $value: "{themes.shadow.missing}" } } } }] });
    expect(() => client.resolve(input)).toThrow(/unresolved token|alias/);
  });
});
