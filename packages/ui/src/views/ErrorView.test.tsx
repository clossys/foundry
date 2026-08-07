import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorView } from "./ErrorView.js";

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

  it("omits the details block entirely when none is given", () => {
    const { container } = render(<ErrorView status={404} title="Page not found" />);
    expect(container.querySelector("details")).toBeNull();
  });

  it("renders the details slot inside a native <details>, collapsed by default", () => {
    render(
      <ErrorView
        status={500}
        title="Something went wrong"
        details={<code>request id: abc-123</code>}
      />,
    );
    const details = document.querySelector("details") as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")).not.toBeNull();
    expect(screen.getByText("request id: abc-123")).toBeInTheDocument();
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
});
