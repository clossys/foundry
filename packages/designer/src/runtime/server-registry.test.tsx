import { isValidElement, Suspense, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { RuntimeRenderInput } from "../catalog-core/runtime-ports.js";
import { surfaceRuntimeRenderers as clientRenderers, surfaceRuntimeCallbacks as clientCallbacks, surfaceRuntimePointers as clientPointers } from "./index.js";
import { surfaceRuntimeRenderers, surfaceRuntimeCallbacks, surfaceRuntimePointers, surfaceRendererId, SURFACE_RUNTIME_POINTER } from "./server-registry.js";
import * as components from "../components/index.js";
import { specimenDataset } from "../studio/specimen-dataset.js";

afterEach(cleanup);

it("preserves the complete client renderer, pointer and callback key sets", () => {
  expect(Object.keys(surfaceRuntimeRenderers).sort()).toEqual(Object.keys(clientRenderers).sort());
  expect(surfaceRuntimePointers()).toEqual(clientPointers());
  expect(Object.keys(surfaceRuntimeCallbacks()).sort()).toEqual(Object.keys(clientCallbacks()).sort());
  for (const [leaf, entry] of Object.entries(surfaceRuntimeRenderers)) {
    expect(entry.leaf).toBe(leaf);
    expect(surfaceRuntimePointers()[leaf]).toEqual(SURFACE_RUNTIME_POINTER);
    expect(() => surfaceRuntimeCallbacks([leaf])[surfaceRendererId(leaf)]!({} as never)).toThrow(/component index/);
  }
  expect(surfaceRuntimeCallbacks([])).toEqual({});
  expect(() => surfaceRuntimeCallbacks(["sections.missing"])).toThrow(/no package renderer/);
});

it("keeps server document, site and auth frames on their original renderers", () => {
  for (const leaf of ["frames.document", "frames.site-shell", "frames.auth-shell"]) {
    const sample = clientRenderers[leaf]!.sample(specimenDataset);
    const input = { fill: { leaf }, selection: { leaf, members: [] }, content: Object.fromEntries(Object.entries(sample).map(([slot, value]) => [slot, { value }])), slots: leaf === "frames.document" ? { body: ["Body"] } : { main: ["Body"] } } as unknown as RuntimeRenderInput<ReactNode>;
    const actual = surfaceRuntimeRenderers[leaf]!.render(input), original = clientRenderers[leaf]!.render(input);
    expect(isValidElement(actual) && isValidElement(original) && actual.type === original.type).toBe(true);
    // Site shells allocate their own copy/asset resolvers. Compare their rendered output,
    // exercising those resolvers instead of requiring function allocation identity.
    expect(renderToStaticMarkup(<>{actual}</>)).toBe(renderToStaticMarkup(<>{original}</>));
    expect(renderToStaticMarkup(<>{actual}</>)).toContain("Body");
  }
});

it("passes the full host input through the client reference without dropping callbacks", () => {
  const onNavigate = () => undefined;
  const input = { host: { onNavigate }, sectionHost: { onCommand: () => undefined }, slots: { main: ["Body"] } } as unknown as RuntimeRenderInput<ReactNode>;
  const node = surfaceRuntimeRenderers["frames.app-shell"]!.render(input);
  expect(isValidElement<{ input: RuntimeRenderInput<ReactNode> }>(node)).toBe(true);
  if (!isValidElement<{ input: RuntimeRenderInput<ReactNode> }>(node)) throw new Error("Missing client reference");
  expect(node.props.input).toBe(input);
  expect(node.props.input.host?.onNavigate).toBe(onNavigate);
});

it("renders actual section content after resolving the client reference", async () => {
  const leaf = "sections.logo-mark", asset = specimenDataset.assets.mark;
  const input = {
    components: { ...components, Logo: components.Logomark }, fill: { leaf, slots: ["mark"], members: [] }, selection: { leaf, members: [] },
    content: { mark: { value: { slot: asset.slot, member: asset.member, src: asset.src, name: "Example mark" } } },
  } as unknown as RuntimeRenderInput<ReactNode>;
  const { container } = render(<Suspense fallback={<span>Loading</span>}>{surfaceRuntimeRenderers[leaf]!.render(input)}</Suspense>);
  expect(await screen.findByRole("img", { name: "Example mark" })).toBeInTheDocument();
  expect(container.querySelector("img")).toHaveAttribute("src", asset.src);
  expect(container.querySelector("section")).toHaveAttribute("data-ds-leaf", leaf);
});
