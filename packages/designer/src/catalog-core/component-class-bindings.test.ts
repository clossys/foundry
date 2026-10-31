/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bindCompiledClasses } from "./component-class-bindings.js";

const tokens = {
  "themes.spacing.default": { property: "--spacing-sm", light: "8px" },
  "themes.radius.default": { property: "--radius-pill", light: "999px" },
  "themes.muted-foreground.default": { property: "--color-ink-secondary", light: "#555", dark: "#ccc" },
  "tokens.shared.a": { property: "--shared", light: "1px" },
  "tokens.shared.b": { property: "--shared", light: "1px" },
};

describe("bindCompiledClasses", () => {
  it("binds a plain class whose declarations all read one token property", () => {
    expect(bindCompiledClasses(`@layer x {\n  .px-sm {\n    padding-inline: var(--spacing-sm, 8px);\n  }\n  .rounded-pill { border-radius: var(--radius-pill, 999px); }\n  .text-ink-secondary { color: var(--color-ink-secondary, oklch(0.36 0 0)); }\n}`, tokens))
      .toEqual({ "px-sm": "themes.spacing.default", "rounded-pill": "themes.radius.default", "text-ink-secondary": "themes.muted-foreground.default" });
  });
  it("leaves literal, unknown, shared-property and mixed-member classes unbound", () => {
    expect(bindCompiledClasses(`.min-w-0 { min-width: 0; } .gap-x { gap: var(--unknown); } .border-s { border-width: var(--shared); } .p-mix { padding-inline: var(--spacing-sm); border-radius: var(--radius-pill); }`, tokens)).toEqual({});
  });
  it("binds a class whose declarations all read the same member", () => {
    expect(bindCompiledClasses(`.py-sm { padding-top: var(--spacing-sm); padding-bottom: var(--spacing-sm, 8px); }`, tokens)).toEqual({ "py-sm": "themes.spacing.default" });
  });
  it("ignores variant and compound selectors and refuses a class compiled with two meanings", () => {
    expect(bindCompiledClasses(`.hover\\:px-sm:hover { padding-inline: var(--spacing-sm); } .a .px-sm { padding-inline: var(--radius-pill); }`, tokens)).toEqual({});
    expect(bindCompiledClasses(`.px-sm { padding-inline: var(--spacing-sm); } .px-sm { padding-inline: var(--radius-pill); }`, tokens)).toEqual({});
  });
  it("binds Foundry's compiled named utilities to the token properties they read", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "styles", "compiled.css"), "utf8");
    const bindings = bindCompiledClasses(css, tokens);
    expect(bindings).toMatchObject({ "px-sm": "themes.spacing.default", "rounded-pill": "themes.radius.default", "text-ink-secondary": "themes.muted-foreground.default" });
    expect(Object.values(bindings).every(member => member in tokens)).toBe(true);
  });
});
