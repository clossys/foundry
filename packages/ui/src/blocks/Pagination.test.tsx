import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pagination } from "./Pagination.js";

describe("Pagination", () => {
  it("renders a <nav> landmark", () => {
    render(<Pagination page={1} pageCount={5} onPageChange={() => {}} />);
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeInTheDocument();
  });

  it("accepts a custom aria-label for the nav landmark", () => {
    render(<Pagination page={1} pageCount={5} onPageChange={() => {}} aria-label="Prompt pages" />);
    expect(screen.getByRole("navigation", { name: "Prompt pages" })).toBeInTheDocument();
  });

  it("marks the current page with aria-current=\"page\", and no other page", () => {
    render(<Pagination page={2} pageCount={4} onPageChange={() => {}} />);
    const current = screen.getByRole("button", { name: "2" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "1" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "3" })).not.toHaveAttribute("aria-current");
  });

  it("fires onPageChange with the requested page when a page number is clicked", async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<Pagination page={1} pageCount={4} onPageChange={onPageChange} />);
    await user.click(screen.getByRole("button", { name: "3" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("fires onPageChange with page + 1 / page - 1 from the next/previous controls", async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<Pagination page={2} pageCount={4} onPageChange={onPageChange} />);
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("defaults the previous/next controls' accessible names to \"Previous page\"/\"Next page\"", () => {
    render(<Pagination page={2} pageCount={4} onPageChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeInTheDocument();
  });

  it("accepts custom previousPageLabel/nextPageLabel that replace the defaults", () => {
    render(
      <Pagination
        page={2}
        pageCount={4}
        onPageChange={() => {}}
        previousPageLabel="Página anterior"
        nextPageLabel="Página siguiente"
      />,
    );
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Previous page" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
  });

  it("disables the previous control on the first page, and the next control on the last page", () => {
    const { rerender } = render(<Pagination page={1} pageCount={4} onPageChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).not.toBeDisabled();

    rerender(<Pagination page={4} pageCount={4} onPageChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous page" })).not.toBeDisabled();
  });

  it("never advances the page itself: rerendering with the same page after a click leaves aria-current unchanged", async () => {
    const user = userEvent.setup();
    render(<Pagination page={1} pageCount={4} onPageChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: "3" }));
    // No onPageChange side effect applied `page` itself — still page 1.
    expect(screen.getByRole("button", { name: "1" })).toHaveAttribute("aria-current", "page");
  });

  it("shows every page number when pageCount is small", () => {
    render(<Pagination page={1} pageCount={5} onPageChange={() => {}} />);
    for (const n of [1, 2, 3, 4, 5]) {
      expect(screen.getByRole("button", { name: String(n) })).toBeInTheDocument();
    }
    expect(screen.queryByText("…")).not.toBeInTheDocument();
  });

  it("truncates with an ellipsis for a large page count, always keeping first, last, and the current page reachable", () => {
    render(<Pagination page={10} pageCount={30} onPageChange={() => {}} />);
    expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "10" })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByText("…").length).toBeGreaterThan(0);
    // A page far from both the current page and either edge is truncated away.
    expect(screen.queryByRole("button", { name: "20" })).not.toBeInTheDocument();
  });

  it("renders a plain \"Page X of Y\" range summary without totalItems", () => {
    render(<Pagination page={2} pageCount={5} onPageChange={() => {}} />);
    expect(screen.getByText("Page 2 of 5")).toBeInTheDocument();
  });

  it("renders a \"Showing X–Y of N\" range summary when totalItems and pageSize are given", () => {
    render(
      <Pagination page={2} pageCount={5} onPageChange={() => {}} totalItems={42} pageSize={10} />,
    );
    expect(screen.getByText("Showing 11–20 of 42")).toBeInTheDocument();
  });

  it("clamps the last page's range summary to totalItems", () => {
    render(
      <Pagination page={5} pageCount={5} onPageChange={() => {}} totalItems={42} pageSize={10} />,
    );
    expect(screen.getByText("Showing 41–42 of 42")).toBeInTheDocument();
  });

  it("omits the page-size selector region when pageSizeOptions/onPageSizeChange are not both given", () => {
    render(<Pagination page={1} pageCount={5} onPageChange={() => {}} />);
    expect(screen.queryByText("Rows per page")).not.toBeInTheDocument();
  });

  it("renders the page-size selector region, and fires onPageSizeChange with a chosen size", async () => {
    const onPageSizeChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Pagination
        page={1}
        pageCount={5}
        onPageChange={() => {}}
        pageSize={10}
        pageSizeOptions={[10, 25, 50]}
        onPageSizeChange={onPageSizeChange}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Rows per page/ });
    expect(trigger).toHaveAccessibleName(expect.stringContaining("10"));
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "25" }));
    expect(onPageSizeChange).toHaveBeenCalledWith(25);
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    render(<Pagination page={1} pageCount={5} onPageChange={() => {}} className="gap-lg" />);
    const nav = screen.getByRole("navigation");
    expect(nav.className).toContain("gap-lg");
    expect(nav.className).not.toContain("gap-md");
  });

  it("forwards a consumer style prop", () => {
    render(<Pagination page={1} pageCount={5} onPageChange={() => {}} style={{ marginTop: "8px" }} />);
    const nav = screen.getByRole("navigation");
    expect(nav.style.marginTop).toBe("8px");
  });
});
