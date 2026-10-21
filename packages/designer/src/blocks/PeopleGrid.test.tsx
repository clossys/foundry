import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PeopleGrid, type PeopleGridPerson } from "./PeopleGrid.js";

const people = (count: number): PeopleGridPerson[] => Array.from({ length: count }, (_, index) => ({ id: String(index), name: `Person ${index}`, role: `Role ${index}`, initials: `P${index}` }));

describe("PeopleGrid", () => {
  it("bounds the collection at two through twelve people [mutant: allow thirteen]", () => {
    for (const count of [1, 13]) {
      expect(() => renderToStaticMarkup(<PeopleGrid people={people(count)} />)).toThrow(TypeError);
      expect(() => renderToStaticMarkup(<PeopleGrid people={people(count)} />)).toThrow(/^PeopleGrid:/);
    }
    for (const count of [2, 12]) {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(<PeopleGrid people={people(count)} />);
      expect(host.querySelectorAll("ul > li")).toHaveLength(count);
    }
  });

  it("renders decorative initials and names at the requested heading level [mutant: name as paragraph]", () => {
    render(<PeopleGrid people={people(2)} headingLevel={4} />);
    expect(screen.getByRole("heading", { level: 4, name: "Person 0" })).toHaveClass("text-body-l", "font-medium");
    const initials = screen.getByText("P0");
    expect(initials.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(initials).toHaveClass("size-14", "shrink-0", "overflow-hidden", "rounded-pill", "bg-surface-sunken", "text-ink-secondary", "font-medium");
    expect(screen.getAllByRole("heading")).toHaveLength(2);
  });

  it("uses one title link per linked person [mutant: wrap card in another anchor]", () => {
    render(<PeopleGrid people={people(2).map(person => ({ ...person, href: `/people/${person.id}` }))} ground="inverse" />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(document.querySelectorAll("a a")).toHaveLength(0);
    for (const [index, entry] of screen.getAllByRole("listitem").entries()) {
      const link = screen.getByRole("link", { name: `Person ${index}` });
      expect(link).toHaveAttribute("href", `/people/${index}`);
      expect(link.parentElement?.tagName).toBe("H3");
      expect(link).toHaveClass("focus-visible:after:outline-accent-on-inverse");
      expect(entry.style.minBlockSize).toBe("var(--ui-layout-tap-target, 44px)");
      expect(entry).toHaveClass("relative", "isolate");
    }
  });

  it("honours four columns and defaults to three [mutant: ignore columns]", () => {
    const four = render(<PeopleGrid people={people(2)} columns={4} />);
    expect(four.container.querySelector("ul")).toHaveClass("grid-cols-1", "tablet:grid-cols-3", "desktop:grid-cols-4", "gap-x-lg", "gap-y-xl");
    four.unmount();
    render(<PeopleGrid people={people(2)} />);
    expect(screen.getByRole("list")).toHaveClass("desktop:grid-cols-3");
  });

  it("uses square media in photo mode and a row in avatar mode [mutant: swap media modes]", () => {
    const photo = render(<PeopleGrid people={people(2)} media="photo" columns={2} />);
    expect(photo.container.querySelectorAll(".aspect-square")).toHaveLength(2);
    expect(photo.container.querySelector(".aspect-square")).toHaveAttribute("aria-hidden", "true");
    expect(photo.container.querySelector(".aspect-square")).toHaveClass("w-full", "overflow-hidden", "rounded-panel");
    expect(photo.container.querySelector("ul")).toHaveClass("grid-cols-2", "tablet:grid-cols-2", "desktop:grid-cols-2");
    photo.unmount();
    const avatar = render(<PeopleGrid people={people(2)} />);
    expect(avatar.container.querySelector(".aspect-square")).toBeNull();
    expect(screen.getAllByRole("listitem")[0]).toHaveClass("flex", "items-start", "gap-md");
  });

  it("refuses interactive bio or role inside a linked person [mutant: drop nested-interactive assertion]", () => {
    for (const field of ["bio", "role"] as const) {
      const entries = people(2);
      entries[0] = { ...entries[0]!, href: "/person", [field]: <a href="/other">Other destination</a> };
      expect(() => renderToStaticMarkup(<PeopleGrid people={entries} />)).toThrow(TypeError);
      expect(() => renderToStaticMarkup(<PeopleGrid people={entries} />)).toThrow(/^PeopleGrid:/);
    }
  });

  it("uses ground-relative initials fills and secondary role ink", () => {
    for (const [ground, fill, primary, secondary] of [["base", "bg-surface-sunken", "text-ink-primary", "text-ink-secondary"], ["sunken", "bg-surface-raised", "text-ink-primary", "text-ink-secondary"], ["inverse", "bg-surface-inverse-raised", "text-ink-on-inverse", "text-ink-on-inverse-muted"]] as const) {
      const result = render(<PeopleGrid people={people(2)} ground={ground} />);
      expect(screen.getByText("P0")).toHaveClass(fill, ground === "inverse" ? primary : secondary);
      expect(screen.getByRole("heading", { name: "Person 0" })).toHaveClass(primary);
      expect(screen.getByText("Role 0")).toHaveClass("text-body-s", secondary);
      result.unmount();
    }
  });

  it("forwards host list attributes and renders supplied portraits and bio", () => {
    const entries = people(2);
    entries[0] = { ...entries[0]!, portrait: <svg data-testid="portrait" />, bio: "Keeps shared notes clear." };
    render(<PeopleGrid people={entries} aria-label="Reviewers" aria-labelledby="people" id="reviewers" className="gap-y-lg" style={{ marginBlockStart: "8px" }} />);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    expect(list).toHaveAttribute("aria-label", "Reviewers");
    expect(list).toHaveAttribute("aria-labelledby", "people");
    expect(list).toHaveAttribute("id", "reviewers");
    expect(list).toHaveClass("gap-y-lg");
    expect(list.style.marginBlockStart).toBe("8px");
    expect(screen.getByTestId("portrait").parentElement).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText("P0")).not.toBeInTheDocument();
    expect(screen.getByText("Keeps shared notes clear.")).toHaveClass("text-body-s");
  });
});
