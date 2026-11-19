import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSectionProps, sectionPropsModule } from "./generate.js";
import { liveSections } from "./sources.js";

const here = dirname(fileURLToPath(import.meta.url));
const committed = () => new Map(readdirSync(here).filter(name => name === "index.ts" || (name.startsWith("sections.") && name.endsWith(".ts"))).map(name => [name, readFileSync(join(here, name), "utf8")]));

describe("generated section props types", () => {
  it("commits exactly the generator output, one module per live section plus the index", () => {
    const expected = generateSectionProps(liveSections());
    // foundry-build-0048 U28: the five admin record sections (build-0048) are live, so their modules are generated too.
    expect(liveSections()).toHaveLength(50);
    expect([...committed().keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [name, text] of expected) expect(committed().get(name), name).toBe(text);
  });

  it("types the hero copy from its contract fields", () => {
    const hero = readFileSync(join(here, "sections.hero.ts"), "utf8");
    expect(hero).toContain("export interface HeroProps {");
    expect(hero).toMatch(/header: \{\n\s+heading: string; \/\/ heading/);
    expect(hero).toContain('layout?: "editorial" | "split" | "full-bleed";');
  });

  it("mutation: a contract change makes the committed module stale", () => {
    const hero = structuredClone(liveSections().find(section => section.id === "sections.hero")!);
    (hero.contract.copy!.fields as { key: string; required: boolean }[]).push({ key: "header.kicker", required: true });
    expect(sectionPropsModule(hero)).not.toBe(committed().get("sections.hero.ts"));
  });

  it("leaves retired sections out", () => {
    expect(committed().has("sections.logo-hero.ts")).toBe(false);
    expect(committed().has("sections.specimen-swatch.ts")).toBe(false);
  });
});
