import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Scene } from "./Scene.js";
import { scanCompiledCssSources } from "../../compiled-css/scan-sources.js";
import type { SceneInput } from "./types.js";
const sourceDir = dirname(fileURLToPath(import.meta.url));
const rows = [{ id: "amount", label: "Amount", value: "12.0M", figure: true }, { id: "limit", label: "Limit", value: "15.0M" }];
const sources = ["agreement", "report", "schedule"].map(id => ({ id, format: "pdf" as const, title: id, origin: "Archive" }));
const inputs: SceneInput[] = [
 { template: "converge", seed: "fixture", sources: { heading: "Documents", items: sources }, target: { heading: "Record", title: "Facility", rows }, relations: sources.map((s, i) => ({ from: s.id, to: rows[i % 2]!.id })) },
 { template: "evidence-trail", seed: "fixture", sources: sources.slice(0, 2).map((s, i) => ({ ...s, cites: rows[i]!.id, cite: "p. 2" })), result: { title: "Result", rows, status: { tone: "warning", text: "Review" }, person: { initials: "RR", name: "Review role", note: "Prepared" } } },
 { template: "approval-chain", seed: "fixture", prepared: { heading: "Prepared" }, findings: ["first", "second"].map((id, i) => ({ id, fn: "Review", title: id, subjectOf: "Facility", status: { tone: "info", text: "Prepared" }, ...(i === 0 ? { subject: true as const } : {}) })), node: { label: "Sent for review" }, decision: { title: "Decision", rows, status: { tone: "success", text: "Decided" }, person: { initials: "RR", name: "Review role", note: "Decider" } } },
];
const view = (input: SceneInput, id = "scene-a") => <Scene id={id} input={input} label="Documents and prepared findings flow into a record and a named decision role." relationLabel="Sources" sample="Sample data." />;
describe("Scene", () => {
 it.each(inputs)("keeps a full accessible linear form and stable instance ids: $template", input => {
  const { container } = render(<>{view(input)}{view(input, "scene-b")}</>);
  const ids = [...container.querySelectorAll("[id]")].map(n => n.id); expect(new Set(ids).size).toBe(ids.length);
  for (const figure of container.querySelectorAll("figure")) {
   const name = figure.getAttribute("aria-labelledby")!; expect(figure.querySelector(`[id="${name}"]`)).toBeTruthy();
   const svg = figure.querySelector("[data-scene-desk] svg")!; expect(svg).toHaveAttribute("aria-hidden", "true"); expect(svg).toHaveAttribute("focusable", "false"); expect(svg.querySelector("title")).toBeNull();
   const linear = figure.querySelector("[data-scene-linear]")!; expect(linear).not.toHaveAttribute("aria-hidden"); expect(linear).toHaveClass("scene-linear");
   const terms = input.template === "approval-chain" ? ["first", "second", "Facility", "Sent for review", "Decider"] : ["agreement", "report", "Archive", ...(input.template === "converge" ? ["schedule"] : ["p. 2"])];
   for (const term of terms) expect(linear.textContent).toContain(term);
   expect(linear.querySelectorAll("[data-scene-row]")).toHaveLength(2);
   expect(figure.querySelector("[tabindex], [href], button, input, select, textarea, script, animate, animateTransform")).toBeNull();
  }
 });
 it.each(inputs)("has byte-identical static rendering with no handlers or animation: $template", input => { const a = renderToStaticMarkup(view(input)); expect(a).toBe(renderToStaticMarkup(view(input))); expect(a).not.toMatch(/\son\w+=|<script|<animate|animation/); });
 it("pins the actual live right-middle pivot recipe and clipped responsive form", () => {
  const css = readFileSync(resolve(sourceDir, "../../../styles/theme-keys.css"), "utf8");
  expect(css).toContain("transform-origin: 100% 50%"); expect(css).toContain("transform-box: fill-box"); expect(css).toContain("rotate: calc(var(--k, 0) * var(--ui-scene-tilt, 1deg))");
  for (const threshold of [800, 520, 900]) expect(css).toContain(`min-width: ${threshold}px`);
  expect(css).toContain("clip-path: inset(50%)"); expect(css).not.toMatch(/\[data-scene-linear\][^{]*\{[^}]*display:\s*none/);
  const { container } = render(view(inputs[0]!)); for (const part of container.querySelectorAll("[data-pivot]")) expect(part).toHaveAttribute("data-pivot", "anchor");
 });
 it("uses live radius, theme paints, fixed start-aligned values and a sole accent ring", () => {
  const css = readFileSync(resolve(sourceDir, "../../../styles/theme-keys.css"), "utf8");
  for (const token of ["--radius-panel", "--color-surface-raised", "--color-surface-sunken", "--color-ink-secondary", "--color-line-strong", "--color-accent", "--ui-scene-card-w"]) expect(css).toContain(`var(${token},`);
  const { container } = render(view(inputs[2]!)); expect(container.querySelectorAll("[data-scene-desk] .scene-accent")).toHaveLength(1); expect(container.querySelector("[data-scene-desk] .scene-accent")?.tagName).toBe("circle");
  expect(container.querySelectorAll(".scene-wire-subject")).toHaveLength(2); expect(container.querySelector("[text-anchor=end]")).toBeNull();
 });
 it("keeps full long titles in linear HTML while truncating only SVG copy", () => {
  const input = inputs[0]!; if (input.template !== "converge") throw Error();
  const title = "A complete document title with substantially more than twenty eight characters";
  const { container } = render(view({ ...input, sources: { ...input.sources, items: input.sources.items.map((s, i) => i ? s : { ...s, title }) } }));
  expect(container.querySelector("[data-scene-linear]")?.textContent).toContain(title);
  expect(container.querySelector("[data-scene-desk]")?.textContent).toContain("…");
 });
 it("publishes source exports, static recipes and only numeric layout custom properties", async () => {
  const server = await import("../server.js"); expect(server.Scene).toBe(Scene); expect(typeof server.layoutScene).toBe("function"); expect(typeof server.sceneRelationText).toBe("function");
  const source = readFileSync(resolve(sourceDir, "Scene.tsx"), "utf8"); expect(source).not.toMatch(/useId|useState|useEffect|useRef|use client/);
  const css = readFileSync(resolve(sourceDir, "../../../styles/theme-keys.css"), "utf8").split("/* Static scenes:")[1]!;
  expect(css).not.toMatch(/var\(--[\w-]+\)/); expect(css).not.toMatch(/animation|transition|#[a-fA-F0-9]{3,8}/);
  const { container } = render(view(inputs[0]!)); for (const node of container.querySelectorAll<HTMLElement>("[style]")) for (const property of Array.from({ length: node.style.length }, (_, i) => node.style.item(i))) expect(["--k", "--sc-w"]).toContain(property);
 });
 it("accepts authored rich labels, zero, and an omitted relation label", () => {
  const { container } = render(<Scene id="rich" input={inputs[0]!} label={<em>Document provenance</em>} />);
  expect(container.querySelector("#rich-label em")).toHaveTextContent("Document provenance");
  expect(() => renderToStaticMarkup(<Scene id="zero" input={inputs[0]!} label={0} />)).not.toThrow();
 });
 it("keeps non-title SVG values, status, metadata and citations intact", () => {
  const input = inputs[1]!; if (input.template !== "evidence-trail") throw Error();
  const value = "123456789.00", status = "A complete review status", meta = "A complete dated source statement with a recorded basis";
  const { container } = render(view({ ...input, sources: input.sources.map(s => ({ ...s, cite: "Clause 21.2(b)" })), result: { ...input.result, meta, status: { tone: "warning", text: status }, rows: [{ ...input.result.rows[0]!, value }, input.result.rows[1]!] } }));
  const svg = container.querySelector("[data-scene-desk]")!; for (const text of [value, status, meta, "Clause 21.2(b)"]) expect(svg.textContent).toContain(text);
 });
 it("exposes the Scene recipes to the source class scan without compiling CSS", () => {
  const candidates = scanCompiledCssSources(resolve(sourceDir, "../../..")).candidates;
  for (const name of ["scene-root", "scene-desktop", "scene-tilt", "scene-linear", "scene-wire-subject", "scene-subject-outline", "scene-accent", "scene-status-success", "scene-status-info", "scene-status-neutral"]) expect(candidates).toContain(name);
 });
 it("requires a caller instance id and nonblank authored label", () => { expect(() => renderToStaticMarkup(<Scene id="" input={inputs[0]!} label="Process" relationLabel="Sources" />)).toThrow(TypeError); expect(() => renderToStaticMarkup(<Scene id="x" input={inputs[0]!} label="" />)).toThrow(TypeError); });
});
