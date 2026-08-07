import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./PageHeader.js";

describe("PageHeader", () => {
  it("renders the required title as a heading", () => {
    render(<PageHeader title="Prompts" />);
    const heading = screen.getByRole("heading", { name: "Prompts" });
    expect(heading.tagName).toBe("H1");
  });

  it("renders a description when given one", () => {
    render(<PageHeader title="Prompts" description="Manage your saved prompts." />);
    expect(screen.getByText("Manage your saved prompts.")).toBeInTheDocument();
  });

  it("omits the description entirely when none is given", () => {
    const { container } = render(<PageHeader title="Prompts" />);
    // Only the title's own text node should be present under the header.
    expect(container.querySelectorAll("p").length).toBe(0);
  });

  it("renders the actions slot's content", () => {
    render(<PageHeader title="Prompts" actions={<button type="button">New prompt</button>} />);
    expect(screen.getByRole("button", { name: "New prompt" })).toBeInTheDocument();
  });

  it("renders the breadcrumb slot's content", () => {
    render(<PageHeader title="Prompts" breadcrumb={<nav aria-label="Breadcrumb">Home</nav>} />);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
  });

  it("omits both slots when neither is given, without throwing", () => {
    render(<PageHeader title="Prompts" />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders as a <header> element", () => {
    const { container } = render(<PageHeader title="Prompts" />);
    expect(container.querySelector("header")).not.toBeNull();
  });

  it("forwards className onto the outer <header>, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<PageHeader title="Prompts" className="gap-lg" />);
    const header = container.querySelector("header") as HTMLElement;
    expect(header.className).toContain("gap-lg");
    expect(header.className).not.toContain("gap-md");
  });

  it("accepts arbitrary ReactNode as the title, not just a string", () => {
    render(
      <PageHeader
        title={
          <>
            Prompts <em>(beta)</em>
          </>
        }
      />,
    );
    expect(screen.getByRole("heading")).toHaveTextContent("Prompts (beta)");
  });
});
