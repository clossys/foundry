import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CollectionView } from "./CollectionView.js";

const empty = { title: "Nothing published yet.", description: "Check back soon." };

describe("CollectionView", () => {
  it("renders semantic entry articles with unique linked titles, time elements, tag lists, and pagination navigation", () => {
    const html = renderToStaticMarkup(
      <CollectionView
        brand="Acme"
        heading="Notes"
        focusTargetId="notes-heading"
        entries={[{ id: "one", href: "/notes/one", title: "First note", date: { dateTime: "2026-09-01", text: "September 1, 2026" }, summary: "A fixture entry.", tags: ["Release", "News"] }]}
        empty={empty}
        pagination={{ next: { href: "/notes?page=2", label: "Next page" } }}
      />,
    );
    expect(html).toContain('<article');
    expect(html).toContain('<h2 class="text-h2');
    expect(html).toContain('<a href="/notes/one"');
    expect(html).toContain('<time dateTime="2026-09-01"');
    expect(html).toContain('aria-label="Tags"');
    expect(html).toContain('aria-label="Collection pagination"');
    expect(html).toContain('id="notes-heading" tabindex="-1"');
  });

  it("renders an explicit accessible empty state instead of a blank list", () => {
    const html = renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[]} empty={empty} />);
    expect(html).toContain("Nothing published yet.");
    expect(html).not.toContain('aria-label="Collection entries"');
  });

  it("fails closed on malformed or duplicate entry identity", () => {
    const malformed = [{ id: "", href: "/notes/one", title: "Broken", date: { dateTime: "2026-09-01", text: "Date" } }];
    const duplicate = [
      { id: "one", href: "/notes/one", title: "One", date: { dateTime: "2026-09-01", text: "Date" } },
      { id: "one", href: "/notes/two", title: "Two", date: { dateTime: "2026-09-02", text: "Date" } },
    ];
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={malformed} empty={empty} />)).toThrow(/non-empty id/);
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={duplicate} empty={empty} />)).toThrow(/duplicate entry id/);
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[]} empty={null as never} />)).toThrow(/explicit empty state/);
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[]} empty={empty} focusTargetId="" />)).toThrow(/focusTargetId/);
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[]} empty={empty} pagination={{ next: { href: "/notes?page=2", label: "" } }} />)).toThrow(/pagination.next/);
  });
});
