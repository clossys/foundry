// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCopyResolver, type CopyRegistry, type CopyRef } from "@clossys/writer";
import { ArrowRight } from "@clossys/designer/icons";
import { projectNavigation, type ContentMap } from "../../content-map/index.js";
import { SiteFrame, projectSiteShellNavigation, type SiteShellInput } from "./index.js";

// Neutral test records exercise Writer's actual resolver and provenance.
const words = {
  brand: "Example", skip: "Skip to content", navigation: "Primary navigation", open: "Open navigation", close: "Close navigation",
  one: "One", two: "Two", status: "Service status", company: "Company", about: "About", trust: "Trust", contact: "Contact",
  legal: "Legal", terms: "Terms", privacy: "Privacy", connect: "Connect", "profile-one": "Profile one", "profile-two": "Profile two", capture: "Arrange a call",
};
const registry: CopyRegistry = {
  id: "generic-mr9-shell", revision: "1", locale: "en", source: { kind: "consumer", reference: "generic-shell-fixture" },
  entries: Object.entries(words).map(([id, text]) => ({ id: `generic.shell.${id}`, text, context: "Generic shell acceptance fixture", status: "approved" as const })),
};
const resolveCopy = createCopyResolver(registry);
const ref = (id: keyof typeof words): CopyRef => ({ id: registry.entries.find(entry => entry.id === `generic.shell.${id}`)!.id });
const label = (id: keyof typeof words) => resolveCopy(ref(id))!.text;
const entryCopyRefs = Object.fromEntries(Object.keys(words).map(id => [id, ref(id as keyof typeof words)]));
const pin = { nav: true } as const;
const page = (id: keyof typeof words, order: number, path: string, parentId?: string) => ({
  id, order, path, title: label(id), kind: "page" as const, pin, source: { planItemId: `generic.${id}` }, ...(parentId ? { parentId } : {}),
});
const group = (id: "company" | "legal" | "connect", order: number) => ({
  id, order, path: `/${id}`, title: label(id), kind: "group" as const, pin, source: { planItemId: `generic.${id}` },
});

// Literal MR2 contract: external has href and no source. No alternate projector.
function contentMap(): ContentMap {
  return {
    version: 1, publicationId: "generic-marketing-shell", format: "web.page.responsive",
    entries: [
      page("one", 0, "/"), page("two", 1, "/two"),
      { id: "status", order: 2, path: "/status", title: label("status"), kind: "external", href: "https://status.example.com/current", pin },
      group("company", 3), page("about", 0, "/about", "company"), page("trust", 1, "/trust", "company"), page("contact", 2, "/contact", "company"),
      group("legal", 4), page("terms", 0, "/terms", "legal"), page("privacy", 1, "/privacy", "legal"),
      group("connect", 5),
      { id: "profile-one", parentId: "connect", order: 0, path: "/profile-one", title: label("profile-one"), kind: "external", href: "https://profiles.example.com/one", pin },
      { id: "profile-two", parentId: "connect", order: 1, path: "/profile-two", title: label("profile-two"), kind: "external", href: "https://profiles.example.com/two", pin },
    ],
    actions: [{ id: "capture", label: label("capture"), group: "company", intent: "request-demo" }],
  };
}
const assets = {
  "brand.mark": { type: "image", src: "/marks/brand.svg", width: 32, height: 32, alt: label("brand") },
  "profile.one.mark": { kind: "illustration", src: "/marks/profile-one.svg", width: 24, height: 24, decorative: true },
  "profile.two.mark": { kind: "illustration", src: "/marks/profile-two.svg", width: 24, height: 24, decorative: true },
};
function fixture() {
  const map = contentMap();
  const projected = projectSiteShellNavigation(map, {
    activeId: "one", header: { label: ref("navigation"), triggerLabel: ref("open"), closeLabel: ref("close"), entryIds: ["one", "two", "status"] },
    footerGroupIds: ["company", "legal"], social: { groupId: "connect", imageAssetIds: { "profile-one": "profile.one.mark", "profile-two": "profile.two.mark" } },
    actions: [{ actionId: "capture", targetEntryId: "contact", emphasis: "primary", icon: ArrowRight }], entryCopyRefs, actionCopyRefs: { capture: ref("capture") }, resolveCopy,
  });
  const shell: SiteShellInput = {
    brand: { assetId: "brand.mark", label: ref("brand"), size: "sm", variant: "mark" }, skipLink: ref("skip"), nav: projected.nav, actions: projected.actions,
    footer: { brandBand: true, columns: projected.columns, social: projected.social, legal: { entity: ref("brand"), links: [] } },
  };
  return { map, projected, element: <SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={id => assets[id as keyof typeof assets]} locale="en">{null}</SiteFrame> };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("MR9 actual MR2 map to Writer-bound shell", () => {
  it("uses real projected external hrefs and consumer image identities in a four-cell footer", () => {
    const { map, projected, element } = fixture();
    const canonical = projectNavigation(map, "one");
    expect(canonical.tree.find(node => node.id === "status")?.href).toBe("https://status.example.com/current");
    expect(canonical.tree.find(node => node.id === "connect")?.children?.map(node => node.href)).toEqual(projected.social!.links.map(link => link.href));
    expect(projected.columns).toHaveLength(2);
    expect(projected.actions[0]).toEqual({ href: "/contact", label: ref("capture"), emphasis: "primary", icon: ArrowRight });
    expect(resolveCopy(projected.social!.links[0]!.label)).toMatchObject({ recordId: registry.id, revision: registry.revision, entryId: ref("profile-one").id });
    render(element);
    const banner = screen.getByRole("banner"), footer = screen.getByRole("contentinfo");
    const status = within(banner).getByRole("link", { name: label("status") });
    expect(status).toHaveAttribute("href", "https://status.example.com/current"); expect(status).toHaveAttribute("rel", "noopener noreferrer");
    expect(footer.querySelector(".site-footer-columns")?.children).toHaveLength(4);
    expect([...footer.querySelectorAll("h2")].map(node => node.textContent)).toEqual([label("company"), label("legal"), label("connect")]);
    expect(footer.querySelector(`a[href="/legal"]`)).toBeNull();
    for (const [id, href, src] of [["profile-one", "https://profiles.example.com/one", "/marks/profile-one.svg"], ["profile-two", "https://profiles.example.com/two", "/marks/profile-two.svg"]] as const) {
      const profile = within(footer).getByRole("link", { name: label(id) });
      expect(profile).toHaveAttribute("href", href); expect(profile).toHaveAttribute("rel", "noopener noreferrer");
      expect(profile.querySelector("img")).toHaveAttribute("src", src); expect(profile.querySelector("img")).toHaveAttribute("alt", "");
    }
    expect(footer.querySelector('[data-footer-region="copyright"]')).toHaveTextContent(label("brand"));
  });
  it("carries the same projected external header destination through the reduced-motion drawer", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const user = userEvent.setup();
    render(fixture().element);
    const trigger = screen.getByRole("button", { name: label("open") });
    await user.click(trigger);
    const drawer = await screen.findByRole("dialog", { name: label("navigation") });
    const status = within(drawer).getByRole("link", { name: label("status") });
    expect(status).toHaveAttribute("href", "https://status.example.com/current"); expect(status).toHaveAttribute("rel", "noopener noreferrer");
    await user.keyboard("{Escape}"); await waitFor(() => expect(trigger).toHaveFocus());
  });
});
