/** @vitest-environment node */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import * as contentRoutes from "./content-route.js";
import { bindContentAppFrame } from "./content-route-copy.js";
import { resolveContentRouteRequest } from "./content-route-request.js";
import { emitCompleteRoutePage, emitRegisteredRouteAdapter } from "./registered-route-source.js";
import { syntheticRoute } from "../core/__fixtures__/registered-route.js";
import { contentRouteContent, contentRouteFixture } from "./__fixtures__/content-route.js";
import type { CopyResolver } from "@clossys/writer";

const paths = ["/agents/designer", "/agents/writer", "/agents/publisher"] as const;
const registrations = paths.map(path => {
  const route = syntheticRoute(`example.${path.split("/").at(-1)}`);
  return { ...route, path, entry: { ...route.entry, file: `app${path}/page.tsx` },
    composition: { ...route.composition, binding: { ...route.composition.binding, path } } };
});
function inputFor(path: string) {
  const input = contentRouteFixture();
  return { ...input, registry: { ...input.registry, slots: input.registry.slots.map(slot => ({ ...slot, aliases: [], l2: "admin", route: path, meta: { robots: "index" as const } })) } };
}
function metadataFrom(source: string) {
  expect(source).toContain("export { metadata };");
  return JSON.parse(/const metadata = (.+);/.exec(source)?.[1] ?? "null");
}
const ref = (id: string) => ({ id: `sample.${id}` });
const resolver: CopyResolver = ref => ({ ref, text: `[[${ref.id}]]`, recordId: "synthetic", revision: "1", locale: ref.locale ?? "en", servedLocale: ref.locale ?? "en", chain: [ref.locale ?? "en"], entryId: ref.id, source: { kind: "consumer", reference: "fixture" } });
const shell = () => ({
  brand: { markSrc: "/mark.svg", navigationMark: { label: ref("brand") } },
  navigation: { label: ref("navigation"), openLabel: ref("open"), closeLabel: ref("close"), emptyMessage: ref("empty"), tree: [
    { id: "publisher", href: "/agents/publisher?view=all", label: ref("publisher") },
    { id: "group", label: ref("group"), children: [{ id: "missing", href: "/agents/instances", label: ref("missing") }] },
  ] },
  account: { signedOutLabel: ref("account"), sections: [] },
  commands: { triggerLabel: ref("trigger"), heading: ref("commands"), searchLabel: ref("search"), closeLabel: ref("close"), emptyMessage: ref("empty"), groups: [
    { id: "routes", label: ref("routes"), items: [
      { id: "publisher", label: ref("publisher"), href: "/agents/publisher" },
      { id: "missing", label: ref("missing"), href: "/agents/instances" },
      { id: "action", label: ref("action"), onAction: vi.fn() },
    ] },
  ] }, themeControl: null,
});

describe("admin route head and registered navigation conformance", () => {
  it.each(paths)("%s renders noindex,nofollow and a Twitter card despite an index override", path => {
    const html = renderToStaticMarkup(<contentRoutes.ContentRoutePage input={inputFor(path)} />);
    const doc = new JSDOM(html).window.document;
    expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
    expect(doc.querySelector('meta[name="twitter:card"]')?.getAttribute("content")).toBe("summary");
  });

  it("public routes also render and emit a Twitter card", () => {
    const html = renderToStaticMarkup(<contentRoutes.ContentRoutePage input={contentRouteFixture()} />);
    expect(new JSDOM(html).window.document.querySelector('meta[name="twitter:card"]')?.getAttribute("content")).toBe("summary");
    expect(metadataFrom(emitRegisteredRouteAdapter(syntheticRoute()))).toEqual({ twitter: { card: "summary" } });
  });

  it.each(paths)("%s publishes the policy in the native document head", path => {
    const base = inputFor(path);
    const input = { ...base,
      registry: { ...base.registry, workspace: { ...base.registry.workspace, deployTargets: [{ id: "site", repo: "example", app: "site", origin: "https://example.test" }] },
        slots: base.registry.slots.map(slot => ({ ...slot, meta: { robots: "index" as const } })) },
      publishing: { brand: "Example", manifest: { defaultLocale: "en", locales: [{ tag: "en", state: "active" as const, dir: "ltr" as const }], fallback: {} },
        bodyServedLocales: { en: ["en"] }, existingUrls: [`https://example.test${path}`] },
    };
    const doc = new JSDOM(renderToStaticMarkup(<contentRoutes.ContentRoutePage input={input} />)).window.document;
    expect(doc.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
    expect(doc.head.querySelector('meta[name="twitter:card"]')?.getAttribute("content")).toBe("summary");
  });

  it.each(registrations)("$path emits the same policy on plain and loader-backed server entries", route => {
    for (const registration of [route, { ...route, composition: { ...route.composition, loader: { file: "server/load.ts", export: "loadRoute" } } }]) {
      expect(metadataFrom(emitRegisteredRouteAdapter(registration))).toMatchObject({ robots: "noindex, nofollow", twitter: { card: "summary" } });
    }
  });

  it.each(["designer", "publisher"] as const)("the complete %s entry carries native metadata", kind => {
    expect(metadataFrom(emitCompleteRoutePage({ kind, file: `app/agents/${kind}/page.tsx`, loader: { file: "server/load.ts", export: "loadRoute" } })))
      .toMatchObject({ robots: "noindex, nofollow", twitter: { card: "summary" } });
  });

  it.each(paths)("%s returns the response header on both content and canonical redirects", path => {
    const { registry } = inputFor(path);
    for (const pathname of [path, `${path.toUpperCase()}/`]) {
      expect(resolveContentRouteRequest({ registry, pathname, deployTarget: "site" })).toMatchObject({ headers: { "X-Robots-Tag": "noindex, nofollow" } });
    }
    expect(resolveContentRouteRequest({ registry, pathname: "/agents/instances", deployTarget: "site" })).toMatchObject({ kind: "not-found", status: 404 });
  });

  it("exports an admin robots policy for the host without changing public route headers", () => {
    expect(contentRoutes.adminRobotsPolicy()).toEqual({ rules: [{ userAgent: "*", disallow: ["/agents/"] }] });
    const { registry } = contentRouteFixture();
    expect(resolveContentRouteRequest({ registry, pathname: "/sign-in", deployTarget: "site" })).not.toHaveProperty("headers");
  });

  it("filters and reports injected unregistered frame and palette entries, preserving actions and input ownership", () => {
    const frame = shell(), report = vi.fn();
    const action = frame.commands.groups[0]!.items[2]!.onAction;
    const bound = bindContentAppFrame(frame, "en", resolver, { registeredPaths: paths, report });
    expect(bound.navigation.tree.map(node => node.id)).toEqual(["publisher"]);
    expect(bound.commands.groups[0]!.items.map(item => item.id)).toEqual(["publisher", "action"]);
    expect(bound.commands.groups[0]!.items[1]!.onAction).toBe(action);
    expect(report.mock.calls.map(([finding]) => finding.href)).toEqual(["/agents/instances", "/agents/instances"]);
    expect(frame.navigation.tree).toHaveLength(2);
    expect(frame.commands.groups[0]!.items).toHaveLength(3);
  });

  it("the serving AppFrame boundary drops invalid destinations and exposes nonblocking diagnostics", () => {
    const content = contentRouteContent();
    const base = contentRouteFixture({ composition: { ...content.composition!, frame: { frameId: "frames.app-shell", configId: "default" } } });
    const input = { ...base, appFrame: shell(), resolveCopy: resolver,
      registry: { ...base.registry, slots: base.registry.slots.map(slot => ({ ...slot, aliases: [], l2: "admin", route: "/agents/publisher" })) },
      libraries: base.libraries.map(library => ({ ...library, frames: [{ id: "frames.app-shell", configIds: ["default"] }] })),
    };
    const prepared = contentRoutes.prepareContentRoute(input);
    expect(prepared.status).toBe("ready");
    expect(prepared.copyFindings?.filter(finding => finding.rule === "unregistered-navigation-route")).toHaveLength(2);
    const html = renderToStaticMarkup(<contentRoutes.ContentRoutePage input={input} />);
    expect(html).not.toContain("/agents/instances");
    expect(html).toContain("/agents/publisher?view=all");
  });

  it("every registered console route has an emitted page on disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "publisher-console-pages-"));
    try {
      for (const path of paths) {
        const route = registrations.find(route => route.path === path)!;
        const file = join(root, route.entry.file);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, emitRegisteredRouteAdapter(route));
      }
      for (const route of registrations) {
        expect(await readFile(join(root, route.entry.file), "utf8")).toBe(emitRegisteredRouteAdapter(route));
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
