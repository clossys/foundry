// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { ItemData } from "@clossys/designer/blocks/server";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import type { SiteShellInput } from "@clossys/designer/frames";
import { SITE_MAIN_ID } from "@clossys/designer/frames";
import { StatusView, type StatusViewProps } from "./StatusView.js";
import { GlobalErrorDocument } from "./GlobalErrorDocument.js";
import type { GlobalErrorDocumentFramedProps, GlobalErrorDocumentProps } from "./GlobalErrorDocument.js";

afterEach(cleanup);

type Routes = { label: string; items: readonly (ItemData & { href: string })[] };
const route = (id: string): ItemData & { href: string } => ({ id, heading: `Destination ${id}`, description: `Support ${id}`, href: `/destination/${id}` });
const routes = (count: number): Routes => ({ label: "Next destinations", items: Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze(route(String(index))))) });
// Exercise runtime boundary inputs that the static props deliberately reject.
function draw(input?: unknown) {
  const props = { status: "404", subtitle: "This page is unavailable.", action: <button>Try again</button>, notes: <a href="/contact">Contact us</a>, ...(input === undefined ? {} : { routes: input }) } as StatusViewProps & { routes?: Routes };
  return render(<StatusView {...props} />);
}
function statusMarkup(input: unknown): string {
  return renderToStaticMarkup(<StatusView {...({ status: "404", routes: input } as StatusViewProps & { routes: Routes })} />);
}

describe("StatusView next destinations", () => {
  it.each([undefined, { label: "No destinations", items: [] }, { items: [] }, { label: null, items: [] }, { label: "", items: [] }])("emits no route wrapper, label or DOM prop for omitted or empty destinations", input => {
    const { container } = draw(input);
    expect(container.querySelector("section:not([data-designer-section-frame]), [data-item], [data-items], [routes]")).toBeNull();
    expect(container.querySelectorAll("[data-designer-section-frame]")).toHaveLength(1);
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(container.textContent).not.toContain("No destinations");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact us" })).toHaveAttribute("href", "/contact");
  });
  it("renders one destination through standalone Item under a visibly named region", () => {
    const { container } = draw(routes(1));
    const region = screen.getByRole("region", { name: "Next destinations" });
    expect(region.tagName).toBe("SECTION");
    expect(region).not.toHaveAttribute("aria-label");
    const labelId = region.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(within(region).getByRole("heading", { level: 2, name: "Next destinations" })).toHaveAttribute("id", labelId);
    expect(within(region).getByRole("heading", { level: 2, name: "Next destinations" })).toBeVisible();
    expect(region.querySelectorAll("[data-item]")).toHaveLength(1);
    expect(region.querySelector("[data-items]")).toBeNull();
    expect(within(region).getByRole("link", { name: "Destination 0" })).toHaveAttribute("href", "/destination/0");
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("main, header, footer")).toBeNull();
  });
  it.each([2, 3, 4, 5, 6])("renders %s destinations as canonical rows in authored order", count => {
    const input = routes(count);
    input.items = Object.freeze([...input.items].reverse());
    draw(input);
    const region = screen.getByRole("region", { name: input.label });
    expect(region.querySelector('[data-items][data-arrangement="rows"]')?.tagName).toBe("UL");
    expect(region.querySelector("[data-items]")).toHaveAttribute("data-treatment", "plain");
    expect(within(region).getAllByRole("listitem")).toHaveLength(count);
    expect(within(region).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(input.items.map(item => item.href));
    expect(within(region).getAllByRole("link").map(link => link.textContent?.trim())).toEqual(input.items.map(item => item.heading));
    expect(within(region).getByRole("heading", { level: 2, name: input.label })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "404" })).toBeInTheDocument();
    expect(screen.getByText("This page is unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact us" })).toHaveAttribute("href", "/contact");
  });
  const CALLER_SENTINEL = "CALLER_ROUTE_INPUT";
  const ERRORS = {
    array: "StatusView: routes must provide an item array.",
    label: "StatusView: routes need a nonblank label.",
    cap: "StatusView: routes allow at most six linked items.",
    dense: "StatusView: routes need a dense item array.",
    destination: "StatusView: every route needs a destination.",
  } as const;
  const sparseOne = Array(1);
  const sparseTwo = [route("one"), route("two")];
  delete sparseTwo[1];
  const sparseLeading = Array(2);
  sparseLeading[1] = route("two");
  const missingHref = { ...route(CALLER_SENTINEL) } as Partial<ItemData>;
  delete missingHref.href;
  const ownBoundary: readonly [string, unknown, string][] = [
    ["null container", null, ERRORS.array],
    ["string container", CALLER_SENTINEL, ERRORS.array],
    ["number container", 404, ERRORS.array],
    ["boolean container", false, ERRORS.array],
    ["array container", [], ERRORS.array],
    ["missing items", { label: CALLER_SENTINEL }, ERRORS.array],
    ["null items", { label: CALLER_SENTINEL, items: null }, ERRORS.array],
    ["object items", { label: CALLER_SENTINEL, items: { 0: route("one"), length: 1 } }, ERRORS.array],
    ["string items", { label: CALLER_SENTINEL, items: CALLER_SENTINEL }, ERRORS.array],
    ["non-array iterable items", { label: CALLER_SENTINEL, items: new Set([route("one")]) }, ERRORS.array],
    ["blank label", { ...routes(1), label: "" }, ERRORS.label],
    ["whitespace label", { ...routes(1), label: "  \t\n" }, ERRORS.label],
    ["missing label", { items: [route(CALLER_SENTINEL)] }, ERRORS.label],
    ["non-string label", { ...routes(1), label: <span>{CALLER_SENTINEL}</span> }, ERRORS.label],
    ["seven destinations", routes(7), ERRORS.cap],
    ["nine destinations", routes(9), ERRORS.cap],
    ["one sparse destination", { label: CALLER_SENTINEL, items: sparseOne }, ERRORS.dense],
    ["trailing sparse destination", { label: CALLER_SENTINEL, items: sparseTwo }, ERRORS.dense],
    ["leading sparse destination", { label: CALLER_SENTINEL, items: sparseLeading }, ERRORS.dense],
    ["null entry", { label: CALLER_SENTINEL, items: [null] }, ERRORS.destination],
    ["undefined entry", { label: CALLER_SENTINEL, items: [undefined] }, ERRORS.destination],
    ["string entry", { label: CALLER_SENTINEL, items: [CALLER_SENTINEL] }, ERRORS.destination],
    ["missing href", { label: CALLER_SENTINEL, items: [missingHref] }, ERRORS.destination],
    ["null href", { label: CALLER_SENTINEL, items: [{ ...route("one"), href: null }] }, ERRORS.destination],
    ["numeric href", { label: CALLER_SENTINEL, items: [{ ...route("one"), href: 404 }] }, ERRORS.destination],
    ["multi-item missing href", { label: CALLER_SENTINEL, items: [route("one"), missingHref] }, ERRORS.destination],
  ];
  it.each(ownBoundary)("refuses %s with the fixed route-boundary message", (_name, input, message) => {
    let thrown: unknown;
    try { statusMarkup(input); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(message);
    expect((thrown as Error).message).not.toContain(CALLER_SENTINEL);
  });
  const canonicalRefusals: readonly [string, unknown][] = [
    ["blank destination", { label: "Next", items: [{ ...route("one"), href: "" }] }],
    ["whitespace destination", { label: "Next", items: [{ ...route("one"), href: " " }] }],
    ["unsafe destination", { label: "Next", items: [{ ...route("one"), href: "javascript:alert(1)" }] }],
    ["duplicate ID", { label: "Next", items: [route("same"), { ...route("same"), href: "/another" }] }],
    ["duplicate destination", { label: "Next", items: [route("one"), { ...route("two"), href: route("one").href }] }],
    ["duplicate page destinations with different fragments", { label: "Next", items: [{ ...route("one"), href: "/same#one" }, { ...route("two"), href: "/same#two" }] }],
  ];
  it.each(canonicalRefusals)("preserves canonical refusal for %s", (_name, input) => {
    expect(() => statusMarkup(input)).toThrow(TypeError);
  });
  it("renders only caller-owned ASCII route wording", () => {
    const input: Routes = { label: "Caller choices 404", items: [route("alpha"), route("beta")] };
    draw(input);
    const region = screen.getByRole("region", { name: input.label });
    // Canonical linked titles include hidden spacing and a decorative chevron.
    const callerContent = region.cloneNode(true) as HTMLElement;
    callerContent.querySelectorAll('[aria-hidden="true"]').forEach(node => node.remove());
    expect(callerContent.textContent).toBe(input.label + input.items.map(item => String(item.heading) + String(item.description)).join(""));
    expect(callerContent.textContent).not.toMatch(/[^\x00-\x7f]/);
  });
  it.each(["heading", "description", "eyebrow", "icon", "meta", "visual", "badge"] as const)("refuses a nested native control in the linked %s slot", slot => {
    const item = { ...route("one"), [slot]: slot === "badge" ? { label: <button>Nested</button> } : <button>Nested</button> };
    expect(() => statusMarkup({ label: "Next", items: [item] })).toThrow(TypeError);
  });
});

// Same neutral full-document fixture and parse approach as GlobalErrorDocument.test.tsx.
const COPY: Readonly<Record<string, string>> = { brand: "Example home", skip: "Skip to content", entity: "Example Ltd", privacy: "Privacy" };
const ref = (id: string): CopyRef => ({ id });
const resolveCopy: CopyResolver = copyRef => COPY[copyRef.id] === undefined ? undefined : { ref: copyRef, text: COPY[copyRef.id]!, recordId: `record-${copyRef.id}`, revision: "1", locale: "en-US", source: { kind: "consumer", reference: "fixture" }, entryId: copyRef.id };
const resolveAsset = (id: string): unknown => id === "mark" ? { type: "image", src: "/brand/mark.svg", width: 48, height: 48, alt: "Example mark" } : undefined;
const shell: SiteShellInput = { brand: { assetId: "mark", label: ref("brand"), size: "md", variant: "mark" }, skipLink: ref("skip"), footer: { legal: { entity: ref("entity"), links: [{ href: "/privacy", label: ref("privacy") }] } } };
const head = { lang: "en", documentTitle: { page: "Something went wrong", brand: "Example Studio" }, icon: { href: "/icon.svg" } };
const framed: GlobalErrorDocumentFramedProps = { ...head, shell, resolveCopy, resolveAsset, status: "500", subtitle: "Something went wrong.", action: <button>Try again</button>, notes: <a href="/contact">Contact us</a> };
function errorDocument(input: unknown): Document {
  const props = { ...framed, routes: input } as GlobalErrorDocumentFramedProps & { routes: Routes };
  return new DOMParser().parseFromString(renderToStaticMarkup(<GlobalErrorDocument {...props} />), "text/html");
}
const DEPRECATED_ROUTES_ERROR = "GlobalErrorDocument: routes require the framed StatusView shape.";

describe("GlobalErrorDocument framed routes", () => {
  it.each([1, 3, 6])("forwards %s routes inside the frame's single main without replacing action or notes", count => {
    const doc = errorDocument(routes(count));
    expect(doc.querySelectorAll("main")).toHaveLength(1);
    const main = doc.querySelector(`main#${SITE_MAIN_ID}`)!;
    const region = main.querySelector('section[aria-labelledby]')!;
    expect(region).not.toBeNull();
    expect(region.querySelector("h2")?.textContent).toBe("Next destinations");
    expect(region.getAttribute("aria-labelledby")).toBe(region.querySelector("h2")?.id);
    expect(region.hasAttribute("aria-label")).toBe(false);
    expect(region.querySelectorAll("[data-item]")).toHaveLength(count);
    expect(main.querySelectorAll("h1")).toHaveLength(1);
    expect(main.querySelector("h1")?.textContent).toBe("500");
    expect(main.querySelector("button")?.textContent).toBe("Try again");
    expect(main.querySelector('a[href="/contact"]')?.textContent).toBe("Contact us");
    expect(doc.querySelectorAll("header")).toHaveLength(1);
    expect(doc.querySelectorAll("footer")).toHaveLength(1);
    expect(doc.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
    expect(main.hasAttribute("routes")).toBe(false);
  });
  it("forwards empty routes as no additional status content", () => {
    const doc = errorDocument(routes(0));
    expect(doc.querySelector("main section:not([data-designer-section-frame]), [routes]")).toBeNull();
    expect(doc.querySelector("main h2")).toBeNull();
  });
  it("propagates a route refusal through the framed shape", () => {
    expect(() => errorDocument({ label: "Next", items: [{ ...route("one"), href: "javascript:alert(1)" }] })).toThrow(TypeError);
  });
  it("forwards malformed routes to the fixed StatusView boundary", () => {
    let thrown: unknown;
    try { errorDocument(null); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("StatusView: routes must provide an item array.");
  });
  it.each([null, routes(0), routes(1)])("refuses routes on the deprecated ErrorView shape with a fixed message", input => {
    const deprecated = { ...head, status: 500, title: "Something went wrong", routes: input } as unknown as GlobalErrorDocumentProps;
    expect(() => renderToStaticMarkup(<GlobalErrorDocument {...deprecated} />)).toThrowError(DEPRECATED_ROUTES_ERROR);
  });
});
