import { routeProviderMount, routeSourcePath } from "../core/route-registry.js";
import type { RouteRegistration, RouteRegistry, RouteSourceExport } from "../core/route-registry.js";
function modulePath(from: string, to: string): string {
  if (!routeSourcePath(from) || !routeSourcePath(to)) throw new Error("Consumer-relative source paths required");
  const a = from.split("/"); a.pop(); const b = to.split("/");
  while (a.length && a[0] === b[0]) { a.shift(); b.shift(); }
  const path = [...a.map(() => ".."), ...b].join("/");
  return path.startsWith(".") ? path : `./${path}`;
}
function named(ref: RouteSourceExport, from: string, local: string): string {
  const module = JSON.stringify(modulePath(from, ref.file));
  return ref.export === "default" ? `import ${local} from ${module};` : `import { ${ref.export} as ${local} } from ${module};`;
}
/** A typed registry module path: consumer-relative TypeScript, never a declaration or JSON file. */
function typedModule(module: unknown): module is string {
  return typeof module === "string" && routeSourcePath(module) && /[^/]\.ts$/.test(module) && !module.endsWith(".d.ts");
}
/** The top-level directory a nested module lives in; a root-level module has none. */
function sourceTree(module: string): string | undefined {
  return module.includes("/") ? module.split("/")[0] : undefined;
}
/** The registry has two placements. The finite JSON control input is what the checker
 * reads; the typed module is what generated pages import. The JSON never sits inside
 * the typed module's source tree, so no JSON lands under a scanned source root. */
export function registeredRouteRegistryPlacement(file: unknown, module: unknown): { readonly file: string; readonly module: string } {
  if (typeof file !== "string" || !routeSourcePath(file) || !/[^/]\.json$/.test(file)) throw new Error("Consumer-relative JSON registry control input required");
  if (!typedModule(module)) throw new Error("Consumer-relative typed registry module (.ts) required");
  const tree = sourceTree(module);
  if (tree !== undefined && file.startsWith(`${tree}/`)) throw new Error("JSON registry control input must stay outside the typed registry module's source tree");
  return { file, module };
}
/** Imported JSON widens `version: 1` and every literal union to primitives. This
 * deterministic, self-contained module states the registry as one literal checked
 * against the page prop type with `satisfies` (no cast) and imports nothing from
 * outside the source tree. The checker requires its exact bytes for the JSON it reads. */
export function emitRegisteredRouteRegistryModule(registry: RouteRegistry): string {
  if (!registry || registry.version !== 1 || typeof registry.consumer !== "string" || !Array.isArray(registry.routes)) throw new Error("Version 1 route registry required");
  return [
    'import type { RegisteredRoutePageProps } from "@clossys/publisher/web/registered-route";',
    `const registry = ${JSON.stringify(registry, null, 2)} satisfies RegisteredRoutePageProps["registry"];`,
    "export default registry;", "",
  ].join("\n");
}
/** The one checked source shape. No consumer-authored JSX body or wrapper is accepted.
 * The page imports only the typed registry module, and every relative import stays in
 * that module's source tree. */
export function emitRegisteredRoutePage(registryModule: string, route: RouteRegistration): string {
  if (!typedModule(registryModule) || route.composition.source.export !== "default") throw new Error("Typed registry module and default emitted page export required");
  const file = route.composition.source.file, provider = route.composition.provider;
  if (provider && !routeProviderMount(route)) throw new Error("Registered nonvisual provider mount required");
  const tree = sourceTree(registryModule), imports = [file, route.composition.runtime.file, route.composition.header.actions?.file, provider?.source?.file];
  if (tree !== undefined && imports.some(path => path !== undefined && !String(path).startsWith(`${tree}/`))) throw new Error("Generated page imports must stay inside the typed registry module's source tree");
  const page = `<RegisteredRoutePage registry={registry} routeId=${JSON.stringify(route.routeId)} useRuntime={useRuntime}${route.composition.header.actions ? " renderActions={renderActions}" : ""} />`;
  return [
    '"use client";',
    `import registry from ${JSON.stringify(modulePath(file, registryModule))};`,
    'import { RegisteredRoutePage } from "@clossys/publisher/web/registered-route";',
    named(route.composition.runtime, file, "useRuntime"),
    ...(route.composition.header.actions ? [named(route.composition.header.actions, file, "renderActions")] : []),
    ...(provider ? [named(provider.source, file, "RegisteredProvider")] : []),
    "export default function RegisteredPage() {",
    `  return ${provider ? `<RegisteredProvider>${page}</RegisteredProvider>` : page};`,
    "}", "",
  ].join("\n");
}
export function emitRegisteredRouteAdapter(route: RouteRegistration): string {
  if (route.entry.export !== "default") throw new Error("Next page entries require the default export");
  if (route.entry.file === route.composition.source.file) throw new Error("A direct emitted page needs no adapter");
  return `export { default } from ${JSON.stringify(modulePath(route.entry.file, route.composition.source.file))};\n`;
}
