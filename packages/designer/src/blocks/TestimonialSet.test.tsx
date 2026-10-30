import { Suspense } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import selected from "../studio/__fixtures__/default-component-preview-profile.json" with { type: "json" };
import cardDocument from "../catalog/fills/shadcn@aria/components.card.json" with { type: "json" };
import { componentDescriptorHash, type ComponentCandidate, type ResolvedComponents } from "../catalog-core/resolve-components.js";
import { importShadcnAriaComponents, materializeShadcnComponent, type ShadcnComponentInput } from "../importers/shadcn-aria-components.js";
import { selectedRuntime } from "../importers/__fixtures__/selected-runtime.js";
import { ConsumerComponentProvider, type ConsumerComponentSelection } from "../runtime/component-leaf.client.js";
import { SemanticContent } from "../components/SemanticContent.js";
import { Card as FoundryCard } from "../components/Card.js";
import { TestimonialSet, type TestimonialSetItem } from "./TestimonialSet.js";
import { renderTestimonialsSection } from "../runtime/sections/testimonials.js";
import { groupASectionInput } from "../runtime/sections/group-a-dataset.js";
import { importFoundrySections } from "../importers/foundry-sections.js";
import { specimenDataset } from "../studio/specimen-dataset.js";

const fixture = resolve(import.meta.dirname, "../importers/__fixtures__/shadcn-aria");
const read = (name: string) => readFileSync(resolve(fixture, name), "utf8");
const imported = importShadcnAriaComponents({
  items: [JSON.parse(read("card.json"))],
  styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") },
  notice: { path: "LICENSE.md", content: read("LICENSE.md") },
} as ShadcnComponentInput);
const files = materializeShadcnComponent(imported, "card");
const runtime = selectedRuntime(files);
const cardDescriptor = cardDocument.components.card as unknown as ComponentCandidate;
function selection(shadcn = true): ConsumerComponentSelection {
  const profile = structuredClone(selected) as unknown as ResolvedComponents;
  if (shadcn) {
    const original = profile.components["components.card"]!;
    profile.components = { ...profile.components, "components.card": { ...original,
      descriptor: cardDescriptor, impl: cardDescriptor.impl as typeof original.impl, propMap: cardDescriptor.propMap,
      origin: { kind: "adopted", source: "shadcn@aria", fill: "shadcn@aria/components.card", pin: cardDescriptor.pin, license: cardDescriptor.license, sha256: componentDescriptorHash(cardDescriptor), adoptedAt: "2026-10-30" },
    } };
    profile.files = [...profile.files.filter(file => !files.some(item => item.path === file.path)), ...files];
  }
  return { profile: { components: profile }, selectionHash: profile.selectionHash,
    descriptors: Object.fromEntries(Object.entries(profile.components).map(([id, chosen]) => [id, componentDescriptorHash(chosen.descriptor)])),
    modules: { "@clossys/designer/components": { SemanticContent, Card: FoundryCard }, "components/card/card.tsx": runtime.load("components/card/card.tsx") },
  };
}
const item = { id: "first", quote: "A clear account.", attributorName: "Example Co.", attributorRole: "Reviewer" };
const items = (count: number): TestimonialSetItem[] => Array.from({ length: count }, (_, index) => ({ ...item, id: String(index) }));
const host = (children: React.ReactNode, chosen = selection()) => <ConsumerComponentProvider value={chosen}><Suspense fallback={null}>{children}</Suspense></ConsumerComponentProvider>;

describe("selected-leaf testimonial section", () => {
  it.each([1, 2, 3, 4, 6])("renders %i real selected shadcn cards with quote attribution", async count => {
    const view = render(host(<TestimonialSet items={items(count)} />));
    await waitFor(() => expect(view.container.querySelectorAll('[data-slot="card"]')).toHaveLength(count));
    expect(screen.getAllByRole("listitem")).toHaveLength(count);
    expect(view.container.querySelectorAll("figure > figcaption")).toHaveLength(count);
    expect(screen.getAllByText(item.quote)).toHaveLength(count);
    expect(screen.getAllByText(item.attributorName)).toHaveLength(count);
    const cards = view.container.querySelectorAll('[data-slot="card"]');
    for (const card of cards) expect(card).toHaveClass("border");
    if (count === 1) expect(screen.getByRole("list").className).not.toMatch(/(?:^|\s)grid(?:\s|$)/);
    if (count === 3) expect(screen.getAllByRole("listitem")[2]).toHaveClass("tablet:col-span-2", "desktop:col-span-1");
  });

  it("honours consumer replacement without changing the section", async () => {
    const view = render(host(<TestimonialSet items={[item]} />));
    await waitFor(() => expect(view.container.querySelector('[data-slot="card"]')).not.toBeNull());
    view.rerender(host(<TestimonialSet items={[item]} />, selection(false)));
    await waitFor(() => expect(view.container.querySelector('[data-slot="card"]')).toBeNull());
    expect(screen.getByText(item.quote)).toBeInTheDocument();
    expect(view.container.querySelector("figure")?.parentElement).toHaveClass("rounded-control");
  });

  it("keeps portraits decorative and forwards host list attributes", async () => {
    const view = render(host(<TestimonialSet items={[{ ...item, portrait: <svg data-testid="portrait" /> }]} id="quotes" dir="rtl" aria-label="Reader accounts" className="gap-xl" style={{ marginTop: 7 }} />));
    await screen.findByText(item.quote);
    expect(screen.getByTestId("portrait").parentElement).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("list")).toHaveAttribute("id", "quotes");
    expect(screen.getByRole("list")).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("list")).toHaveClass("gap-xl");
    expect((view.container.firstElementChild as HTMLElement).style.marginTop).toBe("7px");
  });

  it("renders the registered runtime section from the Studio specimen dataset", async () => {
    const fill = importFoundrySections().fills.find(row => row.$extensions["com.clossys.fill"].slot === "sections.testimonials")!;
    const view = render(host(renderTestimonialsSection(groupASectionInput("testimonials", fill))));
    await waitFor(() => expect(view.container.querySelectorAll('[data-slot="card"]')).toHaveLength(specimenDataset.sections.testimonials.items.length));
    expect(view.container.firstElementChild).toHaveAttribute("data-ds-leaf", "sections.testimonials");
    for (const quote of specimenDataset.sections.testimonials.items) expect(screen.getByText(quote.attributorName)).toBeInTheDocument();
  });

  it("refuses unsupported counts and grounds before rendering", () => {
    for (const count of [0, 5, 7]) expect(() => TestimonialSet({ items: items(count) })).toThrow(/^TestimonialSet:/);
    expect(() => TestimonialSet({ items: [item], ground: "unknown" as never })).toThrow(/ground/);
  });
});
