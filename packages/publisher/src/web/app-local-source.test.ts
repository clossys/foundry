import { expect, it } from "vitest";
import { emitRegisteredRoutePage, emitRegisteredRouteRegistryModule, emitRegisteredRouteAdapter } from "./registered-route-source.js";
import { syntheticRoute } from "../core/__fixtures__/registered-route.js";
import { createContentRouteManifest, emitContentRoutePage } from "./content-route-source.js";
import { contentRouteFixture } from "./__fixtures__/content-route.js";

const options = { appLocal: {
  "@clossys/publisher/core": "./runtime/core",
  "@clossys/publisher/web/registered-route": "./runtime/registered-route",
  "@clossys/publisher/web/content-route": "./runtime/content-route",
} };
it("preserves the default registered route golden and relocates only explicit app-local imports", () => {
  const route = syntheticRoute(), registry = { version: 1 as const, consumer: "example", routes: [route] };
  expect(emitRegisteredRoutePage("routes.ts", route)).toBe([
    '"use client";', 'import registry from "../routes.ts";', 'import { RegisteredRoutePage } from "@clossys/publisher/web/registered-route";', 'import { useRuntime as useRuntime } from "../runtime.ts";',
    "export default function RegisteredPage() {", '  return <RegisteredRoutePage registry={registry} routeId="example.tools" useRuntime={useRuntime} />;', "}", "",
  ].join("\n"));
  expect(emitRegisteredRouteRegistryModule(registry)).toBe(`import type { RegisteredRoutePageProps } from "@clossys/publisher/web/registered-route";\nconst registry: RegisteredRoutePageProps["registry"] = ${JSON.stringify(registry, null, 2)};\nexport default registry;\n`);
  expect(emitRegisteredRouteAdapter(route)).toBe('const metadata = {"twitter":{"card":"summary"}};\nexport { metadata };\nexport { default } from "../../../generated/example.tools.tsx";\n');
  expect(emitRegisteredRoutePage("routes.ts", route, options)).not.toContain("@clossys/");
  expect(emitRegisteredRouteRegistryModule(registry, options)).not.toContain("@clossys/");
  const loaded = { ...route, composition: { ...route.composition, loader: { file: "server/tools.ts", export: "loadTools" } } };
  expect(emitRegisteredRouteAdapter(loaded, options)).toContain('from "./runtime/core"');
});
it("preserves the content-route golden and requires an explicit relative app-local mapping", () => {
  const input = contentRouteFixture(), loader = { file: "src/content-loader.ts", export: "loadContentRoute" };
  const route = createContentRouteManifest({ registry: input.registry, locale: input.locale, loader }).routes[0]!;
  const expected = [
    'import { ContentRoutePage, bindContentRoute, requireContentRoutePublishing } from "@clossys/publisher/web/content-route";',
    'import type { ContentRouteInput, ContentRouteRegistration } from "@clossys/publisher/web/content-route";',
    'import { loadContentRoute as loadContentRoute } from "../../../src/content-loader.ts";',
    `const route: ContentRouteRegistration = ${JSON.stringify(route, null, 2)};`,
    "export default async function ContentPage() {", "  const input: ContentRouteInput = await loadContentRoute();",
    "  return <ContentRoutePage input={requireContentRoutePublishing(bindContentRoute(input, route))} />;", "}", "",
  ].join("\n");
  // The source file is target-qualified; use its existing loader-relative line as part of the golden.
  const source = emitContentRoutePage(route);
  expect(source).toBe(expected);
  expect(emitContentRoutePage(route, options)).toBe(source.replaceAll("@clossys/publisher/web/content-route", "./runtime/content-route"));
  expect(() => emitContentRoutePage(route, { appLocal: {} })).toThrow();
  expect(() => emitContentRoutePage(route, { appLocal: { "@clossys/publisher/web/content-route": "external-runtime" } })).toThrow();
});
