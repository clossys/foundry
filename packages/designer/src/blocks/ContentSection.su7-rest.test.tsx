import { Suspense } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContentSection } from "./ContentSection.js";
import { ConsumerComponentProvider } from "../runtime/component-leaf.client.js";
import { contentComponentSelection } from "./__fixtures__/a270-content-components.js";

function section(props: Parameters<typeof ContentSection>[0]) {
  return render(<ConsumerComponentProvider value={contentComponentSelection()}><Suspense><ContentSection {...props} /></Suspense></ConsumerComponentProvider>);
}

describe("Content section selected native composition", () => {
  it("renders authored summary pairs through selected shadcn CardContent with definition semantics", async () => {
    const { container } = section({ heading: "Overview", headingId: "overview", aside: [{ id: "scope", label: "Scope", value: "ExampleCo" }], children: "Caller body", footnote: "Caller footnote", source: "Caller source", takeaway: "Caller takeaway" });
    expect(await screen.findByRole("heading", { name: "Overview", level: 2 })).toHaveAttribute("id", "overview");
    expect(await screen.findByText("ExampleCo")).toBeInTheDocument();
    expect(container.querySelector('aside [data-slot="card"] [data-slot="card-content"] dl dt')?.textContent).toBe("Scope");
    expect(container.querySelector("aside dl dd")?.textContent).toBe("ExampleCo");
    expect(container.querySelectorAll('[data-ds-leaf="sections.content"]')).toHaveLength(1);
    for (const copy of ["Caller body", "Caller footnote", "Caller source", "Caller takeaway"]) expect(screen.getByText(copy)).toBeInTheDocument();
  });
  it.each([undefined, []])("omits an absent or empty summary rail (%s)", async aside => {
    const { container } = section({ heading: "Plain section", aside, children: "Caller body" });
    await screen.findByRole("heading", { name: "Plain section" });
    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector('[data-slot="card"]')).toBeNull();
  });
  it.each(["split-start", "split-end"] as const)("preserves %s media and caller slots", async layout => {
    const { container } = section({ layout, heading: "Split section", children: "Caller body", media: "Caller media", footnote: "Caller note" });
    await screen.findByText("Caller media");
    expect(container.querySelector(`[data-content-section][data-layout="${layout}"]`)).not.toBeNull();
    expect(container.querySelector("[data-content-section-media]")?.textContent).toBe("Caller media");
    expect(screen.getByText("Caller note")).toBeInTheDocument();
  });
});
