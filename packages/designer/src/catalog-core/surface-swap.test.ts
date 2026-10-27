/** @vitest-environment node */
// WIRE-14 (G3): source-kind derived Sections bind to the consumer component-index through the registered
// rule bind-selected-components@1, so a re-selected component reaches them. SYNTHETIC fixture only.
import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import { createElement as h, forwardRef, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { swapSurface } from "./__fixtures__/surface-engine/swap.js";
import { applyLibraryChange, libraryHash, resolve } from "./api.js";
import { componentFillId } from "./emit-components.js";
import { dsAttrs } from "./provenance-attrs.js";
import { scanProvenance } from "./provenance-scan.js";
import { surfaceOf } from "./surface-library.js";
import { bindSurfaceSource, surfaceSwapFindings } from "./surface-bindings.js";
import { BIND_SELECTED_COMPONENTS, COMPONENTS_PACKAGE_MODULE } from "./surface-materialize.js";
import type { CompositeEngineInput } from "./types.js";

const SLOT = "sections.form";
const fillOf = (input: CompositeEngineInput) => surfaceOf(input.library.surfaces!.fills.find(doc => surfaceOf(doc).slot === SLOT)!);
const owned = (input: CompositeEngineInput) => { const fill = fillOf(input); return input.library.surfaces!.files.filter(file => fill.outputSha256.some(row => row.path === file.path)); };
const form = (input: CompositeEngineInput) => owned(input).find(file => file.path === "sections/form/Form.ts")!.content;
const bound = (input: CompositeEngineInput) => bindSurfaceSource(fillOf(input), owned(input), resolve(input), input.surfaceOptions!.packages);
/** The selected-component closure the derived section actually imports, as the existing emitter generates it. */
const closure = (input: CompositeEngineInput) => bound(input).componentFiles.find(file => file.path === "components/button/index.ts")?.content;
const wl7 = (input: CompositeEngineInput) => surfaceSwapFindings(input, resolve(input));
/** The fill id the emitted stamping wrapper writes for the selected `components.button`. */
const selectedButton = (input: CompositeEngineInput) => { const profile = resolve(input); return componentFillId(profile.components.components["components.button"]!, profile.consumer); };
// The installed package barrel stands in as an unstamped implementation: any stamp in the render is the consumer index's.
const PackageButton = forwardRef<HTMLButtonElement, Record<string, unknown>>(function PackageButton(props, ref) { return h("button", { type: "button", ...props, ref }); });
const EXTERNAL: Readonly<Record<string, unknown>> = { react: React, "react/jsx-runtime": JsxRuntime, [COMPONENTS_PACKAGE_MODULE]: { Button: PackageButton } };
const page = dsAttrs("pages", "pages.home", "synthetic/pages.home"), section = dsAttrs("sections", SLOT, `synthetic/${SLOT}`);
/**
 * Server-renders the installed `sections.form` with exactly the bytes the library holds: its own owned files
 * plus the selected-component closure the emitter generates, linked by their relative imports.
 */
function renderForm(input: CompositeEngineInput): string {
  const files = new Map([...owned(input), ...(fillOf(input).bindings.length ? bound(input).componentFiles : [])].map(file => [file.path, file.content]));
  const cache = new Map<string, Record<string, unknown>>();
  const load = (path: string): Record<string, unknown> => {
    if (cache.has(path)) return cache.get(path)!;
    const exports: Record<string, unknown> = {};
    cache.set(path, exports);
    const { outputText } = ts.transpileModule(files.get(path)!, { fileName: path.startsWith("sections/") ? path.replace(/\.ts$/, ".tsx") : path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
    new Function("require", "exports", outputText)((id: string) => {
      if (!id.startsWith(".")) { if (!Object.hasOwn(EXTERNAL, id)) throw new Error(`unexpected import ${id}`); return EXTERNAL[id]; }
      const target = posix.join(posix.dirname(path), id).replace(/\.js$/, "");
      const hit = [target, `${target}.ts`, `${target}.tsx`].find(candidate => files.has(candidate));
      if (!hit) throw new Error(`unlinked import ${id} from ${path}`);
      return load(hit);
    }, exports);
    return exports;
  };
  const { Form } = load(fillOf(input).impl.entry) as { Form: ComponentType };
  return renderToStaticMarkup(h("div", page, h("section", section, h(Form))));
}
const renderedFills = (html: string) => [...html.matchAll(/<button[^>]*data-ds-fill="([^"]*)"/g)].map(match => match[1]);
/** WL7 from the DOM scan of one render against a `components.button` selection. */
const scanWl7 = (html: string, button: string) => scanProvenance({ html, route: { id: "home", binding: { frame: { leaf: "frames.site" }, frameSlots: {}, sections: { body: [{ leaf: SLOT }] } } }, selection: { "components.button": button, [SLOT]: `synthetic/${SLOT}` } }).findings.filter(row => row.code === "WL7");
/**
 * The only error findings a correctly bound synthetic derivation keeps, both outside this rule:
 * - the stamped consumer index imports `react`, and the host evidence reader yields no row for a bare
 *   package (its subpath `./` never matches an `exports` key `.`), so that closure edge stays unproven;
 * - this synthetic corpus records no independent type/closure measurement (S8).
 * Any binding, dependency or selection finding beyond these fails the pin.
 */
const errorsOf = (input: CompositeEngineInput) => resolve(input).surfaces!.check.findings.filter(row => row.severity === "error").map(row => `${row.code} ${row.message}`);
const RESIDUAL = ["S4 unproven selected dependency react", "S8 independent current type/closure measurement missing"];
const apply = (input: CompositeEngineInput, changes: Parameters<typeof applyLibraryChange>[2]["changes"], surfaceBundles: Parameters<typeof applyLibraryChange>[2]["surfaceBundles"], options: Parameters<typeof applyLibraryChange>[3]) => applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes, surfaceBundles }, options);

/** Adopts, registers the rule and derives `sections.form` while the package Button is selected. */
async function derived() {
  const f = await swapSurface();
  const adopted = await f.adopt();
  f.register(adopted.base);
  const first = await f.derive();
  f.input.library = apply(f.input, [first.change], [first.bundle], f.options());
  return { f, first };
}

describe("bind-selected-components@1 swap-through", () => {
  it("re-binds the package Button import to the consumer component-index and declares it as an input", async () => {
    const { f, first } = await derived();
    const fill = fillOf(f.input);
    expect(fill.origin).toMatchObject({ kind: "derived", rule: BIND_SELECTED_COMPONENTS });
    expect(fill.bindings).toEqual([{ file: "sections/form/Form.ts", module: "../../components/button/index.js", name: "Button", local: "Button", slot: "components.button" }]);
    // The package-backed consumer index re-exports the package, so the selected closure still reaches it.
    expect(fill.dependencies.map(row => row.module)).toEqual([COMPONENTS_PACKAGE_MODULE]);
    expect(form(f.input)).toContain('import { Button } from "../../components/button/index.js";');
    expect(form(f.input)).not.toContain(COMPONENTS_PACKAGE_MODULE);
    expect(first.bundle.inputs.map(row => row.input)).toEqual([{ kind: "component", id: "components.button" }]);
    expect(errorsOf(f.input)).toEqual(RESIDUAL);
    expect(wl7(f.input)).toEqual([]);
  });

  it("re-selecting components.button to a Custom fill reaches the derived sections.form", async () => {
    const { f, first } = await derived();
    const before = closure(f.input), source = form(f.input);
    expect(before).toContain(COMPONENTS_PACKAGE_MODULE);
    // The re-selection alone leaves the derivation stale: its component input identity changed.
    expect(() => apply(f.input, [f.custom()], [], f.options())).toThrow(/S6 stale/);
    // Re-derived in the same change set, the section reaches the Custom fill through the consumer index.
    const staged = applyLibraryChange(f.input.catalog, { ...f.input.library, surfaces: undefined }, { baseHash: libraryHash({ ...f.input.library, surfaces: undefined }), changes: [f.custom()] }, f.options());
    const second = await f.derive({ ...staged, surfaces: f.input.library.surfaces });
    f.input.library = apply(f.input, [f.custom(), second.change], [second.bundle], f.options());
    expect(resolve(f.input).components.components["components.button"]!.origin.kind).toBe("authored");
    expect(second.bundle.inputsHash).not.toBe(first.bundle.inputsHash);
    // The section's own bytes are unchanged: the swap travels through the consumer index, not a rewrite.
    expect(form(f.input)).toBe(source);
    const after = closure(f.input);
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
    expect(after).toContain(`"data-ds-fill":"${selectedButton(f.input)}"`);
    expect(before).not.toContain(`"data-ds-fill":"${selectedButton(f.input)}"`);
    expect(errorsOf(f.input)).toEqual(RESIDUAL);
    expect(wl7(f.input)).toEqual([]);
  });

  it("bypassing the rule keeps the package Button: no selected stamp renders, and WL7 fires before and after a re-select", async () => {
    const f = await swapSurface();
    await f.adopt();
    const finding = { code: "WL7", severity: "error", file: "sections/form/Form.ts", line: 0, subject: SLOT, evidence: `imports ${COMPONENTS_PACKAGE_MODULE}#Button directly, so the selected components.button fill never reaches it; derive it through bind-selected-components@1` };
    expect(form(f.input)).toContain(`from "${COMPONENTS_PACKAGE_MODULE}"`);
    expect(renderedFills(renderForm(f.input))).toEqual([]);
    expect(wl7(f.input)).toEqual([finding]);
    f.input.library = apply(f.input, [f.custom()], [], f.options());
    expect(form(f.input)).toContain(`from "${COMPONENTS_PACKAGE_MODULE}"`);
    expect(renderedFills(renderForm(f.input))).toEqual([]);
    expect(wl7(f.input)).toEqual([finding]);
  });
  it("refuses a declared component that is not selected", async () => {
    const f = await swapSurface();
    const adopted = await f.adopt();
    f.register(adopted.base);
    f.register(adopted.base, ["components.button", "components.select"]);
    await expect(f.derive()).rejects.toThrow(/S6|surface input|unknown/);
  });

  it("the rendered sections.form Button's data-ds-fill changes from the package fill to the Custom fill", async () => {
    const { f } = await derived();
    const packageFill = selectedButton(f.input), before = renderForm(f.input);
    expect(renderedFills(before)).toEqual([packageFill]);
    expect(scanWl7(before, packageFill)).toEqual([]);
    const staged = applyLibraryChange(f.input.catalog, { ...f.input.library, surfaces: undefined }, { baseHash: libraryHash({ ...f.input.library, surfaces: undefined }), changes: [f.custom()] }, f.options());
    const second = await f.derive({ ...staged, surfaces: f.input.library.surfaces });
    f.input.library = apply(f.input, [f.custom(), second.change], [second.bundle], f.options());
    const customFill = selectedButton(f.input), after = renderForm(f.input);
    expect(customFill).not.toBe(packageFill);
    expect(renderedFills(after)).toEqual([customFill]);
    expect(scanWl7(after, customFill)).toEqual([]);
    // The pre-swap render against the new selection is exactly what WL7 exists to catch.
    expect(scanWl7(before, customFill).map(row => row.message)).toEqual([`renders ${packageFill}, selection is ${customFill}`]);
  });
});
