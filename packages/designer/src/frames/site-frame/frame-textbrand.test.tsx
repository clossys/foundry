// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { siteShellProps } from "../../runtime/frames/site-shell.js";
import { Brandmark, type BrandmarkProps } from "../../shell/Brandmark.js";
import { SiteFrame } from "./SiteFrame.js";
import { resolveShell } from "./internal/resolveShell.js";
import type { CopyResolver } from "./copy-contract.js";
import type { SiteBrandInput, SiteShellInput } from "./types.js";

const ref = (id: string) => ({ id });
const words: Readonly<Record<string, string>> = { name: "Example", skip: "Skip to content", nav: "Primary", menu: "Menu", help: "Help" };
const resolveCopy: CopyResolver = reference => words[reference.id] === undefined ? undefined : ({ ref: reference, text: words[reference.id]!, recordId: reference.id, revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: reference.id });
const textBrand = { variant: "text", label: ref("name"), href: "/home", size: "md" } as const satisfies SiteBrandInput;
const shell: SiteShellInput = { brand: textBrand, skipLink: ref("skip"), nav: { label: ref("nav"), triggerLabel: ref("menu"), links: [{ label: ref("help"), href: "/help" }] }, footer: { legal: { entity: ref("name"), links: [] } } };
const noAsset = () => undefined;
function runtimeProps(brand: RuntimeJson) {
  const values: Record<string, RuntimeJson> = { "skip-link": words.skip!, header: { brand }, footer: { legal: { entity: words.name!, links: [] } } };
  return siteShellProps({ content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { reference: { kind: "region", ref: key }, value, hash: "sha256:0" }])), selection: { leaf: "frames.site-shell", fill: "foundry/frames.site-shell", members: [], config: null, content: {} }, slots: { main: [] } } as unknown as RuntimeRenderInput<ReactNode>);
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("SiteFrame explicit text brand", () => {
  it.each([false, true])("SSR emits the approved text/link without image, fetch or asset resolution (brandBand=%s)", brandBand => {
    const resolveAsset = vi.fn(noAsset), fetch = vi.spyOn(globalThis, "fetch");
    const html = renderToString(<SiteFrame shell={{ ...shell, footer: { ...shell.footer!, brandBand } }} resolveCopy={resolveCopy} resolveAsset={resolveAsset}><h1>Page</h1></SiteFrame>);
    const host = document.createElement("div"); host.innerHTML = html;
    for (const region of ["banner", "contentinfo"] as const) {
      const link = within(within(host).getByRole(region)).getByRole("link", { name: words.name });
      expect(link).toHaveAttribute("href", textBrand.href);
      expect(link).toHaveTextContent(words.name!);
    }
    expect(host.querySelector("img, [data-brand-mark], [data-footer-home-plate], link[rel=preload] ")).toBeNull();
    expect(html).not.toMatch(/(?:mask-image|background-image):/);
    expect(resolveAsset).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it("a11y preserves the visible name, navigation, skip target and single main", () => {
    const { container } = render(<SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={noAsset}><h1>Page</h1></SiteFrame>);
    const root = within(container), header = root.getByRole("banner"), home = within(header).getByRole("link", { name: words.name });
    expect(home).toHaveAccessibleName(home.textContent!);
    // Header collapse hides image-lockup spans; text stays a direct anchor child.
    expect(home.childNodes).toHaveLength(1); expect(home.firstChild!.nodeType).toBe(Node.TEXT_NODE);
    expect(within(header).getByRole("navigation", { name: words.nav })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: words.menu })).toHaveAttribute("aria-expanded", "false");
    const main = root.getByRole("main");
    expect(root.getAllByRole("main")).toHaveLength(1); expect(main).toHaveAttribute("tabindex", "-1");
    expect(root.getByRole("link", { name: words.skip })).toHaveAttribute("href", `#${main.id}`);
  });

  it("uses existing origin resolution and refuses unresolved Writer copy", () => {
    expect(resolveShell({ ...shell, origin: "https://example.com" }, resolveCopy, noAsset).brand).toMatchObject({ href: "https://example.com/home", label: words.name });
    expect(() => resolveShell({ ...shell, brand: { ...textBrand, label: ref("missing") } }, resolveCopy, noAsset)).toThrow("shell.brand.label");
  });

  it.each(["", "  "])("a11y refuses a mutated empty visible and accessible name (%j)", label => {
    expect(() => renderToString(<Brandmark variant="text" label={label} size="md" href="/home" />)).toThrow("label");
    expect(() => resolveShell(shell, reference => ({ ...resolveCopy(reference)!, text: label }), noAsset)).toThrow("shell.brand.label");
  });

  it.each(["javascript:alert(1)", "//example.com", " /home", "/\\host", "", undefined])("refuses a mutated text destination (%s)", href => {
    expect(() => resolveShell({ ...shell, brand: { ...textBrand, href } } as SiteShellInput, resolveCopy, noAsset)).toThrow("shell.brand.href");
    const forced = { variant: "text", label: words.name!, size: "md", href } as Extract<BrandmarkProps, { variant: "text" }>;
    expect(() => renderToString(<Brandmark {...forced} />)).toThrow("href");
  });

  it.each(["assetId", "markInk", "plate", "wordmark"])("refuses mixed text/image field %s before asset resolution", field => {
    const resolveAsset = vi.fn(noAsset);
    expect(() => resolveShell({ ...shell, brand: { ...textBrand, [field]: "unused" } } as SiteShellInput, resolveCopy, resolveAsset)).toThrow("shell.brand");
    expect(resolveAsset).not.toHaveBeenCalled();
  });

  it("runtime transports explicit text without manufacturing an image identity", () => {
    const props = runtimeProps({ variant: "text", label: words.name!, href: "/home" });
    expect(props.shell.brand).toMatchObject({ variant: "text", href: "/home" });
    expect(props.shell.brand).not.toHaveProperty("assetId");
    expect(props.resolveAsset("runtime-content.brand-mark")).toBeUndefined();
    const resolveAsset = vi.fn(props.resolveAsset);
    const html = renderToString(<SiteFrame {...props} resolveAsset={resolveAsset} />);
    expect(html).toContain('href="/home"'); expect(html).toContain(`>${words.name}</a>`);
    expect(html).not.toMatch(/<img|mask-image/); expect(resolveAsset).not.toHaveBeenCalled();
    expect(() => runtimeProps({ variant: "text", label: words.name!, href: "/home", mark: {} })).toThrow("header.brand");
  });

  it.each(["mark", "lockup"] as const)("preserves the existing %s asset requirement and rendering path", variant => {
    const brand: SiteBrandInput = variant === "mark" ? { variant, assetId: "mark", label: ref("name"), size: "md", markInk: "image" }
      : { variant, assetId: "mark", label: ref("name"), wordmark: ref("name"), size: "md", markInk: "image" };
    const resolveAsset = vi.fn(() => ({ type: "image", src: "/mark.svg", width: 48, height: 48, alt: words.name! }));
    const html = renderToString(<SiteFrame shell={{ ...shell, brand }} resolveCopy={resolveCopy} resolveAsset={resolveAsset} />);
    expect(resolveAsset).toHaveBeenCalledWith("mark"); expect(html).toContain('src="/mark.svg"');
    expect(() => resolveShell({ ...shell, brand }, resolveCopy, noAsset)).toThrow("shell.brand.assetId");
    expect(() => resolveShell({ ...shell, brand: { ...brand, assetId: undefined } } as SiteShellInput, resolveCopy, resolveAsset)).toThrow("shell.brand.assetId");
  });

  it("preserves runtime image defaults", () => {
    for (const wordmark of [undefined, words.name]) {
      const props = runtimeProps({ label: words.name!, mark: { src: "/mark.svg", width: 48, height: 48 }, ...(wordmark === undefined ? {} : { wordmark }) });
      expect(props.shell.brand.variant).toBe(wordmark === undefined ? "mark" : "lockup");
      expect(resolveShell(props.shell, props.resolveCopy, props.resolveAsset).brand).toMatchObject({ markSrc: "/mark.svg", label: words.name });
    }
    expect(() => runtimeProps({ label: words.name! })).toThrow("header.brand.mark");
  });
});
