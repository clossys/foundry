import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONVENTION_ADAPTERS,
  CONVENTION_DOCUMENTS,
  adapterPath,
  documentPath,
  templatedFilenames,
} from "./documents.js";
import { renderProductLoader } from "./loader.js";
import { scanNeutrality } from "./neutrality.js";

describe("shipped defaults", () => {
  it("resolves every declared document to a readable file", () => {
    for (const document of CONVENTION_DOCUMENTS) {
      const contents = readFileSync(documentPath(document.id), "utf8");
      expect(contents.length, `${document.id} is empty`).toBeGreaterThan(0);
    }
  });

  it("resolves every declared adapter to a readable file", () => {
    for (const adapter of CONVENTION_ADAPTERS) {
      const contents = readFileSync(adapterPath(adapter.id), "utf8");
      expect(contents.length, `${adapter.id} is empty`).toBeGreaterThan(0);
    }
  });

  it("throws on an unknown id rather than returning a path that does not exist", () => {
    expect(() => documentPath("no-such-document")).toThrow(/Unknown convention document/);
    expect(() => adapterPath("no-such-adapter")).toThrow(/Unknown convention adapter/);
  });

  // This is the package's own publishing precondition, checked against the real
  // shipped bytes rather than against a claim in a manifest. It is the same
  // discipline the material itself asks for: check what is installed, never
  // what a manifest says is installed.
  it("ships only neutral documents", () => {
    for (const document of CONVENTION_DOCUMENTS) {
      const findings = scanNeutrality(readFileSync(documentPath(document.id), "utf8"));
      expect(findings.map((f) => f.message), `${document.filename}`).toEqual([]);
    }
  });

  it("ships only neutral adapters", () => {
    for (const adapter of CONVENTION_ADAPTERS) {
      const findings = scanNeutrality(readFileSync(adapterPath(adapter.id), "utf8"));
      expect(findings.map((f) => f.message), `${adapter.filename}`).toEqual([]);
    }
  });

  it("marks a file as templated exactly when it carries a token", () => {
    const all = [
      ...CONVENTION_DOCUMENTS.map((d) => ({ ...d, path: documentPath(d.id) })),
      ...CONVENTION_ADAPTERS.map((a) => ({ ...a, path: adapterPath(a.id) })),
    ];
    for (const entry of all) {
      const carriesToken = /\$\{[A-Z_]+\}/.test(readFileSync(entry.path, "utf8"));
      expect(entry.templated, `${entry.filename} templated flag`).toBe(carriesToken);
    }
  });

  it("lists every templated filename", () => {
    expect([...templatedFilenames()].sort()).toEqual(
      ["machine-guidance.md", "shell-integration.zsh"].sort(),
    );
  });

  it("ships multi-plane discovery and composition guidance without a singular workspace authority", () => {
    const guidance = readFileSync(documentPath("machine-guidance"), "utf8");
    const baseline = readFileSync(documentPath("machine-baseline"), "utf8");

    expect(guidance).toContain("account-owned workspace planes");
    expect(guidance).toContain("discovery order is not precedence");
    expect(guidance).not.toContain("canonical local workspace control plane");
    expect(guidance).not.toContain("The standards checkout");
    expect(baseline).toContain("account-owned workspace planes");
    expect(baseline).not.toContain("the private workspace control plane");
  });
});

describe("renderProductLoader", () => {
  it("points at the path the caller actually installed to", () => {
    const loader = renderProductLoader({ guidancePath: "../shared/guidance.txt" });
    expect(loader.startsWith("@../shared/guidance.txt\n")).toBe(true);
    expect(loader).toContain("# Product adapter");
  });

  it("uses the product name in the heading when given one", () => {
    expect(
      renderProductLoader({ guidancePath: "../shared/guidance.txt", productName: "Example" }),
    ).toContain("# Example adapter");
  });

  // The loader's only job is to point at something. Generating one that points
  // nowhere would produce a file that looks installed and does nothing.
  it("refuses to render without a guidance path", () => {
    expect(() => renderProductLoader({ guidancePath: "  " })).toThrow(/requires a guidancePath/);
  });
});
