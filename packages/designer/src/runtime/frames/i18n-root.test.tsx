// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, isRTL, useLocale } from "react-aria-components";
import { canonicalLocale, directionFor, type WriterManifest } from "@clossys/writer";
import { ResizeHandle } from "../../components/ResizeHandle.js";
import type { RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { ShellCopyProvider } from "../../components/Banner.copy-context.js";
import { shellCopyFixtureResolver } from "../../frames/__fixtures__/shell-copy.js";
import { appShellRenderer } from "./app-shell.js";
import { authShellRenderer } from "./auth-shell.js";
import { siteShellRuntimeRenderer } from "./site-shell.js";

const manifest: Pick<WriterManifest, "locales"> = { locales: [
  { tag: "en", dir: "ltr", state: "active" },
  { tag: "ar", dir: "rtl", state: "active" },
  { tag: "he", dir: "rtl", state: "active" },
  { tag: "en-XA", dir: "ltr", state: "pseudo" },
  { tag: "ar-XB", dir: "rtl", state: "pseudo" },
] };
const entries = [siteShellRuntimeRenderer, appShellRenderer, authShellRenderer].map(entry => ({ ...entry, render: (input: RuntimeRenderInput<ReactNode>) => <ShellCopyProvider resolver={shellCopyFixtureResolver}>{entry.render(input)}</ShellCopyProvider> }));
function Probe() {
  const { locale, direction } = useLocale();
  return <span data-testid="locale-probe" data-locale={locale} data-direction={direction} />;
}
function input(entry: typeof entries[number], locale?: string): RuntimeRenderInput<ReactNode> & { locale?: string } {
  const content = Object.fromEntries(Object.entries(entry.sample(specimenDataset)).map(([key, value]) => [key, {
    reference: { kind: "region", ref: `content:${key}` }, value: value as RuntimeJson, hash: "sha256:0",
  }]));
  return { path: "frame", fill: { leaf: entry.leaf }, cell: { theme: "light", state: "default", width: 1280 }, profile: {},
    selection: { leaf: entry.leaf, fill: `foundry/${entry.leaf}`, config: null, members: [], content: {} },
    content, slots: { main: [<Probe key="probe" />] }, ...(locale ? { locale } : {}),
  } as unknown as RuntimeRenderInput<ReactNode> & { locale?: string };
}
beforeEach(() => {
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media.includes("min-width"), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("canonical page locale at the shell root", () => {
  for (const entry of entries) for (const row of manifest.locales) {
    it(`${entry.leaf} shares ${row.tag} with Writer, React Aria and its DOM root`, () => {
      const tag = canonicalLocale(row.tag), direction = directionFor(tag, manifest);
      expect(direction).toBe(row.dir);
      expect(isRTL(tag)).toBe(direction === "rtl");
      const { container } = render(<>{entry.render(input(entry, tag))}</>);
      expect(screen.getByTestId("locale-probe")).toHaveAttribute("data-locale", tag);
      expect(screen.getByTestId("locale-probe")).toHaveAttribute("data-direction", direction);
      const root = container.querySelector(`[data-ds-leaf="${entry.leaf}"]`);
      expect(root).toHaveAttribute("lang", tag);
      expect(root).toHaveAttribute("dir", direction);
      expect(container.querySelectorAll("main")).toHaveLength(1);
    });
  }
  it("inherits an existing page provider when no locale override is supplied", () => {
    render(<I18nProvider locale={canonicalLocale("ar-XB")}><>{authShellRenderer.render(input(authShellRenderer))}</></I18nProvider>);
    expect(screen.getByTestId("locale-probe")).toHaveAttribute("data-locale", "ar-XB");
    expect(screen.getByTestId("locale-probe")).toHaveAttribute("data-direction", "rtl");
  });
  it("updates the context and DOM together when the page locale changes", () => {
    const view = render(<>{authShellRenderer.render(input(authShellRenderer, canonicalLocale("en")))}</>);
    view.rerender(<>{authShellRenderer.render(input(authShellRenderer, canonicalLocale("ar")))}</>);
    expect(screen.getByTestId("locale-probe")).toHaveAttribute("data-locale", "ar");
    expect(screen.getByTestId("locale-probe").closest("[data-frame-root]")).toHaveAttribute("dir", "rtl");
  });
});

it("uses locale context for separator keys even when the nearest DOM dir disagrees", () => {
  const onChange = vi.fn();
  render(<div dir="ltr"><I18nProvider locale="ar"><ResizeHandle value={100} min={0} max={200} resetValue={100} step={10} label="Pane width" onChange={onChange} /></I18nProvider></div>);
  fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
  expect(onChange).toHaveBeenCalledWith(90);
});
it("retains an explicit separator direction override", () => {
  const onChange = vi.fn();
  render(<I18nProvider locale="ar"><ResizeHandle dir="ltr" value={100} min={0} max={200} resetValue={100} step={10} label="Pane width" onChange={onChange} /></I18nProvider>);
  fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
  expect(onChange).toHaveBeenCalledWith(110);
});

// The default condition must render synchronously during ordinary SSR, without a new wrapper.
it("renders locale and direction on the existing authentication root during SSR", () => {
  const html = renderToString(<>{authShellRenderer.render(input(authShellRenderer, canonicalLocale("ar-XB")))}</>);
  expect(html).toContain('lang="ar-XB"');
  expect(html).toContain('dir="rtl"');
  expect(html.match(/<main\b/g)).toHaveLength(1);
  expect(html).not.toContain("Suspense");
});
