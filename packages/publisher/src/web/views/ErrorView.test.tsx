// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ErrorView } from "./ErrorView.js";

afterEach(cleanup);

describe("ErrorView", () => {
  it("renders the status as real text content in the page's own <h1>", () => {
    render(<ErrorView status={404} title="Page not found" />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("404");
  });

  it("renders the title through EmptyState's own <h2>, distinct from the page's <h1>", () => {
    render(<ErrorView status="500" title="Something went wrong" />);
    const subheading = screen.getByRole("heading", { name: "Something went wrong" });
    expect(subheading.tagName).toBe("H2");
  });

  it("renders exactly one <h1> on the page", () => {
    render(<ErrorView status={403} title="Forbidden" description="You don't have access." action={<button type="button">Go home</button>} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("renders a description when given one, via EmptyState", () => {
    render(<ErrorView status={404} title="Page not found" description="The page you're looking for doesn't exist." />);
    expect(screen.getByText("The page you're looking for doesn't exist.")).toBeInTheDocument();
  });

  it("renders the action slot's content, via EmptyState", () => {
    render(<ErrorView status={404} title="Page not found" action={<button type="button">Go home</button>} />);
    expect(screen.getByRole("button", { name: "Go home" })).toBeInTheDocument();
  });

  it("renders the reference inline in the description, with no disclosure", () => {
    const { container } = render(
      <ErrorView status={500} title="Something went wrong" description="Something went wrong. Error: 8f2a91c0." />,
    );
    const text = screen.getByText("Something went wrong. Error: 8f2a91c0.");
    expect(text.tagName).toBe("P");
    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector("summary")).toBeNull();
    expect(text.closest("details")).toBeNull();
  });

  it("keeps one primary action, with a secondary destination as a text link inside the description", () => {
    const { container } = render(
      <ErrorView
        status={403}
        title="Not authorized"
        description={
          <>
            You do not have access. <a href="/help">Contact support</a>.
          </>
        }
        action={<button type="button">Go home</button>}
      />,
    );
    const link = screen.getByRole("link", { name: "Contact support" });
    const description = link.closest("p") as HTMLElement;
    expect(description).not.toBeNull();
    expect(description.textContent).toContain("You do not have access.");
    const button = screen.getByRole("button", { name: "Go home" });
    const actionArea = button.parentElement as HTMLElement;
    expect(actionArea.contains(description)).toBe(false);
    expect(actionArea.querySelectorAll("button, a, input, select, textarea")).toHaveLength(1);
    expect(container.querySelectorAll("button")).toHaveLength(1);
    // The description is read before the action area.
    expect(
      description.compareDocumentPosition(actionArea) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<ErrorView status={404} title="Page not found" className="gap-sm p-lg" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("gap-sm");
    expect(root.className).not.toContain("gap-lg");
    expect(root.className).toContain("p-lg");
    expect(root.className).not.toContain("p-2xl");
  });

  it("merges a consumer style prop rather than dropping it", () => {
    const { container } = render(
      <ErrorView status={404} title="Page not found" style={{ marginTop: "8px" }} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.marginTop).toBe("8px");
  });

  it("accepts arbitrary ReactNode as the title, not just a string", () => {
    render(
      <ErrorView
        status={404}
        title={
          <>
            Page <strong>not</strong> found
          </>
        }
      />,
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Page not found");
  });

  it("renders usably with no action or router of any kind", () => {
    expect(() => render(<ErrorView status={404} title="Page not found" />)).not.toThrow();
  });

  it("refuses a landmark role or the frame's main id on its content root", () => {
    expect(() => render(<ErrorView status={404} title="Page not found" role="main" />)).toThrow(/content root cannot take a landmark role/);
    expect(() => render(<ErrorView status={404} title="Page not found" id="publisher-main-content" />)).toThrow(/content root cannot take the frame's main id/);
  });
});
