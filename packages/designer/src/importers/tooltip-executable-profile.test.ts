// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import React from "react";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { importShadcnAriaComponents, materializeShadcnComponent } from "./shadcn-aria-components.js";
import { tooltipExecutableSource, tooltipExecutableReads } from "./tooltip-executable-profile.js";
import { sha256 } from "../catalog-core/digest.js";
import timing from "../catalog/fills/foundry/tokens.behavior-timing.json" with { type: "json" };

const directory = resolve(import.meta.dirname, "__fixtures__/shadcn-aria");
const read = (name: string) => readFileSync(resolve(directory, name), "utf8");
const input = () => ({ items: readdirSync(directory).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"), styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") }, notice: { path: "LICENSE.md", content: read("LICENSE.md") } });
const bindings = (delay = 725, close = 0.18) => ({
  "tokens.behavior-timing.tooltip-delay": { value: delay, unit: "ms" as const },
  "tokens.behavior-timing.tooltip-close": { value: close, unit: "s" as const },
});
function generated() {
  const result = importShadcnAriaComponents(input());
  const files = materializeShadcnComponent(result, "tooltip");
  const source = files.find(file => file.path === "components/tooltip/tooltip.tsx")!;
  const Tooltip = () => null, Trigger = () => null, Focusable = () => null;
  const nativeRequire = createRequire(import.meta.url);
  const exports: Record<string, any> = {};
  const require = (name: string) => name === "react-aria-components" ? { Tooltip, TooltipTrigger: Trigger, Focusable, OverlayArrow: () => null, composeRenderProps: (value: any, compose: any) => typeof value === "function" ? (state: any) => compose(value(state), state) : compose(value) } : /\/_parts\/utils\/index(?:\.js)?$/.test(name) ? { cn: (...values: unknown[]) => values.filter(Boolean).join(" ") } : nativeRequire(name);
  const js = ts.transpileModule(source.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  new Function("require", "exports", js)(require, exports);
  return { result, files, source, exports, Tooltip, Trigger, Focusable };
}

describe("selected tooltip executable timing", () => {
  it("tooltip-consumer-duration-dispatch reads exact supplied member values and preserves explicit zero", () => {
    const { exports, Trigger, Focusable } = generated();
    const children = [React.createElement("button", { key: "trigger" }, "Help"), React.createElement("span", { key: "tip" }, "Details")];
    const onOpenChange = () => {};
    const rendered = exports.TooltipTrigger({ children, behaviorTiming: bindings(), onOpenChange, isDisabled: true });
    expect(rendered.type).toBe(Trigger);
    expect(rendered.props).toMatchObject({ delay: 725, closeDelay: 180, onOpenChange, isDisabled: true });
    expect(rendered.props).not.toHaveProperty("behaviorTiming");
    expect(rendered.props.children[0].type).toBe(Focusable);
    expect(rendered.props.children[1].type).toBe("span");
    expect(exports.TooltipTrigger({ children, behaviorTiming: bindings(40, 0.9) }).props).toMatchObject({ delay: 40, closeDelay: 900 });
    expect(exports.TooltipTrigger({ children, behaviorTiming: bindings(), delay: 0, closeDelay: 0 }).props).toMatchObject({ delay: 0, closeDelay: 0 });
    expect(exports.readTooltipTiming(bindings(0, 0))).toEqual({ delay: 0, closeDelay: 0 });
  });
  it("reads the existing behavior-timing dataset leaves, never invented token names", () => {
    const { exports } = generated();
    const leaves = timing.tokens["behavior-timing"] as Record<string, { $value: { value: number; unit: "ms" | "s" } }>;
    const resolved = Object.fromEntries(tooltipExecutableReads.map(read => {
      const leaf = read.replace(/^themes\.behavior-timing\./, "");
      expect(leaves[leaf], read).toBeDefined();
      return [read, leaves[leaf]!.$value];
    }));
    const children = [React.createElement("button", { key: "trigger" }, "Help"), React.createElement("span", { key: "tip" }, "Details")];
    expect(exports.TooltipTrigger({ children, behaviorTiming: resolved }).props).toMatchObject({ delay: leaves["tooltip-delay"]!.$value.value, closeDelay: leaves["tooltip-close"]!.$value.value });
  });
  it("missing or invalid timing input is an explicit source binding error, never a default", () => {
    const { exports } = generated();
    for (const value of [undefined, {}, { ...bindings(), "tokens.behavior-timing.tooltip-delay": { value: -1, unit: "ms" } }, { ...bindings(), "tokens.behavior-timing.tooltip-close": { value: Infinity, unit: "s" } }, { ...bindings(), "tokens.behavior-timing.tooltip-close": { value: 1, unit: "px" } }, { ...bindings(), "tokens.behavior-timing.tooltip-delay": { value: "500", unit: "ms" } }]) {
      expect(() => exports.readTooltipTiming(value)).toThrow(/tooltip timing binding/);
    }
    expect(() => exports.TooltipTrigger({ children: [] })).toThrow(/tooltip timing binding/);
  });
  it("tooltip-trigger-root-ref-render preserves the native root, ref, state and render props", () => {
    const { exports, Tooltip } = generated();
    const ref = { current: null }, state = { isEntering: true, placement: "left" };
    const content = exports.Tooltip({ ref, placement: "left", className: (value: unknown) => value === state ? "caller" : "wrong", children: (value: unknown) => value === state ? "content" : "wrong", style: { opacity: 0.8 }, "aria-label": "Details" });
    expect(content.type).toBe(Tooltip);
    expect(content.props).toMatchObject({ ref, placement: "left", style: { opacity: 0.8 }, "aria-label": "Details" });
    expect(content.props.className(state)).toContain("caller");
    expect(content.props.children(state).props.children[0]).toBe("content");
  });
  it("df1-pin-output-notice-domains keeps authenticated inputs and current output separate without runtime claims", () => {
    const { result, files, source } = generated();
    const doc = result.fills.find(doc => doc.components.tooltip)!, fill = doc.components.tooltip!;
    expect(fill.pin!.files).toContainEqual({ path: "apps/v4/registry/bases/aria/ui/tooltip.tsx", sha256: "4cc80f882fec4abad1512f0d35d330603d653169ac210b27c12de10a09458d64" });
    expect(fill.reads.themes).toEqual(expect.arrayContaining(tooltipExecutableReads));
    for (const file of files) expect(fill.outputSha256).toContainEqual({ path: file.path, sha256: sha256(file.content) });
    expect(files.find(file => file.path === fill.notice)!.content).toContain(read("LICENSE.md"));
    expect(doc.$extensions["com.clossys.fill"]).toMatchObject({ status: "draft", evidence: [], conforms: [] });
    expect(fill).not.toHaveProperty("measurements");
    expect(() => tooltipExecutableSource({ ...source, content: source.content + " " })).toThrow(/receipt differs/);
  });
});
