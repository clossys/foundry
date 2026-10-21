// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import type { CopyResolver } from "@clossys/writer";
import { SITE_MAIN_ID, SiteFrame, siteShellFor } from "../frame/index.js";
import type { SiteFrameConfig } from "../frame/index.js";
import { CardlessPageLayout, PageLayout } from "../internal/PageLayout.js";
import * as web from "../index.js";
import * as client from "../client.js";
import * as server from "../server.js";
import * as serverViews from "./server.js";
import { PageView } from "./PageView.js";

afterEach(cleanup);

const ref = (id: string) => ({ id });
const resolveCopy: CopyResolver = ref => ({ ref, text: ref.id, recordId: "page-view-fixture", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: ref.id });
const shell: SiteFrameConfig = {
  brand: { assetId: "mark", label: ref("Example brand"), size: "md", variant: "mark" },
  skipLink: ref("Skip to content"), origin: "https://example.com",
  legal: { entity: ref("Example entity"), links: [{ href: "/privacy", label: ref("Privacy") }], linksLabel: ref("Legal links") },
};

describe("PageView", () => {
  it("preserves the exact pre-change PageLayout and cardless default HTML used by existing views", () => {
    const props = { title: "Example title", subtitle: "Example subtitle", notes: "Example notes" };
    expect(renderToStaticMarkup(<PageLayout {...props}><p>Example body</p></PageLayout>)).toBe('<div class="flex flex-col items-center gap-xs text-center"><h1 class="text-h1 font-display text-ink-primary">Example title</h1><p class="text-body text-ink-secondary">Example subtitle</p></div><div class="rounded-control bg-surface-raised p-lg flex flex-col gap-lg text-start" style="box-shadow:var(--ui-elevation-raised, 0 1px 0 var(--color-line-base, oklch(0.8761 0 0)))"><p>Example body</p></div><div class="flex flex-col items-center gap-xs text-center text-body-s text-ink-secondary">Example notes</div>');
    expect(renderToStaticMarkup(<CardlessPageLayout {...props} action={<a href="/example">Example action</a>} />)).toBe('<div class="flex flex-col items-center gap-xs text-center"><h1 class="text-h1 font-display text-ink-primary">Example title</h1><p class="text-body text-ink-secondary">Example subtitle</p></div><div class="flex flex-col items-center gap-sm"><a href="/example">Example action</a></div><div class="flex flex-col items-center gap-xs text-center text-body-s text-ink-secondary">Example notes</div>');
  });

  it("renders title, optional subtitle and notes as escaped start-aligned text around the content card", () => {
    const { container } = render(<PageView title="<b>Details</b>" subtitle="<i>Supporting text</i>" notes="<em>Notes</em>"><p>Page content</p></PageView>);
    const heading = screen.getByRole("heading", { level: 1, name: "<b>Details</b>" });
    const subtitle = screen.getByText("<i>Supporting text</i>");
    const notes = screen.getByText("<em>Notes</em>");
    const body = screen.getByText("Page content");
    const card = container.querySelector('[data-variant="plate"]')!;
    expect(card).not.toBeNull();
    expect(heading.parentElement).toHaveClass("items-start", "text-start");
    expect(notes).toHaveClass("items-start", "text-start");
    expect(heading.compareDocumentPosition(subtitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(subtitle.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card).toContainElement(body);
    expect(card).not.toContainElement(notes);
    expect(container.querySelector("b, i, em")).toBeNull();
  });

  it.each(["light", "dark"])("uses a flat bordered token plate without elevation in %s", theme => {
    const { container } = render(<div data-theme={theme}><PageView title="Details"><p>Page content</p></PageView></div>);
    const card = container.querySelector<HTMLElement>('[data-variant="plate"]')!;
    expect(card).not.toBeNull();
    expect(card).toHaveClass("border", "border-line-panel", "bg-surface-sunken");
    expect(card.style.boxShadow).toBe("");
    expect(card.className).not.toMatch(/shadow/);
    expect(container.querySelectorAll("time")).toHaveLength(0);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("hosts a named form unchanged and leaves submission with its caller", () => {
    const onSubmit = vi.fn(event => event.preventDefault());
    const { container } = render(<PageView title="Profile" form={<form aria-label="Profile details" onSubmit={onSubmit}><button type="submit">Save profile</button></form>} />);
    const form = screen.getByRole("form", { name: "Profile details" });
    expect(container.querySelector('[data-variant="plate"]')).toContainElement(form);
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("refuses simultaneous content and form at runtime as well as in the type contract", () => {
    expect(() => renderToStaticMarkup(createElement(PageView, { title: "Ambiguous", form: <form aria-label="Details" />, children: <p>Also content</p> } as never))).toThrow(/content.*form|children.*form/i);
  });

  it("renders the DocumentView-shaped effective and updated dates without composing their labels", () => {
    const { container } = render(<PageView title="Policy" effectiveDate={{ dateTime: "2026-10-01", text: ref("Effective October 1") }} updated={{ dateTime: "2026-10-20", text: ref("Updated October 20") }} resolveCopyId={resolveCopy}><p>Policy content</p></PageView>);
    const dates = [...container.querySelectorAll("time")];
    expect(dates.map(date => [date.dateTime, date.textContent])).toEqual([["2026-10-01", "Effective October 1"], ["2026-10-20", "Updated October 20"]]);
    expect(container.querySelector('[data-variant="plate"]')).toContainElement(dates[0]!);
    for (const dateTime of ["", "not-a-date", "2026-02-30"]) {
      expect(() => renderToStaticMarkup(<PageView title="Policy" effectiveDate={{ dateTime, text: ref("Effective date") }} resolveCopyId={resolveCopy}><p>Policy</p></PageView>)).toThrow(/real ISO date/);
    }
    expect(() => renderToStaticMarkup(<PageView title="Policy" updated={{ dateTime: "2026-10-20", text: ref("Missing copy") }} resolveCopyId={() => undefined}><p>Policy</p></PageView>)).toThrow(/updated.text/);
  });

  it("keeps frame landmarks and the skip target with the real SiteFrame, with one page h1", () => {
    const standalone = renderToStaticMarkup(<PageView title="Details"><p>Page content</p></PageView>);
    expect(standalone).not.toMatch(/<main|<header|<footer|role="(?:main|banner|contentinfo)"/);
    const { container } = render(<SiteFrame shell={siteShellFor(shell, "front-door")} resolveCopy={resolveCopy} resolveAsset={() => ({ type: "image", src: "/mark.svg", width: 48, height: 48, alt: "Example mark" })}><PageView title="Details"><p>Page content</p></PageView></SiteFrame>);
    const main = screen.getByRole("main");
    expect(main.id).toBe(SITE_MAIN_ID);
    expect(container.querySelectorAll(`[id="${SITE_MAIN_ID}"]`)).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", `#${SITE_MAIN_ID}`);
    expect(within(main).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const props of [{ role: "main" }, { id: SITE_MAIN_ID }]) {
      expect(() => renderToStaticMarkup(<PageView title="Details" {...props}><p>Content</p></PageView>)).toThrow(/frame|landmark/);
    }
  });

  it("adds the same server-safe view to ordinary, client and real react-server entries", () => {
    expect(web.PageView).toBe(PageView);
    expect(client.PageView).toBe(PageView);
    expect(typeof server.PageView).toBe("function");
    expect(renderToStaticMarkup(<server.PageView title="Details"><p>Content</p></server.PageView>)).toBe(renderToStaticMarkup(<PageView title="Details"><p>Content</p></PageView>));
    expect(serverViews.PageView).toBe(PageView);
    const script = `
      import { createElement } from "react";
      import { PageView } from "@clossys/publisher/web";
      import { PageView as subpath } from "#publisher-web-views";
      if (PageView !== subpath) throw new Error("View export mismatch");
      const tags = [];
      function walk(node) {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(walk);
        if (typeof node.type === "function") return walk(node.type(node.props));
        if (typeof node.type === "string") tags.push(node.type);
        walk(node.props?.children);
      }
      walk(createElement(PageView, {title: "Details"}, createElement("p", null, "Content")));
      console.log(JSON.stringify(tags));
    `;
    const tags = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], { encoding: "utf8" }));
    expect(tags.filter((tag: string) => tag === "h1")).toHaveLength(1);
    expect(tags).toContain("p");
    expect(tags).not.toContain("main");
  });

  it("typechecks valid content and form callers while refusing both slots and public modes", () => {
    const file = resolve(import.meta.dirname, "PageView.contract-probe.tsx");
    const source = `
      import { PageView } from "./PageView.js";
      const content = <PageView title="Details"><p>Content</p></PageView>;
      const form = <PageView title="Sign in" form={<form aria-label="Sign in" />} />;
      // @ts-expect-error Content and form cannot both be supplied.
      const ambiguous = <PageView title="Details" form={<form />}><p>Content</p></PageView>;
      // @ts-expect-error A public mode is not part of the unified view.
      const mode = <PageView title="Details" mode="legal"><p>Content</p></PageView>;
      // @ts-expect-error The visible title is plain text.
      const title = <PageView title={<strong>Details</strong>}><p>Content</p></PageView>;
      // @ts-expect-error Metadata copy needs its caller's resolver.
      const meta = <PageView title="Policy" effectiveDate={{dateTime:"2026-10-01",text:{id:"date"}}}><p>Content</p></PageView>;
    `;
    const options: ts.CompilerOptions = { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, allowSyntheticDefaultImports: true, types: ["node"] };
    const host = ts.createCompilerHost(options);
    const read = host.readFile.bind(host), exists = host.fileExists.bind(host), original = host.getSourceFile.bind(host);
    host.readFile = path => resolve(path) === file ? source : read(path);
    host.fileExists = path => resolve(path) === file || exists(path);
    host.getSourceFile = (path, language, onError, shouldCreate) => resolve(path) === file ? ts.createSourceFile(path, source, language, true, ts.ScriptKind.TSX) : original(path, language, onError, shouldCreate);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
    expect(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  });
});
