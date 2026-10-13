// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import * as web from "@clossys/publisher/web";
// The public web subpath selects this entry under the react-server condition;
// there is no separate ./web/server export in the package manifest.
import * as server from "../server.js";
import * as client from "@clossys/publisher/web/client";
import * as views from "./index.js";
import * as serverViews from "./server.js";
import type { ConstructionStatusInput } from "./constructionStatus.js";

const ref = (id: string): CopyRef => ({ id });
const texts: Record<string, string> = {
  "construction.title": "Careers",
  "construction.description": "This page is not available yet.",
  "construction.action": "Back to home",
  "construction.destinations": "Useful destinations",
  "construction.help": "Help",
  "construction.helpDescription": "Find answers to common questions.",
  "construction.contact": "Contact",
};
const resolver = (copy: Record<string, string> = texts): CopyResolver => (value) => {
  const text = copy[value.id];
  return text === undefined ? undefined : {
    ref: value, text, recordId: "record", revision: "1", locale: "en",
    source: { kind: "consumer", reference: "fixture" }, entryId: value.id,
  };
};
const input = (): ConstructionStatusInput => ({
  title: ref("construction.title"), description: ref("construction.description"),
  action: { label: ref("construction.action"), href: "/" },
});
const destinations = (count = 2): NonNullable<ConstructionStatusInput["destinations"]> => ({
  label: ref("construction.destinations"),
  items: Array.from({ length: count }, (_, index) => ({
    id: `destination-${index}`, heading: ref(index === 0 ? "construction.help" : "construction.contact"),
    ...(index === 0 ? { description: ref("construction.helpDescription") } : {}),
    href: index === 0 ? "/help" : index === 1 ? "/contact" : `/contact/${index}`,
  })),
});
function documentFor(value = input(), resolve = resolver(), entry = web): Document {
  const html = renderToStaticMarkup(<entry.StatusView {...entry.constructionStatusProps(value, resolve)} />);
  return new DOMParser().parseFromString(html, "text/html");
}
function refusal(value: ConstructionStatusInput, resolve: CopyResolver, path: string): void {
  let error: unknown;
  try { web.constructionStatusProps(value, resolve); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(web.RenderError);
  expect(error).toMatchObject({ reason: "resolution-failed", message: `constructionStatusProps could not resolve ${path}.` });
  const message = (error as Error).message;
  for (const secret of [...Object.keys(texts), ...Object.values(texts), "/help", "/contact", "javascript:alert(1)", "unresolved-ref"]) {
    expect(message).not.toContain(secret);
  }
}

describe("constructionStatusProps", () => {
  it("exports the composition from every entry", () => {
    for (const entry of [web, server, client, views, serverViews]) {
      expect(entry.constructionStatusProps).toBeTypeOf("function");
    }
  });
  it("exports through the actual react-server condition", () => {
    const result = execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", `
      import { constructionStatusProps } from "@clossys/publisher/web";
      const resolve = ref => ({ ref, text: ref.id, recordId: "record", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: ref.id });
      const props = constructionStatusProps({ title: { id: "Careers" }, description: { id: "This page is not available yet." }, action: { label: { id: "Back to home" }, href: "/" } }, resolve);
      console.log(JSON.stringify({ status: props.status, subtitle: props.subtitle, action: props.action.props }));
    `], { cwd: process.cwd(), encoding: "utf8" });
    expect(JSON.parse(result)).toEqual({
      status: "Careers", subtitle: "This page is not available yet.",
      action: expect.objectContaining({ href: "/", children: ["Back to home", null], "data-action-emphasis": "primary" }),
    });
  });
  it("renders only resolved copy and one primary action using tokens", () => {
    const doc = documentFor();
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect(doc.querySelector("h1")?.textContent).toBe(texts["construction.title"]);
    expect(doc.querySelector("p")?.textContent).toBe(texts["construction.description"]);
    const links = doc.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("/");
    expect(links[0]?.getAttribute("data-action-emphasis")).toBe("primary");
    expect(links[0]?.className).toContain("bg-accent");
    expect(doc.body.textContent).toBe("CareersThis page is not available yet.Back to home");
    expect(doc.querySelector("main")).toBeNull();
    expect(Object.keys(web.constructionStatusProps(input(), resolver())).sort()).toEqual(["action", "status", "subtitle"]);
  });
  it.each([1, 2, 6])("renders %i destinations as canonical Items in authored order", (count) => {
    const value = { title: input().title, description: input().description, destinations: destinations(count) };
    const doc = documentFor(value);
    expect(doc.querySelector("h2")?.textContent).toBe(texts["construction.destinations"]);
    // Canonical linked Items place a nonbreaking space before their decorative icon.
    expect([...doc.querySelectorAll("h3")].map((heading) => heading.textContent?.replace(/\u00a0/g, ""))).toEqual([
      "Help", ...Array.from({ length: count - 1 }, () => "Contact"),
    ]);
    expect([...doc.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "/help", ...Array.from({ length: count - 1 }, (_, index) => index === 0 ? "/contact" : `/contact/${index + 1}`),
    ]);
    expect(doc.body.textContent?.replace(/\u00a0/g, "")).toBe("CareersThis page is not available yet.Useful destinationsHelpFind answers to common questions." + "Contact".repeat(count - 1));
    expect(doc.querySelector("[data-action-emphasis]")).toBeNull();
    expect(doc.querySelector("[data-items]")?.getAttribute("data-arrangement") ?? null).toBe(count === 1 ? null : "rows");
    expect(doc.querySelector("main")).toBeNull();
  });
  it("ordinary and server entries give identical markup", () => {
    const value = { ...input(), destinations: destinations() };
    const ordinary = renderToStaticMarkup(<web.StatusView {...web.constructionStatusProps(value, resolver())} />);
    const alternate = renderToStaticMarkup(<server.StatusView {...server.constructionStatusProps(value, resolver())} />);
    expect(alternate).toBe(ordinary);
  });
  it("README copy contains no internal-status wording", () => {
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    for (const text of [texts["construction.title"]!, texts["construction.description"]!, texts["construction.action"]!]) {
      expect(readme).toContain(text);
    }
    expect(documentFor().body.textContent).not.toMatch(/pending review|under review|draft|todo|tbd|placeholder|lorem/i);
  });
  const copyPaths = ["title", "description", "action.label", "destinations.label", "destinations.items[0].heading", "destinations.items[0].description"] as const;
  it.each(copyPaths)("refuses unresolved copy at %s without echoing values", (path) => {
    const value = { ...input(), destinations: destinations() };
    const refs = [value.title, value.description, value.action!.label, value.destinations.label, value.destinations.items[0]!.heading, value.destinations.items[0]!.description!];
    refusal(value, (copy) => copy.id === refs[copyPaths.indexOf(path)]!.id ? undefined : resolver()(copy), path);
  });
  it.each(copyPaths)("refuses blank copy at %s without fallback", (path) => {
    const value = { ...input(), destinations: destinations() };
    const refs = [value.title, value.description, value.action!.label, value.destinations.label, value.destinations.items[0]!.heading, value.destinations.items[0]!.description!];
    refusal(value, resolver({ ...texts, [refs[copyPaths.indexOf(path)]!.id]: " \n\t" }), path);
  });
  it("refuses no action and no destinations", () => {
    refusal({ title: input().title, description: input().description }, resolver(), "action or destinations");
  });
  it.each([0, 7])("refuses %i destinations", (count) => {
    refusal({ ...input(), destinations: destinations(count) }, resolver(), "destinations.items");
  });
  it("refuses duplicate destination ids without echoing them", () => {
    const links = destinations();
    refusal({ ...input(), destinations: { ...links, items: [links.items[0]!, links.items[0]!] } }, resolver(), "destinations.items[1].id");
  });
  it.each(["javascript:alert(1)", "//example.com", " /help", "https://user:secret@example.com", "/\\example.com", ""]) ("refuses unsafe action href %s", (href) => {
    refusal({ ...input(), action: { label: input().action!.label, href } }, resolver(), "action.href");
  });
  it("refuses unsafe destination href", () => {
    const links = destinations(1);
    refusal({ ...input(), destinations: { ...links, items: [{ ...links.items[0]!, href: "javascript:alert(1)" }] } }, resolver(), "destinations.items[0].href");
  });
  it.each(["#help", "/help", "https://example.com/help", "http://example.com/help", "mailto:help@example.com"])("accepts sanctioned href %s", (href) => {
    expect(documentFor({ ...input(), action: { label: input().action!.label, href } }).querySelector("a")?.getAttribute("href")).toBe(href);
  });
  it("refuses unknown fields on each closed input shape", () => {
    const links = destinations(1);
    const cases: [unknown, string][] = [
      [{ ...input(), extra: "unresolved-ref" }, "input"],
      [{ ...input(), action: { ...input().action!, extra: true } }, "action"],
      [{ ...input(), destinations: { ...links, extra: true } }, "destinations"],
      [{ ...input(), destinations: { ...links, items: [{ ...links.items[0]!, extra: true }] } }, "destinations.items[0]"],
      [{ ...input(), title: { ...input().title, extra: true } }, "title"],
    ];
    for (const [value, path] of cases) refusal(value as ConstructionStatusInput, resolver(), path);
  });
  it("refuses sparse destinations and malformed ids", () => {
    const links = destinations(1);
    refusal({ ...input(), destinations: { ...links, items: new Array(1) } }, resolver(), "destinations.items[0]");
    refusal({ ...input(), destinations: { ...links, items: [{ ...links.items[0]!, id: " " }] } }, resolver(), "destinations.items[0].id");
  });
});
