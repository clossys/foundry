import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbEllipsis } from "../components/preview-runtime/components/breadcrumbs/breadcrumb.js";
import { importShadcnAriaComponents, materializeShadcnComponent, SHADCN_ARIA_RUNTIME_TARGETS, type ShadcnComponentInput } from "./shadcn-aria-components.js";

function pinnedInput(): ShadcnComponentInput {
  const here = resolve(import.meta.dirname, "__fixtures__/shadcn-aria");
  const read = (name: string) => readFileSync(resolve(here, name), "utf8");
  return {
    items: readdirSync(here).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"),
    styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") },
    notice: { path: "LICENSE.md", content: read("LICENSE.md") },
  };
}

describe("authenticated Breadcrumb on the current native runtime", () => {
  it("targets only Breadcrumb's exact installed dependencies without changing authenticated source bytes", () => {
    const input = pinnedInput();
    const current = importShadcnAriaComponents(input);
    const legacy = importShadcnAriaComponents({ ...input, runtimeTargets: {} });
    const installed = Object.fromEntries(["react", "react-aria-components", "tailwind-merge"].map(name => [name, JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../node_modules", name, "package.json"), "utf8")).version]));
    expect(SHADCN_ARIA_RUNTIME_TARGETS).toEqual({ breadcrumb: installed });
    const candidate = current.fills.find(doc => doc.components.breadcrumbs)!.components.breadcrumbs!;
    const prior = legacy.fills.find(doc => doc.components.breadcrumbs)!.components.breadcrumbs!;
    expect(candidate.members).toEqual(expect.arrayContaining(["current", "collapsed"]));
    for (const [name, version] of Object.entries(installed)) expect(candidate.deps).toContainEqual(expect.objectContaining({ name, version }));
    expect(candidate.pin).toEqual(prior.pin);
    expect(candidate.outputSha256).toEqual(prior.outputSha256);
    expect(materializeShadcnComponent(current, "breadcrumb")).toEqual(materializeShadcnComponent(legacy, "breadcrumb"));
    expect(current.fills.filter(doc => !doc.components.breadcrumbs)).toEqual(legacy.fills.filter(doc => !doc.components.breadcrumbs));
    expect(current.receipt.find(row => row.item === "breadcrumb")?.runtimeTarget).toEqual(installed);
  });

  it("renders real native links and the explicitly current page with the authenticated sub-parts", () => {
    render(<Breadcrumb aria-label="Current page trail"><BreadcrumbList>
      <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
      <BreadcrumbItem><BreadcrumbPage>Publication</BreadcrumbPage></BreadcrumbItem>
    </BreadcrumbList></Breadcrumb>);
    expect(screen.getByRole("navigation", { name: "Current page trail" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByText("Publication")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Publication")).toHaveAttribute("aria-disabled", "true");
  });

  it("renders the actual collapsed ellipsis part with native glyphs, without inventing automatic collapse", () => {
    const { container } = render(<Breadcrumb aria-label="Collapsed publication trail"><BreadcrumbList>
      <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
      <BreadcrumbItem><BreadcrumbEllipsis /></BreadcrumbItem>
      <BreadcrumbItem><BreadcrumbPage>Page</BreadcrumbPage></BreadcrumbItem>
    </BreadcrumbList></Breadcrumb>);
    const ellipsis = container.querySelector('[data-slot="breadcrumb-ellipsis"]');
    expect(ellipsis).toHaveAttribute("role", "presentation");
    expect(ellipsis).toHaveAttribute("aria-hidden", "true");
    expect(ellipsis?.querySelector('svg[data-ds-leaf="components.icon"]')).not.toBeNull();
    expect(screen.getByText("Page")).toHaveAttribute("aria-current", "page");
    expect(container.querySelectorAll('[data-slot="breadcrumb-item"]')).toHaveLength(3);
    expect(container.querySelector('[data-slot="breadcrumb-ellipsis"] [data-preview-pending]')).toBeNull();
  });
});
