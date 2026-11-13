import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { Suspense, type ReactNode } from "react";
import { ConsumerComponentProvider, type ConsumerComponentSelection } from "../runtime/component-leaf.client.js";
import { componentDescriptorHash, verifyComponentOutput, type ComponentCandidate, type ResolvedComponents } from "../catalog-core/resolve-components.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import cardDocument from "../catalog/fills/shadcn@aria/components.card.json" with { type: "json" };
import selectedProfile from "../studio/default-component-preview-profile.json" with { type: "json" };
import { SectionFrame as S4Frame } from "./SectionFrame.js";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { Testimonial } from "./Testimonial.js";
import { renderTestimonial } from "./Testimonial.server.js";
import { TestimonialSet, type TestimonialSetItem } from "./TestimonialSet.js";

let selection: ConsumerComponentSelection;
beforeAll(() => {
  const descriptor = cardDocument.components.card as unknown as ComponentCandidate;
  const bundle = loadCatalogBundles().sourceBundles.find(row => row.slot === "components.card" && row.descriptorHash === componentDescriptorHash(descriptor))!;
  if (descriptor.impl.kind !== "source") throw new Error("TestimonialSet requires the real selected source Card");
  verifyComponentOutput(descriptor, bundle.files);
  // Compile the real verified Card closure in Node, avoiding jsdom's Uint8Array realm.
  const compiled = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { build } from "esbuild";
    import { readFileSync } from "node:fs";
    import { posix } from "node:path";
    const { entry, files: sourceFiles } = JSON.parse(readFileSync(0, "utf8"));
    const files = new Map(sourceFiles.map(file => [file.path, file.content]));
    const result = await build({ entryPoints: [entry], bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic", plugins: [{ name: "testimonial-selected-card", setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => {
        const path = args.path.startsWith(".") ? posix.normalize(posix.join(posix.dirname(args.importer), args.path)) : args.path;
        const target = [path, path + ".ts", path + ".tsx", path.replace(/\\.js$/, ".ts"), path.replace(/\\.js$/, ".tsx"), path + "/index.ts"].find(candidate => files.has(candidate));
        return target ? { path: target, namespace: "selected-card" } : { path: args.path, external: true };
      });
      plugin.onLoad({ filter: /.*/, namespace: "selected-card" }, args => ({ contents: files.get(args.path), loader: args.path.endsWith(".tsx") ? "tsx" : "ts" }));
    } }] });
    process.stdout.write(result.outputFiles[0].text);
  `], { input: JSON.stringify({ entry: descriptor.impl.entry, files: bundle.files }), encoding: "utf8" });
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(createRequire(import.meta.url), module, module.exports);
  const profile = structuredClone(selectedProfile) as unknown as ResolvedComponents;
  profile.components = { "components.card": { ...profile.components["components.card"]!, descriptor, impl: descriptor.impl, propMap: descriptor.propMap } };
  profile.files = bundle.files;
  profile.selectionHash = componentDescriptorHash(descriptor);
  selection = { profile: { components: profile }, selectionHash: profile.selectionHash,
    descriptors: { "components.card": componentDescriptorHash(descriptor) }, modules: { [descriptor.impl.entry]: module.exports } };
});
const selected = (children: ReactNode) => <ConsumerComponentProvider value={selection}><Suspense fallback={null}>{children}</Suspense></ConsumerComponentProvider>;

const item = { id: "first", quote: <>A <em>clear</em> account.</>, attributorName: "Alex Example", attributorRole: "Reviewer" };
const items = (count: number): TestimonialSetItem[] => Array.from({ length: count }, (_, index) => ({ ...item, id: String(index) }));

describe("TestimonialSet", () => {
  it("composes actual selected Card and CardContent around authored quote, attribution and portrait [mutant: bypass selected Card]", async () => {
    const authored = { ...item, attributorName: <strong>Alex Example</strong>, attributorRole: <span>Reviewer</span>, portrait: <svg data-testid="authored-portrait" /> };
    const { container } = render(selected(<TestimonialSet items={[authored]} />));
    const list = await screen.findByRole("list");
    const card = list.querySelector('li > [data-slot="card"]')!;
    expect(card).not.toBeNull();
    expect(card).toHaveClass("group/card", "flex", "flex-col");
    const figure = card.querySelector('[data-slot="card-content"] > figure')!;
    expect(figure).not.toBeNull();
    expect(figure.querySelector("blockquote em")).toHaveTextContent("clear");
    expect(figure.querySelector("figcaption strong")).toHaveTextContent("Alex Example");
    expect(figure.querySelector("figcaption [aria-hidden=true]")?.firstElementChild).toBe(screen.getByTestId("authored-portrait"));
    expect(container.querySelectorAll('li > [data-slot="card"]')).toHaveLength(1);
    expect(list).toHaveAttribute("data-ds-leaf", "sections.testimonials");
    expect(card).not.toHaveAttribute("variant"); expect(card).not.toHaveAttribute("ground");
  });

  it("refuses a missing actual selected Card module instead of falling back to a bare figure", () => {
    const missing = { ...selection, modules: {} };
    expect(() => renderToStaticMarkup(<ConsumerComponentProvider value={missing}><TestimonialSet items={[item]} /></ConsumerComponentProvider>))
      .toThrow(/NEED component selection: components.card/);
  });

  it("refuses counts zero, five and seven with a block-specific TypeError [mutant: allow five]", () => {
    for (const count of [0, 5, 7]) {
      expect(() => renderToStaticMarkup(<TestimonialSet items={items(count)} />)).toThrow(TypeError);
      expect(() => renderToStaticMarkup(<TestimonialSet items={items(count)} />)).toThrow(/^TestimonialSet:/);
    }
    for (const count of [1, 2, 3, 4, 6]) {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(<TestimonialSet items={items(count)} />);
      expect(host.querySelectorAll('ul > li > [data-slot="card"] > [data-slot="card-content"] > figure')).toHaveLength(count);
    }
  });

  it("centres one item without grid classes [mutant: always grid]", () => {
    render(<TestimonialSet items={[item]} />);
    const list = screen.getByRole("list");
    expect(list).toHaveClass("mx-auto", "max-w-[42rem]");
    expect(list.className).not.toMatch(/(?:^|\s)(?:\S*:)?grid(?:-|\s|$)/);
  });

  it("keeps the portrait first and decorative [mutant: remove portrait aria-hidden]", () => {
    const { container } = render(<TestimonialSet items={[{ ...item, portrait: <svg data-testid="portrait" /> }]} />);
    const portrait = screen.getByTestId("portrait").parentElement;
    expect(portrait).toHaveAttribute("aria-hidden", "true");
    expect(portrait).toHaveClass("size-10", "shrink-0", "overflow-hidden", "rounded-pill");
    expect(container.querySelector("figcaption")?.firstElementChild).toBe(portrait);
  });

  it("shares the base figure markup with Testimonial [mutant: diverge figure markup]", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<TestimonialSet ground="base" items={[item]} />);
    expect(host.querySelector("figure")?.outerHTML).toBe(renderToStaticMarkup(<Testimonial quote={item.quote} attributorName={item.attributorName} attributorRole={item.attributorRole} />));
  });

  it("spans the third of three items at tablet only [mutant: remove third span]", () => {
    render(<TestimonialSet items={items(3)} />);
    const entries = screen.getAllByRole("listitem");
    expect(screen.getByRole("list")).toHaveClass("grid-cols-1", "tablet:grid-cols-2", "desktop:grid-cols-3", "gap-lg");
    expect(entries[2]).toHaveClass("tablet:col-span-2", "desktop:col-span-1");
    expect(entries[0]).not.toHaveClass("tablet:col-span-2");
  });

  it("uses inverse quote and attribution inks [mutant: hard-code primary ink]", () => {
    const { container } = render(<TestimonialSet ground="inverse" items={[item]} />);
    expect(container.querySelector("blockquote")).toHaveClass("text-ink-on-inverse");
    expect(screen.getByText(item.attributorName)).toHaveClass("text-ink-on-inverse");
    expect(screen.getByText(item.attributorRole)).toHaveClass("text-ink-on-inverse-muted");
    expect(container.querySelector("blockquote")).not.toHaveClass("text-ink-primary");
    expect(container.querySelector('li > [data-slot="card"]')).toHaveClass("bg-surface-inverse-raised");
  });

  it("preserves the exact renderer output when ground is omitted [mutant: change default ground]", () => {
    expect(renderToStaticMarkup(renderTestimonial({ quote: "Quote", attributorName: "Name", attributorRole: "Role" }, null))).toBe('<figure class="flex flex-col gap-md"><blockquote class="text-blockquote font-display text-ink-primary">Quote</blockquote><figcaption class="flex items-center gap-sm"><div class="flex flex-col"><span class="text-body font-body font-medium text-ink-primary">Name</span><span class="text-body-s text-ink-secondary">Role</span></div></figcaption></figure>');
  });

  it("forwards host list attributes, style and class overrides without a section heading", () => {
    render(<TestimonialSet items={[item]} aria-label="Reader accounts" aria-labelledby="accounts" id="quotes" className="max-w-[40rem]" style={{ marginBlockStart: "8px" }} />);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    expect(list).toHaveAttribute("id", "quotes");
    expect(list).toHaveAttribute("aria-label", "Reader accounts");
    expect(list).toHaveAttribute("aria-labelledby", "accounts");
    expect(list).toHaveClass("max-w-[40rem]");
    expect(list.style.marginBlockStart).toBe("8px");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    const row = screen.getByRole("listitem");
    expect(row).toHaveClass("min-w-0");
    expect(row.querySelector('[data-slot="card"]')).toHaveClass("h-full", "min-w-0", "group/card");
    const content = row.querySelector<HTMLElement>('[data-slot="card-content"]')!;
    expect(content).toHaveClass("text-body-l");
    expect(content.style.getPropertyValue("--text-blockquote")).toBe("var(--text-body-l, inherit)");
  });

  it("uses two desktop columns for two and four, and three for six", () => {
    for (const count of [2, 4, 6]) {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(<TestimonialSet ground="sunken" items={items(count)} />);
      expect(host.querySelector("ul")).toHaveClass("grid", "grid-cols-1", "tablet:grid-cols-2", count === 6 ? "desktop:grid-cols-3" : "desktop:grid-cols-2");
      expect(host.querySelector('li > [data-slot="card"] > [data-slot="card-content"] > figure')).not.toBeNull();
    }
  });
});

it("S4-6 retains the bare root, direct children and host identity under one external band", () => {
  let clicks = 0;
  const view = render(<TestimonialSet items={items(2)} id="bare" dir="rtl" data-host="bare" className="gap-xl" style={{ marginTop: 7 }} onClick={() => clicks++} />);
  const root = view.container.firstElementChild as HTMLElement;
  expect(root.tagName).toBe("UL");
  expect(root).toHaveAttribute("id", "bare");
  expect(root).toHaveAttribute("dir", "rtl");
  expect(root).toHaveAttribute("data-host", "bare");
  expect(root.style.marginTop).toBe("7px");
  expect(root).toHaveClass("gap-xl");
  expect(Array.from(root.children).every(child => child.tagName === "LI")).toBe(true);
  expect(root.querySelector("section,header,h1,h2")).toBeNull();
  root.click(); expect(clicks).toBe(1);
  view.rerender(<S4Frame><TestimonialSet items={items(2)} id="bare" /></S4Frame>);
  expect(view.container.querySelectorAll("[data-designer-section-frame]")).toHaveLength(1);
  expect(view.container.querySelector("#bare")?.tagName).toBe("UL");
});
