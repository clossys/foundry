import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionHeader } from "./SectionHeader.js";
import { withoutDsAttrs } from "../catalog-core/provenance-attrs.js";

describe("SectionHeader", () => {
  it("renders the required title as a heading, defaulting to level 2", () => {
    render(<SectionHeader title="Notifications" />);
    const heading = screen.getByRole("heading", { name: "Notifications" });
    expect(heading.tagName).toBe("H2");
  });

  it("renders the title at a custom level", () => {
    render(<SectionHeader title="Notifications" level={4} />);
    expect(screen.getByRole("heading", { name: "Notifications", level: 4 }).tagName).toBe("H4");
  });

  it("renders no eyebrow, description, or actions region when omitted", () => {
    render(<SectionHeader title="Notifications" />);
    expect(screen.queryByText("BETA")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeInTheDocument();
  });

  it("renders the eyebrow, description, and actions regions when given", () => {
    render(
      <SectionHeader
        title="Notifications"
        eyebrow="BETA"
        description="Control how you're notified."
        actions={<button type="button">Reset to defaults</button>}
      />,
    );
    expect(screen.getByText("BETA")).toBeInTheDocument();
    expect(screen.getByText("Control how you're notified.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset to defaults" })).toBeInTheDocument();
  });

  it("keeps the document outline unbroken across nested levels (a PageHeader h1, a level=2 SectionHeader, a level=3 sub-SectionHeader)", () => {
    render(
      <div>
        <h1>Settings</h1>
        <SectionHeader title="Notifications" level={2} />
        <SectionHeader title="Email preferences" level={3} />
      </div>,
    );
    const headings = screen.getAllByRole("heading");
    expect(headings.map((h) => h.tagName)).toEqual(["H1", "H2", "H3"]);
  });

  it("renders as a plain <div>, not a <header> landmark — a page can hold several without registering multiple banner landmarks", () => {
    const { container } = render(<SectionHeader title="Notifications" />);
    expect(container.querySelector("header")).toBeNull();
    expect(screen.queryAllByRole("banner")).toHaveLength(0);
  });

  it("a page can hold two SectionHeaders (test 3 — this is a block, not a view/singleton)", () => {
    render(
      <div>
        <SectionHeader title="Notifications" />
        <SectionHeader title="Privacy" />
      </div>,
    );
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Privacy" })).toBeInTheDocument();
  });

  it("forwards className onto the root, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<SectionHeader title="Notifications" className="gap-2xl" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("gap-2xl");
    expect(root.className).not.toContain("gap-xs");
  });

  it("forwards a consumer style prop onto the root", () => {
    const { container } = render(
      <SectionHeader title="Notifications" style={{ marginTop: "8px" }} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.marginTop).toBe("8px");
  });
});

// S4-1: source capabilities remain independent of document outline.
describe("S4-1 shared header capabilities", () => {
  it.each([2, 3, 4, 5, 6] as const)("keeps semantic rank %s at every density", level => {
    for (const density of ["compact", "standard", "display"] as const) {
      const view = render(<SectionHeader title="Heading" level={level} density={density} />);
      expect(view.container.querySelector(`h${level}`)).toHaveTextContent("Heading");
      expect(view.container.querySelectorAll("h1,h2,h3,h4,h5,h6")).toHaveLength(1);
      view.unmount();
    }
  });

  it("preserves exact compact default markup", () => {
    const { container } = render(<SectionHeader title="Title" eyebrow="Label" description="Support" actions={<button>Action</button>} />);
    expect(withoutDsAttrs(container.innerHTML)).toBe('<div class="flex flex-col gap-xs"><p class="text-caption uppercase tracking-label text-ink-muted">Label</p><div class="flex flex-wrap items-start justify-between gap-md"><div class="flex flex-col gap-xs"><h2 class="text-h3 font-display text-ink-primary">Title</h2><p class="text-body text-ink-secondary">Support</p></div><div class="flex items-center gap-sm"><button>Action</button></div></div></div>');
  });

  it.each([0, "", null, undefined, false])("retains a real heading for explicit title %s", title => {
    const { container } = render(<SectionHeader title={title} />);
    expect(container.querySelectorAll("h2")).toHaveLength(1);
    expect(container.querySelector("h2")?.textContent).toBe(title === 0 ? "0" : "");
  });

  it("omits an omitted title and flattens standard supporting copy", () => {
    const { container } = render(<SectionHeader density="standard" eyebrow="Label" description="Support" />);
    expect(container.querySelector("h1,h2,h3,h4,h5,h6")).toBeNull();
    expect(Array.from(container.firstElementChild!.children).map(node => node.textContent)).toEqual(["Label", "Support"]);
  });

  it.each(["base", "sunken", "inverse"] as const)("selects %s inks without painting a surface", ground => {
    for (const density of ["compact", "standard", "display"] as const) {
      const view = render(<SectionHeader title="Title" eyebrow="Label" description="Support" density={density} ground={ground} />);
      const root = view.container.firstElementChild!;
      expect(root.querySelector("h2")).toHaveClass(ground === "inverse" ? "text-ink-on-inverse" : "text-ink-primary");
      expect(root.querySelector("h2")?.className).toContain(density === "display" ? "text-display-m" : density === "standard" ? "text-h2" : "text-h3");
      expect(root.lastElementChild?.textContent).toContain("Support");
      expect(root.querySelectorAll('[class*="bg-surface"]')).toHaveLength(0);
      expect(root.className).not.toContain("bg-");
      const label = view.getByText("Label");
      expect(label).toHaveClass(density === "display" ? ground === "inverse" ? "text-accent-on-inverse" : "text-accent-text" : ground === "inverse" ? "text-ink-on-inverse-muted" : "text-ink-muted");
      expect(view.getByText("Support")).toHaveClass(ground === "inverse" ? "text-ink-on-inverse-muted" : "text-ink-secondary");
      view.unmount();
    }
  });

  it("centers standard actions below the text and keeps titleless start actions trailing", () => {
    const view = render(<SectionHeader density="standard" align="center" title="Title" actions={<button>Act</button>} />);
    const root = view.container.firstElementChild!;
    expect(root).toHaveClass("items-center", "text-center");
    expect(root.querySelector("h2")?.parentElement).not.toBe(view.getByRole("button").parentElement);
    expect(view.getByRole("button").parentElement).toHaveClass("justify-center");
    view.rerender(<SectionHeader density="standard" actions={<button>Act</button>} />);
    expect(view.container.querySelector("h2")).toBeNull();
    expect(view.getByRole("button").parentElement).toHaveClass("ms-auto");
    expect(view.getByRole("button").parentElement?.parentElement?.children).toHaveLength(1);
  });

  it("keeps display rhythm and actions below supporting copy", () => {
    const { container } = render(<SectionHeader density="display" eyebrow="Label" title="Title" description="Support" actions={<button>Act</button>} />);
    const root = container.firstElementChild!;
    expect(Array.from(root.children).map(node => node.textContent)).toEqual(["Label", "Title", "Support", "Act"]);
    expect(root.children[1]).toHaveClass("mt-sm", "leading-display", "text-balance", "tablet:text-display-l");
    expect(root.children[2]).toHaveClass("mt-2xl", "text-body-l", "text-pretty");
    expect(root.children[3]).toHaveClass("mt-3xl");
  });

  it("forwards root attributes and events, and merges the FAQ title hook last", () => {
    let clicks = 0;
    const { container } = render(<SectionHeader id="header" dir="rtl" role="group" aria-label="Region" data-host="yes" onClick={() => clicks++} title="Title" titleClassName="leading-heading text-h2" className="gap-lg" style={{ marginTop: 7 }} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe("DIV");
    expect(root).toHaveAttribute("id", "header");
    expect(root).toHaveAttribute("dir", "rtl");
    expect(root).toHaveAttribute("data-host", "yes");
    expect(root).toHaveAttribute("aria-label", "Region");
    expect(root).toHaveAttribute("role", "group");
    expect(root.style.marginTop).toBe("7px");
    root.click(); expect(clicks).toBe(1);
    expect(root).toHaveClass("gap-lg");
    expect(root.querySelector("h2")).toHaveClass("leading-heading", "text-h2");
    expect(root.querySelector("h2")).not.toHaveClass("text-h3");
  });
});

it("S4-1 preserves three supplied actions and an empty compact description-only region", () => {
  const view = render(<SectionHeader density="standard" title="Title" description="Support" actions={<><button>A</button><button>B</button><button>C</button></>} />);
  expect(view.getAllByRole("button")).toHaveLength(3);
  expect(view.getByRole("heading").parentElement?.nextElementSibling).toBe(view.getByRole("button", { name: "A" }).parentElement);
  view.rerender(<SectionHeader description="Support" />);
  expect(view.queryByRole("heading")).toBeNull();
  expect(view.getByText("Support")).toBeInTheDocument();
});
