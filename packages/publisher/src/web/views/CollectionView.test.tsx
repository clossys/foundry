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
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={malformed} empty={empty} />)).toThrow(/non-whitespace id/);
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={duplicate} empty={empty} />)).toThrow(/duplicate entry id/);
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[]} empty={null as never} />)).toThrow(/explicit empty state/);
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[]} empty={empty} focusTargetId="" />)).toThrow(/focusTargetId/);
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[]} empty={empty} pagination={{ next: { href: "/notes?page=2", label: "" } }} />)).toThrow(/pagination.next/);
  });

  it("rejects whitespace content, invalid dates, malformed empty states, and invalid tags", () => {
    const validEntry = { id: "one", href: "/notes/one", title: "One", date: { dateTime: "2026-09-01", text: "September 1" } };
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[{ ...validEntry, href: "  " }]} empty={empty} />)).toThrow(/sanctioned URL form/);
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[{ ...validEntry, title: "  " }]} empty={empty} />)).toThrow(/non-whitespace/);
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[{ ...validEntry, date: { dateTime: "2026-02-30", text: "  " } }]} empty={empty} />)).toThrow(/valid date.dateTime/);
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[{ ...validEntry, date: { dateTime: "2026-09-01", text: "  " } }]} empty={empty} />)).toThrow(/date text/);
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[{ ...validEntry, tags: ["valid", "  "] }]} empty={empty} />)).toThrow(/entry tag/);
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[{ ...validEntry, tags: [42 as never] }]} empty={empty} />)).toThrow(/entry tag/);
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[]} empty={{ title: "  " }} />)).toThrow(/explicit empty state/);
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[]} empty={{ title: 42 } as never} />)).toThrow(/explicit empty state/);
  });

  it("rejects sparse tag arrays without silently dropping an entry", () => {
    const validEntry = { id: "one", href: "/notes/one", title: "One", date: { dateTime: "2026-09-01", text: "September 1" } };
    const sparse = new Array(2);
    sparse[0] = "valid";
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[{ ...validEntry, tags: sparse }]} empty={empty} />)).toThrow(/dense array/);
  });

  it("rejects unsafe entry, empty-state, and pagination URL schemes", () => {
    const validEntry = { id: "one", href: "/notes/one", title: "One", date: { dateTime: "2026-09-01", text: "September 1" } };
    for (const href of ["javascript:alert(1)", "data:text/plain,unsafe", "vbscript:msgbox", "file:///tmp/unsafe", "//untrusted.example"]) {
      expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[{ ...validEntry, href }]} empty={empty} />)).toThrow(/sanctioned URL form/);
      expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[]} empty={{ ...empty, action: { href, label: "Continue" } }} />)).toThrow(/sanctioned href/);
      expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[]} empty={empty} pagination={{ next: { href, label: "Next" } }} />)).toThrow(/sanctioned href/);
    }
  });

  it("rejects URL credentials, control characters, and accessor-shaped hrefs without invoking the accessor", () => {
    const validEntry = { id: "one", href: "/notes/one", title: "One", date: { dateTime: "2026-09-01", text: "September 1" } };
    for (const href of ["https://user:password@example.com/", "https:\\\\example.com", "mailto:\n@example.com", "/notes/one\nnext"]) {
      expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[{ ...validEntry, href }]} empty={empty} />)).toThrow(/non-whitespace id|sanctioned URL form/);
    }
    const accessorEntry = { ...validEntry };
    Object.defineProperty(accessorEntry, "href", { enumerable: true, get: () => { throw new Error("href getter must not run"); } });
    expect(() => renderToStaticMarkup(<CollectionView brand="Acme" heading="Notes" entries={[accessorEntry]} empty={empty} />)).toThrow(/non-whitespace id/);
  });
});
