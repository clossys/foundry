import { describe, expect, it } from "vitest";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import type { ContentMap } from "../../content-map/contract.js";
import { filterRegisteredFrameRoutes, projectSiteShellNavigation, type SiteShellNavigationOptions } from "./registered-navigation.js";

const words = { navigation: "Navigation", company: "Company", legal: "Legal", home: "Home", about: "About", terms: "Terms", contact: "Contact", demo: "Arrange a call", connect: "Connect", profile: "Profile" };
const refs = Object.fromEntries(Object.keys(words).map(id => [id, { id }])) as Record<keyof typeof words, CopyRef>;
const resolveCopy: CopyResolver = ref => ref.id in words ? { ref, text: words[ref.id as keyof typeof words], recordId: "generic-navigation-record", revision: "1", locale: "en", entryId: ref.id, source: { kind: "consumer", reference: "generic-fixture" } } : undefined;
const map: ContentMap = {
  version: 1, publicationId: "generic-site", format: "web.page.responsive",
  entries: [
    { id: "home", title: words.home, kind: "page", order: 0, path: "/", pin: { nav: true }, source: { planItemId: "home" } },
    { id: "company", title: words.company, kind: "group", order: 1, path: "/company", pin: { nav: true }, source: { planItemId: "company" } },
    { id: "about", parentId: "company", title: words.about, kind: "page", order: 0, path: "/about", pin: { nav: true }, source: { planItemId: "about" } },
    { id: "contact", parentId: "company", title: words.contact, kind: "page", order: 1, path: "/contact", pin: { nav: true }, source: { planItemId: "contact" } },
    { id: "legal", title: words.legal, kind: "group", order: 2, path: "/legal", pin: { nav: true }, source: { planItemId: "legal" } },
    { id: "terms", parentId: "legal", title: words.terms, kind: "page", order: 0, path: "/terms", pin: { nav: true }, source: { planItemId: "terms" } },
  ],
  actions: [{ id: "demo", label: words.demo, group: "company", intent: "request-demo" }],
};
const options = (): SiteShellNavigationOptions => ({ activeId: "home", header: { label: refs.navigation, entryIds: ["home"] }, footerGroupIds: ["company", "legal"], entryCopyRefs: refs, actionCopyRefs: refs, resolveCopy, actions: [{ actionId: "demo", targetEntryId: "contact", emphasis: "primary" }] });

describe("MR9 canonical content-map bridge", () => {
  it("uses ordered canonical group children, preserves headings without href, and returns original Writer refs", () => {
    const value = projectSiteShellNavigation(map, options());
    expect(value.columns).toEqual([{ heading: refs.company, links: [{ href: "/about", label: refs.about }, { href: "/contact", label: refs.contact }] }, { heading: refs.legal, links: [{ href: "/terms", label: refs.terms }] }]);
    expect(value.columns[1]).not.toHaveProperty("href");
    expect(value.nav.links[0]).toEqual({ href: "/", label: refs.home, isCurrent: true });
    expect(value.columns[0]!.heading).toBe(refs.company);
  });
  it("binds action label and intent from the map and destination from its selected actual entry", () => {
    const value = projectSiteShellNavigation(map, options());
    expect(value.actions).toEqual([{ href: "/contact", label: refs.demo, emphasis: "primary" }]);
    expect(value.actionBindings).toEqual([{ actionId: "demo", targetEntryId: "contact", intent: "request-demo" }]);
    const changed = structuredClone(map);
    (changed.entries.find(entry => entry.id === "contact") as { path: string }).path = "/reach-us";
    expect(projectSiteShellNavigation(changed, options()).actions[0]!.href).toBe("/reach-us");
  });
  it("keeps an unpinned contact entry available as an action target", () => {
    const unpinned = structuredClone(map);
    delete (unpinned.entries.find(entry => entry.id === "contact") as { pin?: unknown }).pin;
    const value = projectSiteShellNavigation(unpinned, options());
    expect(value.columns[0]!.links.map(link => link.href)).toEqual(["/about"]);
    expect(value.actions).toEqual([{ href: "/contact", label: refs.demo, emphasis: "primary" }]);
    expect(value.actionBindings[0]!.intent).toBe("request-demo");
  });
  it("refuses missing refs, mismatched record text and untraced resolutions", () => {
    expect(() => projectSiteShellNavigation(map, { ...options(), entryCopyRefs: {} })).toThrow(/Writer/);
    expect(() => projectSiteShellNavigation(map, { ...options(), resolveCopy: ref => { const value = resolveCopy(ref); return value ? { ...value, text: "Unrelated" } : undefined; } })).toThrow(/Writer/);
    expect(() => projectSiteShellNavigation(map, { ...options(), resolveCopy: ref => { const value = resolveCopy(ref); return value ? { ...value, recordId: "" } : undefined; } })).toThrow(/Writer/);
  });
  it("refuses group links, unknown/duplicate selections, non-group columns and invalid action targets", () => {
    expect(() => projectSiteShellNavigation(map, { ...options(), header: { label: refs.navigation, entryIds: ["company"] } })).toThrow(/group/);
    expect(() => projectSiteShellNavigation(map, { ...options(), footerGroupIds: ["about"] })).toThrow(/groups/);
    expect(() => projectSiteShellNavigation(map, { ...options(), footerGroupIds: ["company", "company"] })).toThrow(/unique/);
    expect(() => projectSiteShellNavigation(map, { ...options(), actions: [{ actionId: "absent", targetEntryId: "contact" }] })).toThrow(/unambiguous/);
    expect(() => projectSiteShellNavigation(map, { ...options(), actions: [{ actionId: "demo", targetEntryId: "company" }] })).toThrow(/navigable/);
  });
  it("refuses caller-authored action href/label rather than replacing canonical map data", () => {
    const unsafe = { actionId: "demo", targetEntryId: "contact", href: "/invented", label: refs.home };
    expect(() => projectSiteShellNavigation(map, { ...options(), actions: [unsafe] })).toThrow(/identities/);
  });
  it("projects image profile links from the same map group without duplicating its plain column", () => {
    const connected = structuredClone(map);
    (connected.entries as unknown[]).push(
      { id: "connect", title: words.connect, kind: "group", order: 3, path: "/connect", pin: { nav: true }, source: { planItemId: "connect" } },
      { id: "profile", parentId: "connect", title: words.profile, kind: "page", order: 0, path: "/profile", pin: { nav: true }, source: { planItemId: "profile" } },
    );
    const config = { ...options(), social: { groupId: "connect", imageAssetIds: { profile: "consumer-profile" } } };
    const value = projectSiteShellNavigation(connected, config);
    expect(value.columns).toHaveLength(2);
    expect(value.social).toEqual({ label: refs.connect, links: [{ href: "/profile", label: refs.profile, assetId: "consumer-profile" }] });
    (connected.entries.find(entry => entry.id === "profile") as { path: string }).path = "/updated-profile";
    expect(projectSiteShellNavigation(connected, config).social!.links[0]!.href).toBe("/updated-profile");
    expect(() => projectSiteShellNavigation(connected, { ...config, footerGroupIds: ["company", "legal", "connect"] })).toThrow(/plain footer column/);
    expect(() => projectSiteShellNavigation(connected, { ...config, social: { groupId: "connect", imageAssetIds: {} } })).toThrow(/exactly match/);
  });
  it("preserves the existing application registered-route filter API", () => {
    const findings: unknown[] = [];
    expect(filterRegisteredFrameRoutes({ navigation: { tree: [{ href: "/registered" }, { href: "/absent" }] } }, { registeredPaths: ["/registered"], report: value => findings.push(value) })).toMatchObject({ navigation: { tree: [{ href: "/registered" }] } });
    expect(findings).toHaveLength(1);
  });
});
