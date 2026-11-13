import { isValidElement, Suspense, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { RuntimeRenderInput } from "../catalog-core/runtime-ports.js";
import { surfaceRuntimeRenderers as clientRenderers, surfaceRuntimeCallbacks as clientCallbacks, surfaceRuntimePointers as clientPointers } from "./index.js";
import { surfaceRuntimeRenderers, surfaceRuntimeCallbacks, surfaceRuntimePointers, surfaceRendererId, SURFACE_RUNTIME_POINTER } from "./server-registry.js";
import { specimenDataset } from "../studio/specimen-dataset.js";
import { ConsumerComponentProvider } from "./component-leaf.client.js";
import { fixtureConsumerComponents } from "../catalog-core/__fixtures__/surface-consumer-components.js";

afterEach(cleanup);

it("preserves the complete client renderer, pointer and callback key sets", () => {
  expect(Object.keys(surfaceRuntimeRenderers).sort()).toEqual(Object.keys(clientRenderers).sort());
  expect(surfaceRuntimePointers()).toEqual(clientPointers());
  expect(Object.keys(surfaceRuntimeCallbacks()).sort()).toEqual(Object.keys(clientCallbacks()).sort());
  for (const [leaf, entry] of Object.entries(surfaceRuntimeRenderers)) {
    expect(entry.leaf).toBe(leaf);
    expect(surfaceRuntimePointers()[leaf]).toEqual(SURFACE_RUNTIME_POINTER);
    expect(surfaceRuntimeCallbacks([leaf])).toEqual({ [surfaceRendererId(leaf)]: entry.render });
  }
  expect(surfaceRuntimeCallbacks([])).toEqual({});
  expect(() => surfaceRuntimeCallbacks(["sections.missing"])).toThrow(/no package renderer/);
});

it("keeps server document, site and auth frames on their original renderers", () => {
  for (const leaf of ["frames.document", "frames.site-shell", "frames.auth-shell"])
    expect(surfaceRuntimeRenderers[leaf]).toBe(clientRenderers[leaf]);
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
    fill: { leaf, slots: ["mark"], members: [] }, selection: { leaf, members: [] },
    content: { mark: { value: { slot: asset.slot, member: asset.member, src: asset.src, name: "Example mark" } } },
  } as unknown as RuntimeRenderInput<ReactNode>;
  // The module namespace stays in this client host provider, outside the
  // serializable input delivered through the server surface reference.
  const { container } = render(<ConsumerComponentProvider value={fixtureConsumerComponents()}><Suspense fallback={<span>Loading</span>}>{surfaceRuntimeRenderers[leaf]!.render(input)}</Suspense></ConsumerComponentProvider>);
  expect(await screen.findByRole("img", { name: "Example mark" })).toBeInTheDocument();
  expect(container.querySelector("img")).toHaveAttribute("src", asset.src);
  expect(container.querySelector("section")).toHaveAttribute("data-ds-leaf", leaf);
});

it("refuses to serialize a live consumer module index across a server reference", () => {
  const { profile: _profile, ...componentIndex } = fixtureConsumerComponents();
  const input = { componentIndex } as unknown as RuntimeRenderInput<ReactNode>;
  expect(() => surfaceRuntimeRenderers["sections.logo-mark"]!.render(input)).toThrow(/install the module index in the client host/);
});

it("binds the live module index through the public client runtime callback", async () => {
  const leaf = "sections.logo-mark", asset = specimenDataset.assets.mark;
  const { profile, ...componentIndex } = fixtureConsumerComponents();
  const input = {
    profile, componentIndex,
    fill: { leaf, slots: ["mark"], members: [] }, selection: { leaf, members: [] },
    content: { mark: { value: { slot: asset.slot, member: asset.member, src: asset.src, name: "Selected runtime mark" } } },
  } as unknown as RuntimeRenderInput<ReactNode>;
  const { container } = render(<Suspense>{clientCallbacks([leaf])[surfaceRendererId(leaf)]!(input)}</Suspense>);
  expect(await screen.findByRole("img", { name: "Selected runtime mark" })).toBeInTheDocument();
  expect(container.querySelector("img")).toHaveAttribute("src", asset.src);
});
