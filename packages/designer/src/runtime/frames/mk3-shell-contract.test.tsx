// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import type { ReactNode } from "react";
import { SiteFrame } from "../../frames/site-frame/SiteFrame.js";
import { resolveShell } from "../../frames/site-frame/internal/resolveShell.js";
import { siteShellFor } from "../../frames/site-frame/surface.js";
import { siteShellProps, siteShellRuntimeRenderer } from "./site-shell.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";

const icon = [["path", { d: "M4 12h16" }]];
const header: RuntimeJson = {
  brand: { label: "[[brand.wordmark]] [[brand.home]]", wordmark: "[[brand.wordmark]]", mark: { src: "/mark.svg", width: 48, height: 48 } },
  nav: { label: "[[navigation]]", triggerLabel: "[[menu.open]]", closeLabel: "[[menu.close]]", links: ["one", "two", "three"].map(id => ({ label: `[[nav.${id}]]`, href: `/${id}` })) },
  actions: [{ label: "[[capture]]", href: "/capture", emphasis: "secondary" }],
};
const footer: RuntimeJson = {
  brandBand: true,
  columns: [
    { heading: "[[company]]", links: [{ label: "[[document]]", href: "/document" }, { label: "[[sectioned]]", href: "/sectioned" }, { label: "[[capture]]", href: "/capture" }] },
    { heading: "[[legal]]", links: [{ label: "[[privacy]]", href: "/privacy" }, { label: "[[terms]]", href: "/terms" }] },
  ],
  social: { label: "[[connect]]", links: [{ label: "[[profile.one]]", href: "https://example.com/one", icon }, { label: "[[profile.two]]", href: "https://example.com/two", icon }] },
  legal: { entity: "[[entity]]", links: [] },
};
function props(footerValue: RuntimeJson = footer, headerValue: RuntimeJson = header) {
  return siteShellProps({ content: Object.fromEntries(Object.entries({ "skip-link": "[[skip]]", header: headerValue, footer: footerValue }).map(([key, value]) => [key, { reference: { kind: "region", ref: key }, value, hash: "sha256:0" }])), selection: { leaf: "frames.site-shell", fill: "foundry/frames.site-shell", members: [], config: null, content: {} }, slots: { main: [<h1 key="main">[[page.heading]]</h1>] } } as unknown as RuntimeRenderInput<ReactNode>);
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("MK-3 closed chrome transport", () => {
  it("renders native three-link navigation, CTA and brand/company/legal/connect footer with one main", () => {
    render(<SiteFrame {...props()} />);
    const banner = screen.getByRole("banner"), contentinfo = screen.getByRole("contentinfo");
    expect(within(banner).getByRole("navigation", { name: "[[navigation]]" }).querySelectorAll(".site-header-nav-links a")).toHaveLength(3);
    expect(within(banner).getByRole("link", { name: "[[capture]]" })).toHaveAttribute("href", "/capture");
    const grid = contentinfo.querySelector(".site-footer-columns")!;
    expect(grid.children).toHaveLength(4);
    expect(grid.firstElementChild).toHaveAttribute("data-footer-brand");
    expect([...grid.querySelectorAll("h2")].map(node => node.textContent)).toEqual(["[[company]]", "[[legal]]", "[[connect]]"]);
    expect(within(contentinfo).getByRole("link", { name: "[[profile.one]]" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(contentinfo.querySelectorAll('a[href="/"]')).toHaveLength(1);
    expect(contentinfo.querySelector('[data-footer-region="copyright"]')).toHaveTextContent("[[entity]]");
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "[[skip]]" })).toHaveAttribute("href", "#publisher-main-content");
  });

  it("resolves the explicit Writer close label and carries brand-band opt-in through site config", () => {
    const input = props();
    const resolved = resolveShell(input.shell, input.resolveCopy, input.resolveAsset);
    expect(resolved.nav?.closeLabel).toBe("[[menu.close]]");
    expect(resolved.footer?.brandBand).toBe(true);
    const shell = siteShellFor({ brand: input.shell.brand, skipLink: input.shell.skipLink, origin: "https://example.com", legal: input.shell.footer!.legal, site: { footerBrandBand: true } }, "site");
    expect(shell.footer?.brandBand).toBe(true);
  });

  it.each(["true", 1, null, {}, []])("rejects invalid brandBand data %j rather than coercing", value => {
    expect(() => props({ ...(footer as Record<string, RuntimeJson>), brandBand: value })).toThrow(/brandBand/);
  });

  it("requires Writer copy for the labelled social group and rejects arbitrary footer bodies", () => {
    const missingLabel = props({ ...(footer as Record<string, RuntimeJson>), social: { links: [{ label: "[[profile]]", href: "https://example.com", icon }] } });
    expect(() => resolveShell(missingLabel.shell, missingLabel.resolveCopy, missingLabel.resolveAsset)).toThrow(/social.label/);
    expect(() => props({ ...(footer as Record<string, RuntimeJson>), body: "[[unmapped]]" })).toThrow(/body/);
    expect(() => props(footer, { ...(header as Record<string, RuntimeJson>), nav: { label: "[[nav]]", closeLabel: "", links: [] } })).toThrow(/closeLabel/);
  });

  it("keeps server markup stable during hydration", async () => {
    const input = props();
    const html = renderToString(<SiteFrame {...input} />), container = document.createElement("div");
    document.body.append(container); container.innerHTML = html;
    const errors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => { root = hydrateRoot(container, <SiteFrame {...input} />, { onRecoverableError: error => errors.push(error) }); });
    expect(errors).toEqual([]);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelector(".site-footer-columns")?.children).toHaveLength(4);
    await act(async () => root!.unmount()); container.remove();
  });

  it("draws every authored shell sample label from the shared Writer fixture dataset", () => {
    const sample = siteShellRuntimeRenderer.sample(specimenDataset) as Record<string, RuntimeJson>;
    expect(sample["skip-link"]).toBe(specimenDataset.frames.app.skipLabel);
    expect((sample.header as Record<string, RuntimeJson>).nav).toMatchObject({ closeLabel: specimenDataset.frames.sheet.closeLabel });
    expect(sample.footer).toMatchObject({ brandBand: true, legal: { entity: specimenDataset.frames.siteHeader.brand } });
  });
});
