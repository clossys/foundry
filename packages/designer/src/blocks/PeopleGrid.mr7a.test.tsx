import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PeopleGrid } from "./PeopleGrid.js";

const people = [{ id: "one", name: "Person one", initials: "P1", role: "Role one", bio: "Bio one", href: "/people/one" }, { id: "two", name: "Person two", initials: "P2" }];

describe("MR-7a people evidence", () => {
  it("composes canonical primitives without raw styled elements [mutant: raw styled role paragraph]", () => {
    const source = readFileSync(join(import.meta.dirname, "PeopleGrid.tsx"), "utf8");
    expect(source).not.toMatch(/<(?:a|button|input)\b/);
    expect(source).not.toMatch(/<(?:p|span)\b[^>]*(?:className|style)=/);
    expect(source).toContain("SemanticContent");
  });

  it("retains decorative portraits, authored names, roles and linked card semantics", () => {
    const markup = renderToStaticMarkup(<PeopleGrid people={people} headingLevel={4} />);
    expect(markup.match(/<li\b/g)).toHaveLength(2);
    expect(markup).toContain('<h4 class="m-0 text-body-l font-medium text-ink-primary">');
    expect(markup).toContain('href="/people/one"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("Role one");
    expect(markup).toContain("Bio one");
  });
});
