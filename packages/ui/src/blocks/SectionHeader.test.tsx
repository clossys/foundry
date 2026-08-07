import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionHeader } from "./SectionHeader.js";

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
