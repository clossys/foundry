// @vitest-environment node
import { describe, expect, it } from "vitest";
import adapter from "../catalog/adapters/shadcn@aria.json" with { type: "json" };
import themeSlots from "../catalog/slots/themes.json" with { type: "json" };
import { classRead, packageDeclaredFallbackReader } from "./declared-fallback-reader.js";
import { EMITTED_PROPERTIES, memberEmit, rewriteShadcnAria } from "./rewrite.js";

/** Every consumer property a themes member emits, read straight from `themes.json` `contract.emit`. */
const emits = new Map((themeSlots as unknown as readonly { id: string; contract: { emit?: Readonly<Record<string, string>> } }[])
  .flatMap(slot => Object.entries(slot.contract.emit ?? {}).map(([key, property]) => [`${slot.id}.${key}`, property] as const)));

const reader = packageDeclaredFallbackReader();
/** A derived (`shadcn-aria-rewrite@5`) rewrite of one class string. */
const derive = (classes: string) => rewriteShadcnAria({ item: "example", leaf: "button", files: [{ path: "example.tsx", content: `const value = "${classes}";` }],
  styles: "", leafByItem: { button: "button", input: "text-field" }, styleDefaults: true, reader });
const classes = (classes: string): string[] => derive(classes).files[0]!.content.match(/"([^"]*)"/)![1]!.split(/\s+/);

describe("shadcn-aria-rewrite@5 derivation", () => {
  it("binds every adapter name to a member only, never to a typed property", () => {
    for (const [name, binding] of Object.entries(adapter.bindings)) {
      expect(Object.keys(binding), `${name} binding keys`).toEqual(["member"]);
      expect(emits.has(binding.member), `${name} member ${binding.member} emits a consumer property`).toBe(true);
    }
    for (const group of [adapter.fontFamily, adapter.spacing] as { member: string; property?: string }[]) {
      expect(group.property, `${group.member} typed property`).toBeUndefined();
      expect(emits.has(group.member), `${group.member} emits`).toBe(true);
    }
    expect(adapter.bindings.input.member).toBe("themes.input.default");
    expect(adapter.transform).toBe("shadcn-aria-rewrite@5");
  });

  it("writes each bound name as exactly its member's emitted property", () => {
    expect([...EMITTED_PROPERTIES].sort()).toEqual([...new Set(emits.values())].sort());
    for (const [name, binding] of Object.entries(adapter.bindings)) {
      const emitted = emits.get(binding.member)!;
      expect(memberEmit(binding.member), `${name}: memberEmit(${binding.member})`).toBe(emitted);
      const atom = name === "radius" ? "rounded-lg" : `bg-${name}`;
      const result = derive(atom);
      expect(result.issues, `${name} issues`).toEqual([]);
      expect(result.transform).toBe("shadcn-aria-rewrite@5");
      expect(result.reads.themes, `${name} reads`).toContain(binding.member);
      const written = classes(atom)[0]!;
      expect(written, `${name} (${binding.member}) must read ${emitted}`).toBe(name === "radius" ? `rounded-(${emitted})` : `bg-(${emitted})`);
    }
  });

  it("reads spacing, control size and font family through the spacing and font-sans members", () => {
    const spacing = memberEmit(adapter.spacing.member), sans = memberEmit(adapter.fontFamily.member);
    expect([spacing, sans]).toEqual(["--spacing", "--font-sans"]);
    const result = derive("p-4 gap-2 size-4 h-8 font-sans");
    expect(result.issues).toEqual([]);
    expect(result.reads.themes).toEqual(expect.arrayContaining([adapter.spacing.member, adapter.fontFamily.member]));
    const step = (n: number) => `calc(${classRead(reader, spacing)}*${n})`;
    expect(classes("p-4 gap-2 size-4 h-8 font-sans")).toEqual([`p-[${step(4)}]`, `gap-[${step(2)}]`, `size-[${step(4)}]`, `h-[${step(8)}]`, `font-(family-name:${sans})`]);
    expect(classRead(reader, spacing)).toBe(`var(--spacing,${reader.fallback(spacing)})`);
  });

  it("refuses a member that emits no consumer property", () => {
    expect(() => memberEmit("themes.no-such.default")).toThrow("themes.no-such.default emits no consumer property");
  });
});
