// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { importShadcnAriaComponents, SHADCN_COMPONENT_ITEMS } from "./shadcn-aria-components.js";
import { rewriteShadcnAria } from "./rewrite.js";
import { generateCompiledCss } from "../compiled-css/generate.js";
import type { ShadcnComponentInput } from "./shadcn-aria-components.js";
import { dialogExecutableSource } from "./dialog-executable-profile.js";
import { menuExecutableSource } from "./menu-executable-profile.js";

/** Parse generated CSS rule boundaries, retaining nested selector/media conditions. */
function timingRules(css: string): { chain: string[]; declarations: string }[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: { chain: string[]; declarations: string }[] = [];
  const endOfBlock = (start: number): number => {
    let depth = 1, quote = "";
    for (let i = start; i < clean.length; i++) {
      const c = clean[i]!;
      if (c === "\\") { i++; continue; }
      if (quote) { if (c === quote) quote = ""; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === "{") depth++;
      if (c === "}") { depth--; if (depth === 0) return i; }
    }
    throw new Error("Unbalanced generated CSS");
  };
  const visit = (start: number, end: number, chain: string[]): void => {
    let statement = start, declarations = "", quote = "";
    for (let i = start; i < end; i++) {
      const c = clean[i]!;
      if (c === "\\") { i++; continue; }
      if (quote) { if (c === quote) quote = ""; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === ";") { declarations += clean.slice(statement, i + 1); statement = i + 1; }
      if (c === "{") {
        const close = endOfBlock(i + 1);
        visit(i + 1, close, [...chain, clean.slice(statement, i).trim()]);
        i = close; statement = close + 1;
      }
    }
    if (chain.length) rules.push({ chain, declarations: declarations.replace(/\s+/g, " ") });
  };
  visit(0, clean.length, []);
  return rules;
}
function expectExplicitTiming(css: string, candidates: readonly string[], duration: string, easing: string): void {
  const rules = timingRules(css);
  for (const [family, member, override, property] of [["duration", duration, "--tw-duration", "transition-duration"], ["ease", easing, "--tw-ease", "transition-timing-function"]]) {
    const classes = candidates.filter(candidate => new RegExp(`(?:^|:)${family}-\\(`).test(candidate));
    expect(classes).toHaveLength(1);
    for (const candidate of classes) {
      const selector = "." + candidate.replace(/[^a-zA-Z0-9_-]/g, character => "\\" + character) + (candidate.startsWith("hover:") ? ":hover" : "");
      const matching = rules.filter(rule => rule.chain.includes(selector));
      expect(matching.length, candidate).toBeGreaterThan(0);
      const binding = matching.filter(rule => rule.declarations.includes(`${override}:`));
      expect(binding, candidate).toHaveLength(1);
      expect(binding[0]!.declarations).toContain(`${override}: var(${member});`);
      expect(binding[0]!.declarations).toContain(`${property}: var(${member});`);
      if (candidate.startsWith("hover:")) {
        expect(binding[0]!.chain).toContain(selector);
        expect(binding[0]!.chain.some(part => /^@media\s*\(hover:\s*hover\)$/.test(part))).toBe(true);
      } else expect(binding[0]!.chain.some(part => /(?<!\\):hover$/.test(part))).toBe(false);
      for (const rule of matching) {
        expect(rule.declarations).not.toContain("var(--ui-duration-default)");
        expect(rule.declarations).not.toContain("var(--ease-default)");
      }
    }
  }
}

function pinnedInput(): ShadcnComponentInput {
  const here = resolve(import.meta.dirname, "__fixtures__/shadcn-aria");
  const read = (name: string) => readFileSync(resolve(here, name), "utf8");
  return { items: readdirSync(here).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"),
    styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") }, notice: { path: "LICENSE.md", content: read("LICENSE.md") } };
}

const rewrite = (content: string, styles = "") => rewriteShadcnAria({ item: "example", leaf: "button", files: [{ path: "example.tsx", content }], styles, leafByItem: { button: "button", input: "text-field" } });
describe("shadcn-aria-rewrite@1", () => {
  it.each(["button", "select", "calendar", "combobox"])("matches the pinned %s byte golden and parses rewritten TSX", item => {
    const result = importShadcnAriaComponents(pinnedInput()).rewrites[item]!;
    expect(JSON.stringify(result, null, 2) + "\n").toBe(readFileSync(resolve(import.meta.dirname, `__fixtures__/shadcn-aria/${item === "combobox" ? "combo-box" : item}.golden.json`), "utf8"));
    for (const file of result.files.filter(file => /\.tsx?$/.test(file.path))) {
      const parsed = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      expect((parsed as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length, file.path).toBe(0);
    }
  });
  it("preserves variants while binding theme, font size and exactly equal spacing", () => {
    const result = rewrite('const value = "dark:hover:bg-primary/80 text-sm px-2 gap-1.5 rounded-lg"');
    const code = result.files[0]!.content;
    expect(code).toContain("dark:hover:bg-(--color-action)/80");
    expect(code).toContain("text-(length:--text-sm)");
    expect(code).toContain("px-(--spacing-sm)");
    expect(result.reads.tokens).toEqual(expect.arrayContaining(["tokens.action-color.default", "tokens.font-size.sm", "tokens.spacing.sm", "tokens.control-radius.default"]));
    expect(result.issues).toEqual([]);
    expect(code).toContain("gap-(--spacing-sm)");
    expect(result.notes).toContainEqual(expect.objectContaining({value:"gap-1.5",message:expect.stringContaining("Restyled source:")}));
  });
  it("binds semantic button control heights instead of retaining the upstream fixed height", () => {
    const result = rewrite('const value = "cn-button-size-default"', ".cn-button-size-default { @apply h-8 px-2; }");
    expect(result.files[0]!.content).toContain("h-(--ui-control-h-md)");
    expect(result.reads.tokens).toContain("tokens.control-size.h-md");
  });
  it("rewrites IconPlaceholder to the consumer icon leaf and rejects an unknown glyph", () => {
    const result = rewrite('import { IconPlaceholder } from "@/app/(create)/components/icon-placeholder"\nconst value = <IconPlaceholder lucide="CheckIcon" tabler="IconCheck" className="size-4" />');
    expect(result.files[0]!.content).toContain('Icon as LibraryIcon');
    expect(result.files[0]!.content).toContain('asset="assets.icon-check"');
    expect(result.files[0]!.content).not.toContain("IconPlaceholder");
    expect(result.reads.assets).toEqual(["assets.icon-check"]);
    expect(rewrite('<IconPlaceholder lucide="UnmappedIcon" />').issues).toContainEqual(expect.objectContaining({ code: "K7" }));
  });
  it("canonicalizes inherited paint syntax without choosing a consumer colour", async () => {
    const result = rewrite('const value = "text-[inherit] hover:text-[inherit] text-[red]"');
    expect(result.files[0]!.content).toContain("text-inherit hover:text-inherit text-[red]");
    expect(result.reads.tokens).toEqual([]);
    expect(result.issues.filter(issue => issue.value.includes("inherit"))).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "K4", value: "text-[red]" }));
    const { css } = await generateCompiledCss({ stylesDir: resolve(import.meta.dirname, "../../styles"), candidates: ["text-inherit", "hover:text-inherit"] });
    expect(css).toContain("color: inherit");
  });
  it("does not silently flatten nested CSS or fabricate private variable bindings", () => {
    const result = rewrite('const value = "cn-nested h-(--private-size)"', ".cn-nested { &:hover { @apply bg-primary; } }");
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "K4", value: "cn-nested" }));
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "K4", value: "--private-size" }));
    expect(result.reads.tokens).toEqual([]);
  });
  it("rewrites a static named Lucide import and reports an unmapped binding", () => {
    const result = rewrite('import { Check as Tick } from "lucide-react"\nconst glyph = <Tick className="size-4" />');
    expect(result.files[0]!.content).not.toContain("lucide-react");
    expect(result.files[0]!.content).toContain('asset="assets.icon-check"');
    expect(result.reads.assets).toEqual(["assets.icon-check"]);
    expect(rewrite('import { Unknown } from "lucide-react"\nconst glyph = <Unknown />').issues).toContainEqual(expect.objectContaining({ code: "K7" }));
  });
  it("rebinds known registry leaves and keeps non-leaf dependencies as parts", () => {
    const result = rewrite('import { Button } from "@/components/ui/button"\nimport { InputGroup } from "@/components/ui/input-group"');
    expect(result.files[0]!.content).toContain('"../button/index.js"');
    expect(result.files[0]!.content).toContain('"../_parts/input-group/index.js"');
    expect(result.parts).toEqual(["input-group"]);
    expect(result.reads.components).toEqual(["components.button"]);
  });
  it("rejects escaping source paths and colliding output filenames", () => {
    expect(() => rewriteShadcnAria({ item: "button", leaf: "button", files: [{ path: "../button.tsx", content: "" }], styles: "", leafByItem: {} })).toThrow(/unsafe/);
    expect(() => rewriteShadcnAria({ item: "button", leaf: "button", files: [{ path: "a/button.tsx", content: "" }, { path: "b/button.tsx", content: "" }], styles: "", leafByItem: {} })).toThrow(/duplicate/);
  });
  it("keeps primary actions separate from the two link-variant exceptions", () => {
    const result = rewrite('const value = "cn-button-variant-link cn-badge-variant-link bg-primary"', '.cn-button-variant-link { @apply text-primary; } .cn-badge-variant-link { @apply hover:text-primary; }');
    expect(result.files[0]!.content).toContain("text-(--color-accent-text)");
    expect(result.files[0]!.content).toContain("hover:text-(--color-accent-text)");
    expect(result.files[0]!.content).toContain("bg-(--color-action)");
    expect(result.reads.tokens).toEqual(["tokens.accent-color.text", "tokens.action-color.default"]);
  });
  it.each(["focus-visible:", "data-focus-visible:", "focus-within:", "has-[>input:focus-visible]:"])("replaces %s ring paint and width with a solid token outline", prefix => {
    const result = rewrite(`const value = "${prefix}ring-3 ${prefix}ring-ring/50"`);
    const code = result.files[0]!.content;
    expect(code).not.toContain("ring-3");
    expect(code).not.toContain("/50");
    for (const atom of ["outline-solid", "outline-(length:--ui-border-focus)", "outline-offset-(--ui-focus-offset)", "outline-(--color-focus-ring)"]) expect(code).toContain(prefix + atom);
    expect(result.reads.tokens).toEqual(["tokens.focus-color.default", "tokens.focus-outline.offset", "tokens.focus-outline.width"]);
    expect(result.issues).toEqual([]);
  });
  it.each(["outline-none", "outline-hidden", "ring-0", "border-transparent", "group-has-[:focus-visible]/field-label:ring-0", "group-has-[:focus-visible]/field-label:border-transparent", "focus-visible:outline-hidden"])("removes %s only beside an expanded focus owner binding", suppression => {
    const result = rewrite(`const value = "cn-focus ${suppression}"`, '.cn-focus { @apply data-focus-visible:ring-3 focus-visible:ring-ring/50; }');
    expect(result.files[0]!.content).not.toContain(suppression);
    expect(result.files[0]!.content).toContain("focus-visible:outline-(length:--ui-border-focus)");
    expect(result.files[0]!.content).toContain("data-focus-visible:outline-(--color-focus-ring)");
    expect(result.notes).toContainEqual(expect.objectContaining({ value: suppression, message: expect.stringContaining("focus owner") }));
    expect(result.issues).toEqual([]);
  });
  it("retains suppressions without same-expression focus ownership", () => {
    for (const content of [
      'const value = "outline-none"; const unrelated = "focus-visible:ring-3"',
      'const value = focused ? "focus-visible:ring-3" : "outline-none"',
      'const value = "outline-none hover:focus-visible:ring-3"',
      'const value = "focus-visible:ring-3 [&>span]:outline-none"',
      'const value = "outline-none group-has-[:focus-visible]/field-label:ring-0"',
      'const value = <div className="focus-visible:ring-3"><span className="ring-0" /></div>',
    ]) {
      const result = rewrite(content);
      expect(result.issues).toContainEqual(expect.objectContaining({ code: "K4", value: content.includes('className="ring-0"') ? "ring-0" : content.includes("[&>span]") ? "[&>span]:outline-none" : "outline-none" }));
    }
    const result = rewriteShadcnAria({ item: "example", leaf: "button", files: [{ path: "focus.tsx", content: 'const value = "focus-visible:ring-3"' }, { path: "suppression.tsx", content: 'const value = "outline-none"' }], styles: "", leafByItem: {} });
    expect(result.issues).toContainEqual(expect.objectContaining({ file: "suppression.tsx", value: "outline-none" }));
  });
  it.each(["aria-invalid:", "data-invalid:", "hover:", "active:"])("binds %s danger ring width and paint to the solid existing token shape", prefix => {
    const result = rewrite(`const value = "${prefix}ring-3 ${prefix}ring-destructive/20"`);
    for (const atom of ["outline-solid", "outline-(length:--ui-border-focus)", "outline-offset-(--ui-focus-offset)", "outline-(--color-status-danger)"]) expect(result.files[0]!.content).toContain(prefix + atom);
    expect(result.reads.tokens).toEqual(["tokens.focus-outline.offset", "tokens.focus-outline.width", "tokens.status-color.danger"]);
    expect(result.issues).toEqual([]);
  });
  it("keeps danger paint alone from manufacturing a ring width", () => {
    const result = rewrite('const value = "aria-invalid:ring-destructive/20"');
    expect(result.files[0]!.content).toContain("aria-invalid:ring-(--color-status-danger)/20");
    expect(result.files[0]!.content).not.toContain("outline-solid");
    expect(result.reads.tokens).toEqual(["tokens.status-color.danger"]);
  });
  it("retains hover and active ring widths when the source paint is a different role", () => {
    const result = rewrite('const value = "ring-ring/50 hover:ring-3 active:ring-3"');
    for (const value of ["hover:ring-3", "active:ring-3"]) expect(result.issues).toContainEqual(expect.objectContaining({ code: "K4", value }));
    expect(result.reads.tokens).not.toContain("tokens.status-color.danger");
  });
  it("binds exact existing size members without treating them as spacing", () => {
    const result = rewrite('const value = "[&>svg]:size-3.5 data-small:h-[14px] w-[24px] dark:w-[32px]"');
    expect(result.files[0]!.content).toContain("[&>svg]:size-(--ui-control-switch-thumb)");
    expect(result.files[0]!.content).toContain("data-small:h-(--ui-control-switch-thumb)");
    expect(result.files[0]!.content).toContain("w-(--spacing-xl)");
    expect(result.files[0]!.content).toContain("dark:w-(--spacing-2xl)");
    expect(result.reads.tokens).toEqual(["tokens.control-size.switch-thumb", "tokens.spacing.2xl", "tokens.spacing.xl"]);
    expect(result.issues).toEqual([]);
    const radius = rewrite('const value = "rounded-[4px]"');
    expect(radius.files[0]!.content).toBe('const value = "rounded-(--radius-default)"');
    expect(radius.reads.tokens).toEqual(["tokens.radius.default"]);
    expect(radius.issues).toEqual([]);
    for (const value of ["p-3.5", "h-[18.4px]", "min-h-40", "rounded-[5px]", "translate-x-[calc(100%-2px)]", "h-[14.1px]"]) expect(rewrite(`const value = "${value}"`).issues).toContainEqual(expect.objectContaining({ code: "K4", value }));
  });
  it("retains white slider paint when no replacement has been qualified", () => {
    const result = rewrite('const value = "cn-slider-thumb"', '.cn-slider-thumb { @apply border-ring bg-white ring-ring/50 hover:ring-3 focus-visible:ring-3; }');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "K4", value: "bg-white" }));
    expect(result.files[0]!.content).toContain("bg-white");
  });
  it("compiles approved danger geometry and exact sizes to token CSS", async () => {
    const result = rewrite('const value = "data-invalid:ring-3 data-invalid:ring-destructive/20 h-[14px] w-[24px]"');
    const candidates = result.files[0]!.content.match(/"([^"]+)"/)![1]!.split(/\s+/);
    const { css } = await generateCompiledCss({ stylesDir: resolve(import.meta.dirname, "../../styles"), candidates });
    expect(css).toContain("outline-style: solid");
    expect(css).toContain("outline-width: var(--ui-border-focus)");
    expect(css).toContain("outline-color: var(--color-status-danger)");
    expect(css).toContain("height: var(--ui-control-switch-thumb)");
    expect(css).toContain("width: var(--spacing-xl)");
  });
  it("binds only known shadows and lifecycle motion, retaining React Aria selectors", () => {
    const result = rewrite('const value = "shadow-md data-entering:animate-in data-entering:fade-in-0 data-entering:zoom-in-95 data-exiting:animate-out data-exiting:fade-out-0 duration-100"');
    expect(result.files[0]!.content).toContain("shadow-(--ui-elevation-floating)");
    expect(result.files[0]!.content).toContain("data-entering:library-enter data-entering:library-fade data-entering:library-zoom data-exiting:library-exit");
    expect(result.reads.tokens).toEqual(["tokens.duration.fast", "tokens.elevation.floating", "tokens.transition-easing.enter", "tokens.transition-easing.exit"]);
    expect(result.issues).toEqual([]);
  });
  it("refuses unknown animation, focus width, literal control sizes and raw arbitrary paint", () => {
    const result = rewrite('const value = "animate-bounce focus-visible:ring-7 h-[33px] bg-red-500 bg-[rebeccapurple]"');
    for (const value of ["animate-bounce", "focus-visible:ring-7", "h-[33px]", "bg-red-500", "bg-[rebeccapurple]"]) expect(result.issues).toContainEqual(expect.objectContaining({ code: "K4", value }));
    expect(result.files[0]!.content).toContain("h-[33px]");
  });

  it("compiles focus, action and lifecycle utilities to real token-bound CSS", async () => {
    const result = rewrite('const value = "focus-visible:ring-3 focus-visible:ring-ring/50 shadow-md data-entering:animate-in data-exiting:animate-out data-entering:fade-in-0 data-entering:zoom-in-95 bg-primary"');
    const candidates = result.files[0]!.content.match(/"([^"]+)"/)![1]!.split(/\s+/);
    const { css } = await generateCompiledCss({ stylesDir: resolve(import.meta.dirname, "../../styles"), candidates });
    expect(css).toContain("outline-width: var(--ui-border-focus)");
    expect(css).toContain("outline-offset: var(--ui-focus-offset)");
    expect(css).toContain("outline-color: var(--color-focus-ring)");
    expect(css).toContain("var(--ui-elevation-floating)");
    expect(css).toContain("background-color: var(--color-action)");
    expect(css).toContain("animation: library-transition var(--ui-duration-fast, 120ms) var(--ease-enter");
    expect(css).toContain("animation: library-transition var(--ui-duration-fast, 120ms) var(--ease-exit");
    expect(css).toContain("@keyframes library-transition");
    expect(css).toContain("animation-duration: 0s");
  });

  it.each([
    ['opacity', 'disabled:opacity-50', 'disabled:opacity-(--ui-alpha-disabled)', 'tokens.state-opacity.disabled'],
    ['stale-opacity', 'opacity-70', 'opacity-(--ui-alpha-stale)', 'tokens.state-opacity.stale'],
    ['font-weight', 'font-medium', 'font-(weight:--font-weight-medium)', 'tokens.font-weight.medium'],
    ['duration', 'duration-160', 'duration-(--ui-duration-fast)', 'tokens.duration.fast'],
    ['easing', 'ease-in', 'ease-(--ease-accelerate)', 'tokens.easing.accelerate'],
    ['transition', 'hover:transition-colors', 'hover:duration-(--ui-duration-default)', 'tokens.duration.default'],
    ['border-bare', 'border', 'border-(length:--ui-border-hairline)', 'tokens.border-width.hairline'],
    ['border-width', 'border-t', 'border-t-(length:--ui-border-hairline)', 'tokens.border-width.hairline'],
  ])('binds the %s family to an existing member', (_family, value, expected, member) => {
    const result = rewrite(`const value = "${value}"`);
    expect(result.files[0]!.content).toContain(expected);
    expect(result.reads.tokens).toContain(member);
    expect(result.issues).toEqual([]);
  });
  it('binds z-index only inside the leaf contract permission', () => {
    const input = { item: 'tooltip', leaf: 'tooltip', files: [{ path: 'tooltip.tsx', content: 'const value = "z-50"' }], styles: '', leafByItem: {} };
    const permitted = rewriteShadcnAria(input);
    expect(permitted.files[0]!.content).toContain('z-(--ui-z-modal)');
    expect(permitted.reads.tokens).toEqual(['tokens.z-index.modal']);
    expect(permitted.issues).toEqual([]);
    const refused = rewriteShadcnAria({ ...input, leaf: 'checkbox' });
    expect(refused.files[0]!.content).toContain('z-50');
    expect(refused.reads.tokens).toEqual([]);
    expect(refused.issues).toContainEqual(expect.objectContaining({ code: 'K4', value: 'z-50' }));
  });
  it('keeps fractional spacing exact and unsupported family values unresolved', () => {
    for (const [value, output, token, note] of [
      ["px-1.5", "px-(--spacing-sm)", "tokens.spacing.sm", "6px to spacing.sm 8px"],
      ["gap-2.5", "gap-(--spacing-md)", "tokens.spacing.md", "10px to spacing.md 12px"],
    ]) {
      const result = rewrite(`const value = "${value}"`);
      expect(result.files[0]!.content).toBe(`const value = "${output}"`);
      expect(result.reads.tokens).toEqual([token]);
      expect(result.notes).toContainEqual(expect.objectContaining({ value, message: expect.stringContaining(note!) }));
      expect(result.issues).toEqual([]);
    }
    for (const value of ['gap-0.5', 'opacity-35', 'font-450', 'duration-200', 'ease-linear', 'ease-in-out', 'border-2']) {
      const result = rewrite(`const value = "${value}"`);
      expect(result.files[0]!.content, value).toContain(value);
      expect(result.issues, value).toContainEqual(expect.objectContaining({ code: 'K4', value }));
      expect(result.reads.tokens, value).toEqual([]);
    }
  });
  it('removes absent marker classes with notes while retaining defined and cyclic styles', () => {
    const result = rewrite('const value = "cn-menu-target hover:cn-marker cn-defined"', '.cn-defined { @apply px-2; }');
    expect(result.files[0]!.content).toBe('const value = "px-(--spacing-sm)"');
    expect(result.notes).toEqual([
      { file: 'example.tsx', value: 'cn-menu-target', message: 'Removed marker-only class absent from the pinned stylesheet' },
      { file: 'example.tsx', value: 'hover:cn-marker', message: 'Removed marker-only class absent from the pinned stylesheet' },
    ]);
    expect(result.issues).toEqual([]);
    expect(rewrite('const value = "cn-[dynamic]"').issues).toContainEqual(expect.objectContaining({ code: 'K4', value: 'cn-[dynamic]' }));
    const cyclic = rewrite('const value = "cn-cycle"', '.cn-cycle { @apply cn-cycle; }');
    expect(cyclic.issues).toContainEqual(expect.objectContaining({ code: 'K4', value: 'cn-cycle' }));
  });
  it('passes through only RAC geometry variables evidenced by the matching runtime import', () => {
    const classes = 'w-(--trigger-width) origin-(--trigger-anchor-point) max-h-(--available-height)';
    const result = rewrite(`import { Popover as Overlay } from "react-aria-components"\nconst value = "${classes}"`);
    expect(result.files[0]!.content).toContain(classes);
    expect(result.issues).toEqual([]);
    expect(result.reads.tokens).toEqual([]);
    for (const content of [`const value = "${classes}"`, `import { Button } from "react-aria-components"\nconst value = "${classes}"`]) {
      expect(rewrite(content).issues.filter(issue => issue.message.includes('Private CSS'))).toHaveLength(3);
    }
    const unknown = rewrite('import { Popover } from "react-aria-components"\nconst value = "w-(--private-size)"');
    expect(unknown.issues).toContainEqual(expect.objectContaining({ code: 'K4', value: '--private-size' }));
    const disclosure = rewrite('import { DisclosurePanel } from "react-aria-components"\nconst value = "h-(--disclosure-panel-height)"');
    expect(disclosure.issues).toEqual([]);
  });
  it('makes transition timing explicit and keeps structural no-transition unchanged', () => {
    const result = rewrite('const value = "transition-[color,box-shadow] transition-none"');
    expect(result.files[0]!.content).toContain('transition-[color,box-shadow] duration-(--ui-duration-default) ease-(--ease-default) transition-none');
    expect(result.reads.tokens).toEqual(['tokens.duration.default', 'tokens.easing.default']);
    expect(result.issues).toEqual([]);
  });
  it('compiles generic family bindings to the declared CSS properties', async () => {
    const result = rewrite('const value = "opacity-50 font-medium transition-colors border-t"');
    const candidates = result.files[0]!.content.match(/"([^"]+)"/)![1]!.split(/\s+/);
    const { css } = await generateCompiledCss({ stylesDir: resolve(import.meta.dirname, '../../styles'), candidates });
    for (const declaration of ['opacity: var(--ui-alpha-disabled)', 'font-weight: var(--font-weight-medium)', 'transition-duration: var(--ui-duration-default)', 'transition-timing-function: var(--ease-default)', 'border-top-width: var(--ui-border-hairline)']) expect(css).toContain(declaration);
  });

  it('honours explicit transition timing before and after structural utilities and inside styles', async () => {
    for (const value of ['transition-colors duration-160 ease-in', 'ease-in duration-160 transition-colors', 'hover:transition-colors duration-160 ease-in', 'hover:transition-colors hover:duration-160 hover:ease-in', 'cn-timed']) {
      const result = rewrite(`const value = "${value}"`, '.cn-timed { @apply transition-colors duration-160 ease-in; }');
      expect(result.files[0]!.content).not.toContain('--ui-duration-default');
      expect(result.files[0]!.content).not.toContain('--ease-default');
      expect(result.reads.tokens).toEqual(['tokens.duration.fast', 'tokens.easing.accelerate']);
      expect(result.issues).toEqual([]);
      const candidates = result.files[0]!.content.match(/"([^"]+)"/)![1]!.split(/\s+/);
      const { css } = await generateCompiledCss({ stylesDir: resolve(import.meta.dirname, '../../styles'), candidates });
      expect(css).toContain('transition-duration: var(--ui-duration-fast)');
      expect(css).toContain('transition-timing-function: var(--ease-accelerate)');
      expectExplicitTiming(css, candidates, '--ui-duration-fast', '--ease-accelerate');
    }
  });

  it('compiles instant duration and decelerating timing without competing defaults', async () => {
    const result = rewrite('const value = "transition-colors duration-80 ease-out"');
    const candidates = result.files[0]!.content.match(/"([^"]+)"/)![1]!.split(/\s+/);
    const { css } = await generateCompiledCss({ stylesDir: resolve(import.meta.dirname, '../../styles'), candidates });
    expect(css).toContain('transition-duration: var(--ui-duration-instant)');
    expect(css).toContain('transition-timing-function: var(--ease-decelerate)');
    expectExplicitTiming(css, candidates, '--ui-duration-instant', '--ease-decelerate');
    expect(result.issues).toEqual([]);
  });

  it('retains K4 when cva or conditional assembly splits transition timing across strings', () => {
    for (const content of [
      'const value = cva("transition-colors", { variants: { speed: { fast: "duration-80 ease-in" } } })',
      'const value = cn("transition-colors", fast && "duration-80 ease-in")',
    ]) {
      const result = rewrite(content);
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'K4', value: 'transition-colors', message: 'Transition timing split across class expressions needs an explicit binding' }));
      expect(result.files[0]!.content).not.toContain('--ui-duration-default');
      expect(result.files[0]!.content).not.toContain('--ease-default');
    }
  });

  it("binds the pinned keyboard sans family to its permitted consumer body typeface", async () => {
    const input = pinnedInput();
    const kbd = input.items.find(item => item.name === "kbd")!.files[0]!;
    expect(kbd.content).toContain("cn-kbd");
    expect(input.styles.content).toMatch(/\.cn-kbd\s*\{[^}]*font-sans/s);
    const result = rewriteShadcnAria({ item: "kbd", leaf: "keyboard", files: [kbd], styles: input.styles.content, leafByItem: {} });
    expect(result.files[0]!.content).not.toContain("font-sans");
    expect(result.reads.tokens).toContain("tokens.typeface.body");
    expect(result.issues.some(issue => issue.value === "font-sans")).toBe(false);
    const variant = rewrite('const value = "dark:hover:font-sans"');
    expect(variant.files[0]!.content).toContain("dark:hover:font-(family-name:--font-body)");
    const { css } = await generateCompiledCss({ stylesDir: resolve(import.meta.dirname, "../../styles"), candidates: ["dark:hover:font-(family-name:--font-body)"] });
    expect(css).toContain("font-family: var(--font-body)");
    expect(rewrite('const value = "font-unapproved"').issues).toContainEqual(expect.objectContaining({ code: "K4", value: "font-unapproved" }));
  });

  it("binds important utilities without discarding precedence or unknown findings", async () => {
    const result = rewrite('const value = "hover:text-accent-foreground! data-entering:animate-in!"');
    expect(result.files[0]!.content).toContain("hover:text-(--color-ink-primary)!");
    expect(result.files[0]!.content).toContain("data-entering:library-enter!");
    expect(result.issues).toEqual([]);
    const { css } = await generateCompiledCss({ stylesDir: resolve(import.meta.dirname, "../../styles"), candidates: ["hover:text-(--color-ink-primary)!"] });
    expect(css).toContain("color: var(--color-ink-primary) !important");
    expect(rewrite('const value = "font-unapproved!"').issues).toContainEqual(expect.objectContaining({ code: "K4", value: "font-unapproved!" }));
  });
  it("treats arbitrary three-pixel focus syntax identically and preserves decorative negatives", () => {
    const canonical = rewrite('const value = "focus-visible:ring-3 outline-none"');
    const arbitrary = rewrite('const value = "focus-visible:ring-[3px] outline-none"');
    expect(arbitrary.files).toEqual(canonical.files);
    expect(arbitrary.reads).toEqual(canonical.reads);
    expect(arbitrary.issues).toEqual([]);
    expect(rewrite('const value = "hover:ring-[3px] ring-1"').issues).toEqual(expect.arrayContaining([expect.objectContaining({code:"K4",value:"hover:ring-[3px]"})]));
  });

  it("records each approved fractional restyle while retaining unapproved lengths", () => {
    const result=rewrite('const value = "px-1.5 hover:gap-2.5 p-0.5"');
    expect(result.files[0]!.content).toContain("px-(--spacing-sm) hover:gap-(--spacing-md) p-0.5");
    expect(result.notes).toEqual(expect.arrayContaining([expect.objectContaining({value:"px-1.5",message:expect.stringContaining("6px to spacing.sm 8px")}),expect.objectContaining({value:"hover:gap-2.5",message:expect.stringContaining("10px to spacing.md 12px")})]));
    expect(result.issues).toContainEqual(expect.objectContaining({code:"K4",value:"p-0.5"}));
  });
  it("binds keyboard type and collapsed breadcrumbs only to the approved existing members", () => {
    const kbd=rewriteShadcnAria({item:"kbd",leaf:"keyboard",files:[{path:"kbd.tsx",content:'const value="text-xs shadow-none"'}],styles:"",leafByItem:{}});
    expect(kbd.reads.tokens).toEqual(["tokens.code-size.block","tokens.elevation.none"]);
    expect(kbd.files[0]!.content).toContain("text-(length:--text-code-block) shadow-(--ui-elevation-none)");
    const source='<IconPlaceholder lucide="MoreHorizontalIcon" aria-hidden="true" />';
    const breadcrumb=rewriteShadcnAria({item:"breadcrumb",leaf:"breadcrumbs",files:[{path:"breadcrumb.tsx",content:source}],styles:"",leafByItem:{}});
    expect(breadcrumb.reads.assets).toEqual(["assets.icon-chevron-down"]);
    expect(breadcrumb.files[0]!.content).toContain('asset="assets.icon-chevron-down" aria-hidden="true"');
    expect(breadcrumb.issues).toEqual([]);
    expect(rewrite(source).issues).toContainEqual(expect.objectContaining({code:"K7"}));
  });

  it("binds exact structural and geometry families without admitting unknown design values", async () => {
    const separator = rewrite('const value = "border-collapse max-w-[calc(100%-2rem)] rounded-[4px] min-w-[96px]"');
    expect(separator.files[0]!.content).toContain("border-collapse max-w-[calc(100%-var(--spacing-2xl))] rounded-(--radius-default) min-w-(--spacing-5xl)");
    expect(separator.reads.tokens).toEqual(["tokens.radius.default", "tokens.spacing.2xl", "tokens.spacing.5xl"]);
    expect(separator.issues).toEqual([]);
    expect(rewrite('const value = "rounded-[5px] min-w-[97px] border-unbound"').issues).toHaveLength(3);
    const { css } = await generateCompiledCss({ stylesDir: resolve(import.meta.dirname, "../../styles"), candidates: ["border-collapse", "max-w-[calc(100%-var(--spacing-2xl))]", "rounded-(--radius-default)", "min-w-(--spacing-5xl)"] });
    for (const declaration of ["border-collapse: collapse", "max-width: calc(100% - var(--spacing-2xl))", "border-radius: var(--radius-default)", "min-width: var(--spacing-5xl)"]) expect(css).toContain(declaration);
  });
  it("preserves decorative ring semantics only with the existing exact read permission", async () => {
    const avatar = rewriteShadcnAria({item:"avatar",leaf:"avatar",files:[{path:"avatar.tsx",content:'const value="ring-1 hover:ring-2 ring-3"'}],styles:"",leafByItem:{}});
    expect(avatar.files[0]!.content).toContain("ring-(length:--ui-border-hairline) hover:ring-(length:--ui-border-rule)");
    expect(avatar.reads.tokens).toContain("tokens.border-width.rule");
    expect(avatar.files[0]!.content).not.toContain("hover:outline");
    const menu = rewriteShadcnAria({item:"kbd",leaf:"keyboard",files:[{path:"kbd.tsx",content:'const value="ring-1"'}],styles:"",leafByItem:{}});
    expect(menu.issues).toContainEqual(expect.objectContaining({code:"K4",value:"ring-1"}));
    const {css} = await generateCompiledCss({stylesDir:resolve(import.meta.dirname,"../../styles"),candidates:["ring-(length:--ui-border-hairline)"]});
    expect(css).toContain("var(--ui-border-hairline)");
    expect(css).toContain("--tw-ring-shadow");
  });
  it("binds Card spacing aliases while preserving the small conditional override and inherited consumers", () => {
    const styles=".cn-card { @apply gap-(--card-spacing) [--card-spacing:--spacing(4)] data-[size=sm]:[--card-spacing:--spacing(3)]; } .cn-card-content { @apply px-(--card-spacing); }";
    const run=(sheet:string)=>rewriteShadcnAria({item:"card",leaf:"card",files:[{path:"card.tsx",content:'const root="cn-card"; const child="cn-card-content"'}],styles:sheet,leafByItem:{}});
    const result=run(styles);
    expect(result.files[0]!.content).toContain("[--card-spacing:var(--spacing-lg)] data-[size=sm]:[--card-spacing:var(--spacing-md)]");
    expect(result.files[0]!.content).toContain("px-(--card-spacing)");
    expect(result.reads.tokens).toEqual(["tokens.spacing.lg","tokens.spacing.md"]);
    expect(result.issues).toEqual([]);
    expect(run(styles.replace("[--card-spacing:--spacing(4)]","")).issues).toContainEqual(expect.objectContaining({code:"K4",value:"--card-spacing"}));
  });

  it("recognizes the actual field-descendant and calendar-day focus owners without accepting unrelated selectors", () => {
    for(const prefix of ["has-[[data-slot=input-group-control]:focus-visible]:","group-data-[focused=true]/day:"]){
      const result=rewrite(`const value="${prefix}ring-[3px] ${prefix}ring-ring/50 outline-none border-0"`);
      expect(result.issues).toEqual([]);
      expect(result.files[0]!.content).toContain(`${prefix}outline-(length:--ui-border-focus)`);
      expect(result.files[0]!.content).not.toContain("outline-none");
    }
    expect(rewrite('const value="group-data-[focused=false]/day:ring-[3px] outline-none"').issues).toContainEqual(expect.objectContaining({value:"outline-none"}));
    expect(rewrite('const value="border-0 focus-visible:outline-1"').issues).toEqual(expect.arrayContaining([expect.objectContaining({value:"border-0"}),expect.objectContaining({value:"focus-visible:outline-1"})]));
  });
  it("binds the selected ancestor-invalid ring only with matching same-branch danger paint", () => {
    for(const prefix of ["has-aria-invalid:","has-[[data-slot][aria-invalid=true]]:"]){
      const result=rewrite(`const value="${prefix}ring-3 ${prefix}ring-destructive/20"`);
      expect(result.issues).toEqual([]);
      expect(result.reads.tokens).toEqual(["tokens.focus-outline.offset","tokens.focus-outline.width","tokens.status-color.danger"]);
      expect(rewrite(`const value="${prefix}ring-3 hover:ring-destructive/20"`).issues).toContainEqual(expect.objectContaining({value:prefix+"ring-3"}));
    }
  });
  it("keeps boolean indicator visibility paired and retains unowned opacity findings", () => {
    const run=(content:string)=>rewriteShadcnAria({item:"tabs",leaf:"tabs",files:[{path:"tabs.tsx",content}],styles:"",leafByItem:{}});
    expect(run('const value="after:opacity-0 group-data-[variant=line]/tabs-list:data-selected:after:opacity-100"').issues).toEqual([]);
    expect(run('const value="after:opacity-0"').issues).toContainEqual(expect.objectContaining({value:"after:opacity-0"}));
    expect(rewrite('const value="hover:opacity-100"').issues).toContainEqual(expect.objectContaining({value:"hover:opacity-100"}));
  });

  it("isolates only authenticated Select and ComboBox function timing, retaining changed-source and conditional negatives", () => {
    const input=pinnedInput();
    for(const item of ["select","combobox"]){
      const file=input.items.find(row=>row.name===item)!.files[0]!;
      const run=(content:string)=>rewriteShadcnAria({item,leaf:item==="combobox"?"combo-box":"select",files:[{...file,content}],styles:input.styles.content,leafByItem:{}});
      expect(run(file.content).issues.filter(issue=>issue.message.includes("timing split"))).toEqual([]);
      expect(run(file.content+"\n// altered source receipt\n").issues).toContainEqual(expect.objectContaining({code:"K4",value:"transition-colors",message:expect.stringContaining("timing split")}));
    }
    expect(rewrite('const value=cn("transition-colors", fast && "duration-80 ease-in")').issues).toContainEqual(expect.objectContaining({code:"K4",value:"transition-colors"}));
  });

  it("keeps private input resets only under the exact selected parent and its token focus/invalid owners", () => {
    const input = pinnedInput(), part = input.items.find(row => row.name === "input-group")!.files[0]!;
    const resets = new Set(["ring-0", "focus-visible:ring-0", "aria-invalid:ring-0", "border-0",
      "in-data-[slot=combobox-content]:focus-within:border-inherit", "in-data-[slot=combobox-content]:focus-within:ring-0"]);
    for (const item of ["select", "combobox"]) {
      const root = input.items.find(row => row.name === item)!.files[0]!;
      const run = (rootContent = root.content, partContent = part.content, styles = input.styles.content) => rewriteShadcnAria({
        item, leaf: item === "select" ? "select" : "combo-box", styles, leafByItem: SHADCN_COMPONENT_ITEMS,
        files: [{ ...root, content: rootContent }, { path: "components/_parts/input-group/input-group.tsx", content: partContent }],
      });
      expect(run().issues.filter(issue => issue.file.includes("/_parts/input-group/") && resets.has(issue.value))).toEqual([]);
      for (const changed of [run(root.content + " "), run(root.content, part.content + " "),
        run(root.content, part.content, input.styles.content.replace("has-[[data-slot=input-group-control]:focus-visible]:ring-3", ""))]) {
        expect(changed.issues).toContainEqual(expect.objectContaining({ code: "K4", value: "focus-visible:ring-0" }));
      }
    }
  });

  it("retains only authenticated listbox focus paint ownership and nonfocusable switch-thumb resets", () => {
    const input = pinnedInput();
    for (const item of ["select", "combobox"]) {
      const file = input.items.find(row => row.name === item)!.files[0]!;
      const run = (content = file.content, styles = input.styles.content) => rewriteShadcnAria({ item,
        leaf: item === "select" ? "select" : "combo-box", files: [{ ...file, content }], styles, leafByItem: SHADCN_COMPONENT_ITEMS });
      // The authenticated SelectList container now has its own token outline;
      // the item literal independently retains its focused paint pair.
      expect(run().issues.filter(issue => issue.value === "outline-hidden")).toHaveLength(0);
      expect(run(file.content + " ").issues).toContainEqual(expect.objectContaining({ code: "K4", value: "outline-hidden" }));
      expect(run(file.content, input.styles.content.replaceAll("data-focused:bg-accent", "")).issues).toContainEqual(expect.objectContaining({ code: "K4", value: "outline-hidden" }));
    }
    const file = input.items.find(row => row.name === "switch")!.files[0]!;
    const run = (content = file.content, styles = input.styles.content) => rewriteShadcnAria({ item: "switch", leaf: "switch", files: [{ ...file, content }], styles, leafByItem: SHADCN_COMPONENT_ITEMS });
    expect(run().issues.some(issue => issue.value === "ring-0")).toBe(false);
    const switchRule = input.styles.content.match(/\.cn-switch\s*\{[^}]*\}/)![0];
    expect(switchRule).toContain("focus-visible:ring-ring/50");
    const withoutSwitchFocus = switchRule.replace("focus-visible:ring-ring/50", "");
    expect(withoutSwitchFocus).not.toBe(switchRule);
    expect(withoutSwitchFocus).not.toContain("focus-visible:ring-ring/50");
    const changedStyles = input.styles.content.replace(switchRule, withoutSwitchFocus);
    expect(changedStyles.replace(withoutSwitchFocus, "")).toBe(input.styles.content.replace(switchRule, ""));
    for (const changed of [run(file.content + " "), run(file.content.replace("pointer-events-none block ring-0", "tabIndex=0 block ring-0")),
      run(file.content, changedStyles)]) {
      expect(changed.issues).toContainEqual(expect.objectContaining({ code: "K4", value: "ring-0" }));
    }
    expect(rewrite('const value="pointer-events-none ring-0"').issues).toContainEqual(expect.objectContaining({ code: "K4", value: "ring-0" }));
  });

  it("keeps selected line-tab border transparency only in the exact same-element focus/indicator source", () => {
    const input = pinnedInput(), file = input.items.find(row => row.name === "tabs")!.files[0]!;
    const value = "dark:group-data-[variant=line]/tabs-list:data-selected:border-transparent";
    const run = (content: string) => rewriteShadcnAria({ item: "tabs", leaf: "tabs", files: [{ ...file, content }], styles: input.styles.content, leafByItem: SHADCN_COMPONENT_ITEMS });
    expect(run(file.content).issues.some(issue => issue.value === value)).toBe(false);
    for (const changed of [file.content + " ", file.content.replace("focus-visible:ring-[3px]", ""),
      file.content.replace("group-data-[variant=line]/tabs-list:data-selected:after:opacity-100", "")]) {
      expect(run(changed).issues).toContainEqual(expect.objectContaining({ code: "K4", value }));
    }
    expect(rewrite(`const unrelated="${value}"`).issues).toContainEqual(expect.objectContaining({ code: "K4", value }));
  });

  it("restyles only the authenticated focus surfaces, disclosure, skeleton and decorative slider rings", () => {
    const input = pinnedInput();
    const cases = [
      ["dialog", "dialog", ["outline-none"]],
      ["dropdown-menu", "menu", ["outline-none", "outline-hidden"]],
      ["popover", "popover", ["outline-hidden"]],
      ["accordion", "disclosure", ["data-open:animate-accordion-down", "data-closed:animate-accordion-up"]],
      ["skeleton", "skeleton", ["animate-pulse"]],
      ["slider", "slider", ["hover:ring-3", "active:ring-3"]],
      ["select", "select", ["outline-hidden"]],
      ["combobox", "combo-box", ["outline-none"]],
      ["tabs", "tabs", ["outline-none"]],
    ] as const;
    for (const [item, leaf, values] of cases) {
      const file = input.items.find(row => row.name === item)!.files[0]!;
      const run = (content = file.content, styles = input.styles.content, selectedLeaf: string = leaf) => rewriteShadcnAria({ item, leaf: selectedLeaf,
        files: [{ ...file, content }], styles, leafByItem: SHADCN_COMPONENT_ITEMS });
      const result = run();
      expect(result.issues.filter(issue => values.includes(issue.value as never)), item).toEqual([]);
      for (const changed of [run(file.content + " "), run(file.content, input.styles.content + " "), run(file.content, input.styles.content, "button")]) {
        for (const value of values) expect(changed.issues, item + ":" + value).toContainEqual(expect.objectContaining({ code: "K4", value }));
      }
      if (["dialog", "menu", "popover", "select", "combo-box", "tabs"].includes(leaf)) {
        expect(result.files[0]!.content).toContain("focus-visible:outline-(length:--ui-border-focus)");
        expect(result.reads.tokens).toEqual(expect.arrayContaining(["tokens.focus-outline.width", "tokens.focus-outline.offset", "tokens.focus-color.default"]));
      }
      if (item === "accordion") {
        expect(result.files[0]!.content).toContain("data-open:library-enter data-open:library-fade");
        expect(result.files[0]!.content).toContain("data-closed:library-exit data-closed:library-fade");
        expect(result.reads.tokens).toEqual(expect.arrayContaining(["tokens.duration.fast", "tokens.transition-easing.enter", "tokens.transition-easing.exit"]));
      }
      if (item === "skeleton") expect(result.files[0]!.content).not.toContain("animate-pulse");
      if (item === "slider") {
        expect(result.files[0]!.content).toContain("hover:ring-(length:--ui-border-rule)");
        expect(result.files[0]!.content).toContain("active:ring-(length:--ui-border-rule)");
        expect(result.files[0]!.content).toContain("focus-visible:outline-(length:--ui-border-focus)");
      }
    }
    const command = input.items.find(row => row.name === "command")!.files[0]!;
    for (const item of ["dialog", "dropdown-menu"]) {
      const file = input.items.find(row => row.name === item)!.files[0]!;
      const selected = item === "dialog" ? dialogExecutableSource(file) : menuExecutableSource(file, command);
      const result = rewriteShadcnAria({ item, leaf: item === "dialog" ? "dialog" : "menu", files: [selected], styles: input.styles.content, leafByItem: SHADCN_COMPONENT_ITEMS });
      expect(result.issues.filter(issue => ["outline-none", "outline-hidden"].includes(issue.value))).toEqual([]);
      expect(result.files[0]!.content).toContain("focus-visible:outline-(length:--ui-border-focus)");
    }
    expect(rewrite('const unrelated="outline-none animate-pulse hover:ring-3"').issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "outline-none" }), expect.objectContaining({ value: "animate-pulse" }), expect.objectContaining({ value: "hover:ring-3" }),
    ]));
  });
});
