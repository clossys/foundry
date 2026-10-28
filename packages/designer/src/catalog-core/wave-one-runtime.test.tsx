// @vitest-environment node
/** Installed-package SSR wiring proof, following Publisher's site-shell runtime harness. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { emit, resolve } from "../../dist/catalog-core/api.js";
import { dsAttrs, loadBuildCatalog, planSurfaceRuntime, prepareRuntimeAssembly, runtimeHash, scanProvenance } from "../../dist/catalog-core/index.js";
import type { CompositeEngineInput } from "../../dist/catalog-core/types.js";
import type { RuntimeAssemblyInput, RuntimeContentRef, RuntimeFillSelection, RuntimeJson, SurfacePackageEvidence } from "../../dist/catalog-core/index.js";
import { surfaceRendererId, surfaceRuntimeCallbacks, surfaceRuntimePointers, surfaceRuntimeRenderers } from "../../dist/frames/index.js";
import { packageSurfaceLibrary } from "../../dist/library-cli/__fixtures__/package-surface-library.js";
import { packageBarrelExports } from "../../dist/library-cli/surface-package-evidence.js";
import { specimenDataset } from "../../dist/studio/specimen-dataset.js";

const FRAME = "frames.auth-shell", LOGO = "sections.logo-mark", SIGN_IN = "sections.sign-in-form", ERROR = "sections.error-message";
const WAVE_ONE = [FRAME, LOGO, SIGN_IN, "sections.boundary-message", ERROR, "sections.legal-prose", "sections.account-summary"];
// jsdom is an installed test peer without declarations; keep its parser port explicit.
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string) => { window: { document: Document } } };
let engine: CompositeEngineInput, packages: readonly SurfacePackageEvidence[];
beforeAll(async () => {
  const fixture = await packageSurfaceLibrary();
  engine = { catalog: fixture.catalog, library: fixture.library, surfaceOptions: fixture.options };
  // As in the site-shell proof, the shell lease needs evidence even though no surface fill points at it.
  const shell = readFileSync(new URL("../../dist/shell/index.js", import.meta.url), "utf8");
  const inventory = packageBarrelExports(shell);
  packages = [...fixture.packages, { module: "@clossys/designer/shell", version: "0.0.0", artifactSha256: createHash("sha256").update(shell).digest("hex"), values: inventory.values, types: inventory.types }];
}, 180_000);

/** Bind every renderer sample through the registered content kind, never directly construct a Section or Frame. */
function assembly(sectionLeaves: readonly string[], overrides: Readonly<Record<string, Readonly<Record<string, RuntimeJson>>>> = {}) {
  const profile = resolve(engine), contracts = { ...loadBuildCatalog(), slots: [...engine.catalog.surfaces!.slots] };
  const mark = profile.values.members["assets.mark.reversed"]!;
  expect(mark.slot).toBe("assets.mark");
  expect(engine.catalog.values.slots.find(slot => slot.id === "assets.mark")!.contract.members).toMatchObject({ mode: "closed", names: expect.arrayContaining(["reversed"]) });
  expect(typeof mark.value.light).toBe("string");
  const artwork = mark.value.light as string, markSrc = `data:image/svg+xml,${encodeURIComponent(artwork)}`;
  expect(artwork).toMatch(/<svg[\s>]/);
  const usesLogo = sectionLeaves.includes(LOGO);
  const plan = planSurfaceRuntime({ engine, packages, renderers: surfaceRuntimePointers(), leaves: [FRAME, ...sectionLeaves], assets: { complete: true, ids: usesLogo ? ["assets.mark"] : [] } });
  expect(plan.gaps).toEqual([]);
  const values = new Map<string, RuntimeJson>();
  const select = (leaf: string): RuntimeFillSelection => {
    const contract = contracts.slots.find(slot => slot.id === leaf)!.contract;
    if (contract.kind !== "frame" && contract.kind !== "section") throw new Error(`No surface contract for ${leaf}`);
    const sample = { ...surfaceRuntimeRenderers[leaf]!.sample(specimenDataset), ...(leaf === LOGO ? { mark: { slot: mark.slot, member: "reversed", src: markSrc } } : {}), ...overrides[leaf] };
    const content = Object.fromEntries(Object.entries(sample).map(([slot, value]) => {
      const kind = contract.kind === "section" ? contract.slots.find(row => row.name === slot)!.type : "region";
      const reference = { kind, ref: `content:${leaf}:${slot}` } as RuntimeContentRef;
      values.set(reference.ref, value);
      return [slot, reference];
    }));
    const descriptor = plan.manifest.fills.find(fill => fill.leaf === leaf)!;
    return { leaf: descriptor.leaf, fill: descriptor.fill, config: null, members: [], content };
  };
  const frame = plan.manifest.fills.find(fill => fill.leaf === FRAME)!;
  const binding = { id: "wave-one", frame: select(FRAME), frameSlots: {}, sections: { body: sectionLeaves.map(select) } };
  const css = emit(profile, ["css-brand", "css-scales"]).map(file => ({ id: file.path, contents: file.contents }));
  const input: RuntimeAssemblyInput<ReactNode> = {
    identity: { kind: "artifact", name: "wave-one installed package runtime", sha256: runtimeHash(packages) }, engine, contracts,
    ports: { manifest: plan.manifest, renderers: surfaceRuntimeCallbacks([FRAME, ...sectionLeaves]), resolveContent: reference => {
      const value = values.get(reference.ref);
      return value === undefined ? undefined : { reference, value, hash: runtimeHash(value) };
    } },
    binding,
    layout: {
      descriptor: { library: engine.library.source.id, fill: "wave-one/layout", leaf: "layouts.stack", config: "single", members: {}, slots: [{ id: "body", min: 1, max: sectionLeaves.length, accepts: sectionLeaves as `sections.${string}`[] }], breakpoints: [], states: ["default"], renderer: frame.renderer },
      render: ({ slots }) => <>{slots.body}</>, expectedOrder: (_cell, paths) => paths.body!,
    },
    themes: ["light"], states: ["default"], css,
    assets: usesLogo ? [{ id: "assets.mark", mediaType: "image/svg+xml", bytes: [...new TextEncoder().encode(artwork)] }] : [],
    breakpointPixels: Object.fromEntries(Object.entries(profile.values.members).filter(([id]) => id.startsWith("tokens.breakpoint.")).flatMap(([id, member]) => {
      const value = member.value.light as { unit: string; value: number };
      return value.unit === "px" ? [] : [[id, Math.round(value.value * 16)]];
    })),
    breakpointBasis: { renderer: frame.renderer, environment: { rootFontSize: 16 } },
  };
  return { input, plan, artwork, markSrc };
}

function draw(sectionLeaves: readonly string[], overrides: Parameters<typeof assembly>[1] = {}) {
  const fixture = assembly(sectionLeaves, overrides), prepared = prepareRuntimeAssembly(fixture.input);
  expect(prepared.status, JSON.stringify(prepared)).toBe("ready");
  if (prepared.status !== "ready") throw new Error(prepared.findings.join("; "));
  const node = prepared.assembly.render(prepared.assembly.snapshot.cells[0]!);
  const html = renderToStaticMarkup(<div {...dsAttrs("pages", "pages.wave-one", "consumer/pages.wave-one")}>{node}</div>);
  const document = new JSDOM(html).window.document;
  const frame = document.querySelector(`[data-ds-leaf="${FRAME}"]`)!;
  expect(frame, "the package-owned AuthFrame must render").not.toBeNull();
  expect(frame.hasAttribute("data-frame-root")).toBe(true);
  expect(frame.getAttribute("data-ds-fill")).toBe(fixture.plan.origins[fixture.input.binding.frame.fill]);
  expect(frame.querySelectorAll("main")).toHaveLength(1);
  const main = frame.querySelector("main")!;
  expect(main.getAttribute("tabindex")).toBe("-1");
  const skip = frame.querySelector(`a[href="#${main.id}"]`)!;
  expect(skip, "the skip link must target AuthFrame's actual main").not.toBeNull();
  expect(skip.textContent).toBe(specimenDataset.frames.app.skipLabel);
  expect(frame.querySelector("header,footer,nav")).toBeNull();
  const stamped = [...document.querySelectorAll("[data-ds-leaf][data-ds-fill]")];
  const selection = Object.fromEntries(stamped.map(node => [node.getAttribute("data-ds-leaf")!, node.getAttribute("data-ds-fill")!]));
  for (const fill of fixture.plan.manifest.fills) selection[fill.leaf] = fill.fill;
  const provenance = scanProvenance({ html, route: { id: "wave-one", binding: fixture.input.binding }, selection, fillOrigins: fixture.plan.origins });
  expect(provenance.findings).toEqual([]);
  for (const leaf of sectionLeaves) {
    expect(main.querySelector(`[data-ds-leaf="${leaf}"]`), `${leaf} must reach AuthFrame's main slot`).not.toBeNull();
    expect(provenance.observations.map(row => `${row.from} -> ${row.to}`)).toContain(`${FRAME} -> ${leaf}`);
  }
  return { ...fixture, document, frame, main, html, snapshot: prepared.assembly.snapshot };
}

describe("wave-one installed package → consumer library → runtime assembly → SSR", () => {
  it("plans all seven registered leaves from installed artifact evidence and actual package callbacks", () => {
    const plan = planSurfaceRuntime({ engine, packages, renderers: surfaceRuntimePointers(), leaves: WAVE_ONE });
    expect(plan.gaps).toEqual([]);
    expect(plan.manifest.fills.map(fill => fill.leaf)).toEqual(WAVE_ONE);
    for (const fill of plan.manifest.fills) {
      expect(fill.renderer.id).toBe(surfaceRendererId(fill.leaf));
      expect(Object.values(fill.renderer.source.files)).toEqual([`import { surfaceRuntimeRenderers } from "@clossys/designer/frames";\nexport default surfaceRuntimeRenderers[${JSON.stringify(fill.leaf)}].render;\n`]);
      expect(fill.renderer.source.dependencies["@clossys/designer"]?.artifact).toBe(`sha256:${packages.find(row => row.module === "@clossys/designer/frames")!.artifactSha256}`);
      expect(surfaceRuntimeCallbacks([fill.leaf])[fill.renderer.id]).toBe(surfaceRuntimeRenderers[fill.leaf]!.render);
      expect(plan.origins[fill.fill]).toBe(`foundry/${fill.leaf}`);
    }
  });

  it("renders the real sign-in Section inside the real AuthFrame with consumer-authored content", () => {
    const { main } = draw([SIGN_IN], { [SIGN_IN]: {
      header: { heading: "Access your library", description: "Continue with your library credentials." },
      credentials: { identifierLabel: "Library account", passwordLabel: "Library password" },
    } });
    const section = main.querySelector(`[data-ds-leaf="${SIGN_IN}"]`)!;
    expect(section.querySelector("h1,h2")!.textContent).toBe("Access your library");
    expect(section.textContent).toContain("Continue with your library credentials.");
    const form = section.querySelector("form")!;
    expect(form, "actual sign-in form must be composed").not.toBeNull();
    expect(form.textContent).toContain("Library account");
    expect(form.textContent).toContain("Library password");
    expect(form.querySelector('input[name="identifier"]')?.getAttribute("autocomplete")).toBe("username");
    expect(form.querySelector('input[name="password"]')?.getAttribute("type")).toBe("password");
    expect(form.querySelector('button[type="submit"]')?.textContent).toBe("Sign in");
    expect(section.querySelector("main,header,footer")).toBeNull();
  });

  it("renders a logo-only opening Section from registered consumer artwork with zero visible copy", () => {
    const { main, markSrc, artwork, input, snapshot } = draw([LOGO]);
    const section = main.querySelector(`[data-ds-leaf="${LOGO}"]`)!;
    expect(section.querySelectorAll("img")).toHaveLength(1);
    expect(section.querySelector("img")!.getAttribute("src")).toBe(markSrc);
    expect(section.querySelector("img")!.getAttribute("alt")).toBe("");
    expect(section.textContent).toBe("");
    expect(section.querySelector("h1,h2,h3,p,a,button")).toBeNull();
    expect(section.hasAttribute("data-designer-section-frame")).toBe(true);
    expect(main.querySelector('[data-ds-leaf="sections.logo-hero"]')).toBeNull();
    expect(input.ports.manifest.assetClosure).toEqual({ complete: true, ids: ["assets.mark"] });
    expect(new TextDecoder().decode(new Uint8Array(input.assets[0]!.bytes))).toBe(artwork);
    expect((snapshot.data as { assets: unknown }).assets).toEqual(input.assets);
    expect(Object.keys(input.binding.sections.body![0]!.content)).toEqual(["mark"]);
  });

  it("requires concrete registered logo bytes before invoking the runtime renderers", () => {
    const { input } = assembly([LOGO]);
    expect(prepareRuntimeAssembly({ ...input, assets: [] })).toMatchObject({ status: "pending", findings: [expect.stringContaining("concrete runtime asset bytes missing: assets.mark")] });
  });

  it("composes a standalone authored error through the same AuthFrame and provenance oracle", () => {
    const { main } = draw([ERROR]);
    const section = main.querySelector(`[data-ds-leaf="${ERROR}"]`)!;
    expect(section.querySelector("h1")!.textContent).toBe(specimenDataset.sections.errorState.code);
    expect(section.textContent).toContain(specimenDataset.sections.errorState.title);
    expect(section.querySelector(`a[href="${specimenDataset.sections.errorState.report.href}"]`)!.textContent).toBe(specimenDataset.sections.errorState.report.label);
  });
});
