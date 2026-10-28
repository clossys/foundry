/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { localePathFor } from "../content/hreflang.js";
import { bindContentRoute, selectContentRoute } from "./content-route-binding.js";
import { assertContentRouteRegistration } from "./content-route-registration.js";
import { createContentRouteManifest, emitContentRoutePage, resolveContentRouteRequest } from "./content-route-source.js";
import { contentRouteFixture } from "./__fixtures__/content-route.js";

const loader = { file: "src/content-loader.ts", export: "loadContentRoute" };
function localized(locales: readonly string[] = ["en", "fr", "ar"], route = "/sign-in") {
  const input = contentRouteFixture();
  return { ...input, registry: { ...input.registry,
    workspace: { ...input.registry.workspace, locales: ["en", "fr", "ar"] },
    slots: input.registry.slots.map(slot => ({ ...slot, locales, route })),
  } };
}

describe("localized active-content routing", () => {
  it("keeps the default unprefixed and emits distinct French and Arabic paths", () => {
    const input = localized();
    const before = JSON.stringify(input.registry);
    for (const [locale, path, outputPath] of [
      ["en", "/sign-in", "site/app/sign-in/page.tsx"],
      ["fr", "/fr/sign-in", "site/app/fr/sign-in/page.tsx"],
      ["ar", "/ar/sign-in", "site/app/ar/sign-in/page.tsx"],
    ]) {
      const route = createContentRouteManifest({ registry: input.registry, locale: locale!, loader }).routes[0]!;
      expect(route).toMatchObject({ locale, path, outputPath, source: { file: outputPath } });
      expect(() => assertContentRouteRegistration(route)).not.toThrow();
      expect(selectContentRoute(input.registry, input.slotId, locale!).outputPath).toBe(outputPath);
      expect(bindContentRoute({ ...input, locale: locale! }, route).locale).toBe(locale);
      expect(emitContentRoutePage(route)).toContain(JSON.stringify(path));
      expect(emitContentRoutePage(route)).toContain("requireContentRoutePublishing(bindContentRoute(input, route))");
      const result = resolveContentRouteRequest({ registry: input.registry, pathname: path!, deployTarget: "site" });
      expect(result).toMatchObject({ kind: "content", status: 200, path, selection: { locale, outputPath } });
    }
    expect(JSON.stringify(input.registry)).toBe(before);
  });

  it("localizes the root without an extra slash and honors a non-English default", () => {
    const input = localized(undefined, "/");
    const registry = { ...input.registry, workspace: { ...input.registry.workspace, defaultLocale: "fr" } };
    for (const [locale, path] of [["fr", "/"], ["en", "/en"], ["ar", "/ar"]]) {
      const route = createContentRouteManifest({ registry, locale: locale!, loader }).routes[0]!;
      expect(route.path).toBe(path);
      expect(route.path).toBe(localePathFor("/", locale!, "fr"));
      expect(bindContentRoute({ ...input, registry, locale: locale! }, route)).toBeTruthy();
    }
  });

  it("redirects case, trailing slash and explicit default prefixes to the same canonical path", () => {
    const input = localized();
    for (const [pathname, location] of [["/SIGN-IN/", "/sign-in"], ["/FR/Sign-In/", "/fr/sign-in"], ["/AR/", "/ar"], ["/EN/SIGN-IN/", "/sign-in"]]) {
      const registry = pathname === "/AR/" ? localized(undefined, "/").registry : input.registry;
      expect(resolveContentRouteRequest({ registry, pathname: pathname!, deployTarget: "site" })).toEqual({
        kind: "redirect", status: 308, location, reason: "canonical-path",
      });
    }
    const authored = localized(undefined, "/Sign-In");
    expect(resolveContentRouteRequest({ registry: authored.registry, pathname: "/fr/sign-in", deployTarget: "site" })).toMatchObject({ location: "/fr/Sign-In" });
  });

  it("returns 404 for missing locales and unknown paths unless default redirect is explicitly selected", () => {
    const { registry } = localized(["en"]);
    for (const pathname of ["/fr/sign-in", "/ar/sign-in"]) {
      expect(resolveContentRouteRequest({ registry, pathname, deployTarget: "site" })).toMatchObject({ kind: "not-found", status: 404 });
      expect(resolveContentRouteRequest({ registry, pathname, deployTarget: "site", missingLocale: "redirect-default" })).toEqual({
        kind: "redirect", status: 307, location: "/sign-in", reason: "locale-fallback",
      });
    }
    for (const pathname of ["/missing", "/fr/missing", "/de/sign-in", "/fr//sign-in", "/fr/%2e%2e/sign-in", "/fr/%zz", "/sign-in?next=/", "//example.test/sign-in"]) {
      expect(resolveContentRouteRequest({ registry, pathname, deployTarget: "site", missingLocale: "redirect-default" })).toMatchObject({ kind: "not-found", status: 404 });
    }
  });

  it("refuses cross-locale binding and inactive or unsnapshotted request targets", () => {
    const input = localized();
    const route = createContentRouteManifest({ registry: input.registry, locale: "fr", loader }).routes[0]!;
    expect(() => bindContentRoute({ ...input, locale: "ar" }, route)).toThrow();
    expect(() => bindContentRoute({ ...input, locale: "fr" }, { ...route, path: "/sign-in", outputPath: "site/app/sign-in/page.tsx", source: { file: "site/app/sign-in/page.tsx", export: "default" } })).toThrow();
    const registry = { ...input.registry, candidates: input.registry.candidates.map(candidate => ({ ...candidate, name: "Changed without revision" })) };
    expect(() => resolveContentRouteRequest({ registry, pathname: "/fr/sign-in", deployTarget: "site" })).toThrow();
    expect(() => resolveContentRouteRequest({ registry: input.registry, pathname: "/sign-in", deployTarget: "unknown" })).toThrow();
  });
});
