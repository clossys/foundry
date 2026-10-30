import { Suspense, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import type { ResolvedComponents } from "../catalog-core/resolve-components.js";
import { componentDescriptorHash } from "../catalog-core/resolve-components.js";
import { ConsumerComponentProvider, type ConsumerComponentSelection } from "../runtime/component-leaf.client.js";
import { defaultSourceModules } from "../components/preview-runtime/modules.js";
import { GROUP_A_SECTION_RENDERERS } from "../runtime/sections/group-a.js";
import { groupASectionInput } from "../runtime/sections/group-a-dataset.js";
import savedSelection from "../studio/__fixtures__/default-component-preview-profile.json" with { type: "json" };
import faqFill from "../catalog/fills/foundry/sections.faq.json" with { type: "json" };
import contribution from "../runtime/sections/a270-faq.contribution.json" with { type: "json" };
import { specimenDataset } from "../studio/specimen-dataset.js";
import { Faq } from "./Faq.js";
import { Faq as ServerFaq } from "./Faq.server.js";

const items = [
  { id: "one", question: "First question", answer: "First answer" },
  { id: "two", question: "Second question", answer: "Second answer" },
];

/** Native saved consumer selection plus the exact per-id descriptor contribution. */
function selection(): ConsumerComponentSelection {
  const profile: ResolvedComponents = JSON.parse(JSON.stringify(savedSelection));
  const chosen = profile.components["components.disclosure"]!;
  chosen.descriptor.secondaryExports = contribution.dependencies.descriptorSecondaryExports;
  profile.selectionHash = componentDescriptorHash(chosen.descriptor);
  return {
    profile: { components: profile }, selectionHash: profile.selectionHash,
    descriptors: Object.fromEntries(Object.entries(profile.components).map(([leaf, component]) => [leaf, componentDescriptorHash(component.descriptor)])),
    modules: defaultSourceModules,
  };
}
function host(children: ReactNode) {
  return <ConsumerComponentProvider value={selection()}><Suspense>{children}</Suspense></ConsumerComponentProvider>;
}

describe("selected FAQ disclosure section", () => {
  it("uses the actual selected source styling and toggles independent rows with Enter and Space", async () => {
    const user = userEvent.setup();
    const { container } = render(host(<Faq items={items} />));
    const first = await screen.findByRole("button", { name: "First question" });
    const second = screen.getByRole("button", { name: "Second question" });
    expect(container.querySelector('[data-slot="accordion"]')).not.toBeNull();
    expect(first).toHaveAttribute("data-slot", "accordion-trigger");
    expect(first.className).toContain("rounded-(--radius-control)");
    first.focus(); await user.keyboard("{Enter}");
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(first).toHaveFocus();
    const panel = document.getElementById(first.getAttribute("aria-controls")!);
    expect(panel).toHaveAttribute("data-slot", "accordion-content");
    expect(panel).toHaveTextContent("First answer");
    expect(screen.getByText("First answer")).toBeVisible();
    second.focus(); await user.keyboard(" ");
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(first).toHaveAttribute("aria-expanded", "true");
    first.focus(); await user.keyboard("{Enter}");
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(first).toHaveFocus();
  });

  it("keeps every answer in native server HTML", () => {
    const html = renderToStaticMarkup(<ServerFaq items={items} />);
    expect(html).toContain("First answer"); expect(html).toContain("Second answer");
    expect(html.match(/<details/g)).toHaveLength(2);
  });

  it("keeps row ids unique across FAQ instances with the same authored keys", async () => {
    const { container } = render(host(<><Faq items={items} /><Faq items={items} layout="two-column" /></>));
    await screen.findAllByRole("button", { name: "First question" });
    const ids = Array.from(container.querySelectorAll("[id]")).map(element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(container.querySelector("[data-faq-columns]")).not.toBeNull();
  });

  it("renders the registered Studio FAQ specimen through its native caller data", async () => {
    const input = groupASectionInput("faq", faqFill);
    const renderer = GROUP_A_SECTION_RENDERERS["sections.faq"]!;
    const { container } = render(host(renderer(input)));
    await screen.findByRole("button", { name: specimenDataset.sections.faq.items[0]!.question });
    const root = container.querySelector('[data-ds-leaf="sections.faq"]');
    if (!(root instanceof HTMLElement)) throw new Error("Missing registered FAQ specimen");
    expect(root).toHaveAttribute("data-ds-fill", "foundry/sections.faq");
    for (const item of specimenDataset.sections.faq.items) {
      expect(await within(root).findByRole("button", { name: item.question })).toBeInTheDocument();
      expect(within(root).getByText(item.answer)).toBeInTheDocument();
    }
    expect(() => renderer({ ...input, content: {} })).toThrow(/items is missing/);
  });
});
