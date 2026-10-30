import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ShellCopyProvider } from "../components/Banner.copy-context.js";
import type { ShellCopyResolver } from "../components/Banner.copy.js";
import { PAGINATION_COPY_REFS, Pagination } from "./Pagination.js";

const copy = {
  "aria-label": "Writer navigation",
  previousPageLabel: "Writer back",
  nextPageLabel: "Writer forward",
  noResultsLabel: "Writer empty",
  rangeSummaryMessage: (start: number, end: number, total: number) => `Writer range ${start}/${end}/${total}`,
  pageSummaryMessage: (page: number, count: number) => `Writer page ${page}/${count}`,
  pageSizeLabel: "Writer size",
};

describe("Pagination copy boundary", () => {
  it("uses explicit copy for names and summaries, retaining native keyboard activation and controlled state", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination {...copy} page={2} pageCount={4} onPageChange={onPageChange} />);
    expect(screen.getByRole("navigation", { name: copy["aria-label"] })).toBeInTheDocument();
    expect(screen.getByText("Writer page 2/4")).toBeInTheDocument();
    const previous = screen.getByRole("button", { name: copy.previousPageLabel });
    expect(previous.tagName).toBe("BUTTON");
    await user.tab();
    expect(previous).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onPageChange).toHaveBeenLastCalledWith(1);
    expect(screen.getByRole("button", { name: "2" })).toHaveAttribute("aria-current", "page");
    const next = screen.getByRole("button", { name: copy.nextPageLabel });
    next.focus();
    await user.keyboard(" ");
    expect(onPageChange).toHaveBeenLastCalledWith(3);
  });

  it("passes the live clamped range to caller copy and uses the empty copy for no pages", () => {
    const rangeSummaryMessage = vi.fn(copy.rangeSummaryMessage);
    const { rerender } = render(<Pagination {...copy} rangeSummaryMessage={rangeSummaryMessage} page={5} pageCount={5} pageSize={10} totalItems={42} onPageChange={() => {}} />);
    expect(rangeSummaryMessage).toHaveBeenCalledWith(41, 42, 42);
    expect(screen.getByText("Writer range 41/42/42")).toBeInTheDocument();
    rerender(<Pagination {...copy} page={1} pageCount={0} onPageChange={() => {}} />);
    expect(screen.getByText(copy.noResultsLabel)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.previousPageLabel })).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.nextPageLabel })).toBeDisabled();
  });

  it("keeps summary and decorative truncation in semantic content components", () => {
    render(<Pagination {...copy} page={10} pageCount={30} onPageChange={() => {}} />);
    const summary = screen.getByText("Writer page 10/30");
    expect(summary.tagName).toBe("P");
    for (const ellipsis of screen.getAllByText("…")) {
      expect(ellipsis.tagName).toBe("SPAN");
      expect(ellipsis).toHaveAttribute("aria-hidden", "true");
    }
    const source = readFileSync(join(import.meta.dirname, "Pagination.tsx"), "utf8");
    expect(source).toContain('<SemanticContent as="p"');
    expect(source).toContain('<SemanticContent as="span"');
    expect(source).not.toMatch(/^\s*<(?:p|span|a|button|input)\b/m);
  });

  for (const label of ["previousPageLabel", "nextPageLabel", "aria-label", "noResultsLabel", "pageSizeLabel"])
    it(`refuses an empty ${label} instead of supplying English or an unnamed region`, () => {
      expect(() => render(<Pagination {...copy} {...{ [label]: " " }} page={1} pageCount={0} pageSizeOptions={[10]} onPageSizeChange={() => {}} onPageChange={() => {}} />)).toThrow(/Pagination:.*nonempty/);
    });

  for (const label of ["previousPageLabel", "nextPageLabel", "aria-label", "noResultsLabel", "pageSizeLabel"])
    it(`requires a host resolver when ${label} is omitted`, () => {
      expect(() => render(<Pagination {...copy} {...{ [label]: undefined }} page={1} pageCount={0} pageSizeOptions={[10]} onPageSizeChange={() => {}} onPageChange={() => {}} />)).toThrow(/resolver/);
    });

  it("refuses empty summaries from explicit message functions", () => {
    expect(() => render(<Pagination {...copy} pageSummaryMessage={() => " "} page={1} pageCount={2} onPageChange={() => {}} />)).toThrow(/Pagination:.*nonempty/);
    expect(() => render(<Pagination {...copy} rangeSummaryMessage={() => " "} page={1} pageCount={2} pageSize={10} totalItems={20} onPageChange={() => {}} />)).toThrow(/Pagination:.*nonempty/);
  });

  it("resolves omitted copy through the inherited host resolver with live Writer values", () => {
    const resolver = vi.fn<ShellCopyResolver>(ref => ({ ref, text: `Writer ${ref.id} ${JSON.stringify(ref.values ?? {})}` }));
    const { rerender } = render(<ShellCopyProvider resolver={resolver}><Pagination page={5} pageCount={5} totalItems={42} pageSize={10} pageSizeOptions={[10, 25]} onPageSizeChange={() => {}} onPageChange={() => {}} /></ShellCopyProvider>);
    expect(screen.getByRole("navigation")).toHaveAccessibleName(`Writer ${PAGINATION_COPY_REFS["aria-label"].id} {}`);
    expect(screen.getByRole("button", { name: `Writer ${PAGINATION_COPY_REFS.previousPageLabel.id} {}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Writer ${PAGINATION_COPY_REFS.nextPageLabel.id} {}` })).toBeDisabled();
    expect(resolver).toHaveBeenCalledWith({ ...PAGINATION_COPY_REFS.rangeSummaryMessage, values: { start: 41, end: 42, total: 42 } });
    expect(resolver).toHaveBeenCalledWith(PAGINATION_COPY_REFS.pageSizeLabel);
    rerender(<ShellCopyProvider resolver={resolver}><Pagination page={2} pageCount={5} onPageChange={() => {}} /></ShellCopyProvider>);
    expect(resolver).toHaveBeenCalledWith({ ...PAGINATION_COPY_REFS.pageSummaryMessage, values: { page: 2, pageCount: 5 } });
    rerender(<ShellCopyProvider resolver={resolver}><Pagination page={1} pageCount={0} onPageChange={() => {}} /></ShellCopyProvider>);
    expect(screen.getByText(`Writer ${PAGINATION_COPY_REFS.noResultsLabel.id} {}`)).toBeInTheDocument();
  });

  it("prefers the explicit resolver over context and explicit copy over either resolver", () => {
    const inherited = vi.fn<ShellCopyResolver>(ref => ({ ref, text: `Inherited ${ref.id}` }));
    const explicit = vi.fn<ShellCopyResolver>(ref => ({ ref, text: `Explicit ${ref.id}` }));
    const { rerender, container } = render(<ShellCopyProvider resolver={inherited}><Pagination copyResolver={explicit} page={1} pageCount={2} onPageChange={() => {}} /></ShellCopyProvider>);
    expect(screen.getByRole("navigation")).toHaveAccessibleName(`Explicit ${PAGINATION_COPY_REFS["aria-label"].id}`);
    expect(inherited).not.toHaveBeenCalled();
    expect(container.innerHTML).not.toContain("copyresolver");
    explicit.mockClear();
    rerender(<ShellCopyProvider resolver={inherited}><Pagination {...copy} copyResolver={explicit} page={1} pageCount={2} onPageChange={() => {}} /></ShellCopyProvider>);
    expect(screen.getByRole("navigation")).toHaveAccessibleName(copy["aria-label"]);
    expect(explicit).not.toHaveBeenCalled();
    expect(inherited).not.toHaveBeenCalled();
  });

  it("refuses omitted copy without a host resolver", () => {
    expect(() => render(<Pagination page={1} pageCount={2} onPageChange={() => {}} />)).toThrow(/resolver/);
  });

  const refusingResolvers: ShellCopyResolver[] = [
    () => undefined,
    ref => ({ ref: { ...ref, id: "wrong" }, text: "Wrong" }),
    ref => ({ ref: { ...ref, locale: "wrong" }, text: "Wrong" }),
    ref => ({ ref, text: " " }),
  ];
  for (const [index, resolver] of refusingResolvers.entries())
    it(`refuses invalid host resolution ${index} without falling back`, () => {
      expect(() => render(<Pagination copyResolver={resolver} page={1} pageCount={2} onPageChange={() => {}} />)).toThrow(/unresolved/);
    });
});
