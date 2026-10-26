import { renderToStaticMarkup as renderS4Server } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState.js";

describe("EmptyState", () => {
  it("renders the required title as a heading", () => {
    render(<EmptyState title="No prompts yet" />);
    const heading = screen.getByRole("heading", { name: "No prompts yet" });
    expect(heading.tagName).toBe("H2");
  });

  it("renders a description when given one", () => {
    render(<EmptyState title="No prompts yet" description="Create your first one to get started." />);
    expect(screen.getByText("Create your first one to get started.")).toBeInTheDocument();
  });

  it("omits the description entirely when none is given", () => {
    const { container } = render(<EmptyState title="No prompts yet" />);
    expect(container.querySelectorAll("p").length).toBe(0);
  });

  it("renders the icon slot's content", () => {
    render(<EmptyState title="No prompts yet" icon={<svg role="img" aria-label="empty" />} />);
    expect(screen.getByRole("img", { name: "empty" })).toBeInTheDocument();
  });

  it("renders the action slot's content", () => {
    render(
      <EmptyState
        title="No prompts yet"
        action={<button type="button">Create prompt</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Create prompt" })).toBeInTheDocument();
  });

  it("omits icon and action entirely when neither is given, without throwing", () => {
    render(<EmptyState title="No prompts yet" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<EmptyState title="No prompts yet" className="gap-lg p-xl" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("gap-lg");
    expect(root.className).not.toContain("gap-sm");
    expect(root.className).toContain("p-xl");
    expect(root.className).not.toContain("p-2xl");
  });

  it("accepts arbitrary ReactNode as the title, not just a string", () => {
    render(
      <EmptyState
        title={
          <>
            No <strong>prompts</strong> yet
          </>
        }
      />,
    );
    expect(screen.getByRole("heading")).toHaveTextContent("No prompts yet");
  });
});

it("S4-3 keeps icon, centered shared title, and recovery action in reading order on the original root", () => {
  let clicks = 0;
  const { container } = render(<EmptyState id="empty" dir="rtl" data-host="empty" style={{ marginTop: 9 }} onClick={() => clicks++} icon={<span>Icon</span>} title="Title" description="Support" action={<button>Recover</button>} />);
  const root = container.firstElementChild as HTMLElement;
  expect(root.tagName).toBe("DIV");
  expect(root).toHaveAttribute("id", "empty");
  expect(root).toHaveAttribute("dir", "rtl");
  expect(root.style.marginTop).toBe("9px");
  expect(Array.from(root.children).map(n => n.textContent)).toEqual(["Icon", "TitleSupport", "Recover"]);
  expect(root.children[1]).toHaveClass("items-center", "text-center");
  expect(root.children[2]).toHaveClass("mt-sm");
  expect(root.querySelectorAll("#empty")).toHaveLength(0);
  root.click(); expect(clicks).toBe(1);
});

it("S4 server-renders the supplied title through the real shared Header", () => {
  const markup = renderS4Server(<EmptyState title="Title" description="Support" />);
  expect(markup).toContain("<h2");
  expect(markup).toContain("Title</h2>");
});
