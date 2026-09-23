import { describe, expect, it } from "vitest";
import { buildEmailSignatureHtml, buildEmailSignatureText, type EmailSignaturePerson } from "./emailSignature.js";

const person: EmailSignaturePerson = {
  name: "Taylor Rivera",
  role: "Head of Partnerships",
  company: "Acme Corp",
  links: [
    { label: "Website", href: "https://example.test" },
    { label: "Book time", href: "https://example.test/book" },
  ],
  logoUrl: "https://example.test/logo.png",
  logoAlt: "Acme Corp logo",
};

describe("buildEmailSignatureHtml", () => {
  it("includes name, role, company, and every link", () => {
    const html = buildEmailSignatureHtml(person);
    expect(html).toContain("Taylor Rivera");
    expect(html).toContain("Head of Partnerships");
    expect(html).toContain("Acme Corp");
    expect(html).toContain('href="https://example.test"');
    expect(html).toContain('href="https://example.test/book"');
  });

  it("includes the logo image when logoUrl is given", () => {
    const html = buildEmailSignatureHtml(person);
    expect(html).toContain('src="https://example.test/logo.png"');
    expect(html).toContain('alt="Acme Corp logo"');
  });

  it("omits the logo cell entirely when logoUrl is not given", () => {
    const { logoUrl: _logoUrl, logoAlt: _logoAlt, ...withoutLogo } = person;
    const html = buildEmailSignatureHtml(withoutLogo);
    expect(html).not.toContain("<img");
  });

  it("escapes html-unsafe characters in every field", () => {
    const html = buildEmailSignatureHtml({ ...person, name: "<b>Taylor</b>" });
    expect(html).not.toContain("<b>Taylor</b>");
    expect(html).toContain("&lt;b&gt;Taylor&lt;/b&gt;");
  });

  it("is table-based, matching this package's own email-HTML discipline", () => {
    expect(buildEmailSignatureHtml(person)).toMatch(/^<table/);
  });
});

describe("buildEmailSignatureText", () => {
  it("includes name, role/company on one line, and every link", () => {
    const text = buildEmailSignatureText(person);
    expect(text).toContain("Taylor Rivera");
    expect(text).toContain("Head of Partnerships · Acme Corp");
    expect(text).toContain("Website: https://example.test");
    expect(text).toContain("Book time: https://example.test/book");
  });

  it("omits the links line entirely when there are no links", () => {
    const text = buildEmailSignatureText({ ...person, links: [] });
    expect(text.split("\n")).toHaveLength(2);
  });

  it("contains no HTML markup", () => {
    expect(buildEmailSignatureText(person)).not.toMatch(/<[a-z]/i);
  });
});
