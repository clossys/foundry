import { registeredRouteHeadMetadata } from "./headMetadata.js";
import { routeProviderMount, routeServerLoader, routeSourcePath, completeRouteKind, isCompleteRouteKind, isLegacyRouteRegistration } from "../core/route-registry.js";
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
 * with the page prop type annotation (no cast). Heterogeneous fill keys do not
 * infer optional undefined properties. It imports nothing outside the source tree. The checker requires its exact bytes for the JSON it reads. */
export function emitRegisteredRouteRegistryModule(registry: RouteRegistry): string {
  if (!registry || registry.version !== 1 || typeof registry.consumer !== "string" || !Array.isArray(registry.routes)) throw new Error("Version 1 route registry required");
  return [
    registry.routes.some(route => !isLegacyRouteRegistration(route)) ? 'import type { RouteRegistry } from "@clossys/publisher/core";' : 'import type { RegisteredRoutePageProps } from "@clossys/publisher/web/registered-route";',
    `const registry: ${registry.routes.some(route => !isLegacyRouteRegistration(route)) ? "RouteRegistry" : 'RegisteredRoutePageProps["registry"]'} = ${JSON.stringify(registry, null, 2)};`,
    "export default registry;", "",
  ].join("\n");
}
/** The one checked source shape. No consumer-authored JSX body or wrapper is accepted.
 * The page imports only the typed registry module, and every relative import stays in
 * that module's source tree. */
export function emitRegisteredRoutePage(registryModule: string, route: RouteRegistration): string {
  if (!isLegacyRouteRegistration(route)) throw new Error("Complete routes emit their registered server entry directly");
  if (!typedModule(registryModule) || route.composition.source.export !== "default") throw new Error("Typed registry module and default emitted page export required");
  const file = route.composition.source.file, provider = route.composition.provider;
  if (provider && !routeProviderMount(route)) throw new Error("Registered nonvisual provider mount required");
  const loader = "loader" in route.composition ? routeServerLoader(route) : undefined;
  if ("loader" in route.composition && !loader) throw new Error("Registered server data loader required");
  const tree = sourceTree(registryModule), imports = [file, route.composition.runtime.file, route.composition.header.actions?.file, provider?.source?.file, loader?.file];
  if (tree !== undefined && imports.some(path => path !== undefined && !String(path).startsWith(`${tree}/`))) throw new Error("Generated page imports must stay inside the typed registry module's source tree");
  // A route without a loader keeps its exact prior bytes; a loader adds only the typed data prop.
  const page = `<${loader ? "RegisteredServerDataRoutePage" : "RegisteredRoutePage"} registry={registry} routeId=${JSON.stringify(route.routeId)}${loader ? " data={data}" : ""} useRuntime={useRuntime}${route.composition.header.actions ? " renderActions={renderActions}" : ""} />`;
  return [
    '"use client";',
    `import registry from ${JSON.stringify(modulePath(file, registryModule))};`,
    ...(loader ? [
      'import { RegisteredServerDataRoutePage } from "@clossys/publisher/web/registered-route";',
      'import type { RegisteredRouteServerData } from "@clossys/publisher/web/registered-route";',
      typeOnly(loader, file, "RegisteredLoader"),
    ] : ['import { RegisteredRoutePage } from "@clossys/publisher/web/registered-route";']),
    named(route.composition.runtime, file, "useRuntime"),
    ...(route.composition.header.actions ? [named(route.composition.header.actions, file, "renderActions")] : []),
    ...(provider ? [named(provider.source, file, "RegisteredProvider")] : []),
    loader ? "export default function RegisteredPage({ data }: { readonly data: RegisteredRouteServerData<typeof RegisteredLoader> }) {" : "export default function RegisteredPage() {",
    `  return ${provider ? `<RegisteredProvider${loader ? " data={data}" : ""}>${page}</RegisteredProvider>` : page};`,
    "}", "",
  ].join("\n");
}
function typeOnly(ref: RouteSourceExport, from: string, local: string): string {
  const module = JSON.stringify(modulePath(from, ref.file));
  return ref.export === "default" ? `import type ${local} from ${module};` : `import type { ${ref.export} as ${local} } from ${module};`;
}
/** The route entry exports native head metadata and re-exports the emitted page
 * without a loader. With one, it is the one server page: it imports exactly the registered
 * loader, awaits it with no arguments and passes the checked serializable result as
 * the emitted client page's only prop. No other import, call or fetch is emitted. */
export function emitRegisteredRouteAdapter(route: RouteRegistration): string {
  if (!isLegacyRouteRegistration(route)) {
    const kind = completeRouteKind(route), loader = route.composition.loader;
    if (!kind || !loader) throw new Error("Complete kind and registered data loader required");
    return emitCompleteRoutePage({ kind, file: route.entry.file, loader });
  }
  if (route.entry.export !== "default") throw new Error("Next page entries require the default export");
  if (route.entry.file === route.composition.source.file) throw new Error("A direct emitted page needs no adapter");
  const metadata = `const metadata = ${JSON.stringify(registeredRouteHeadMetadata(route.path))};\nexport { metadata };`;
  if (!("loader" in route.composition)) return `${metadata}\nexport { default } from ${JSON.stringify(modulePath(route.entry.file, route.composition.source.file))};\n`;
  const loader = routeServerLoader(route);
  if (!loader) throw new Error("Registered server data loader required");
  return [
    'import { registeredRouteServerData } from "@clossys/publisher/core";',
    named(loader, route.entry.file, "registeredLoader"),
    `import RegisteredPage from ${JSON.stringify(modulePath(route.entry.file, route.composition.source.file))};`,
    metadata,
    "export default async function RegisteredServerPage() {",
    "  return <RegisteredPage data={registeredRouteServerData(await registeredLoader())} />;",
    "}", "",
  ].join("\n");
}

export interface CompleteRoutePageSource {
  readonly kind: import("../core/route-registry.js").CompleteRouteKind;
  readonly file: string;
  readonly loader: RouteSourceExport;
}
/** A complete native view owns its client controller. The server route only loads
 * finite data and forwards the two public props. This source is display output;
 * it does not replace registered source or Node qualification evidence. */
export function emitCompleteRoutePage(input: CompleteRoutePageSource): string {
  if (!input || !isCompleteRouteKind(input.kind)) throw new Error("Complete Designer, Publisher or Writer route kind required");
  if (!routeSourcePath(input.file) || !input.file.endsWith(".tsx")) throw new Error("Consumer-relative TSX route file required");
  if (!input.loader || !routeSourcePath(input.loader.file) || !/^[A-Za-z_$][\w$]*$/.test(input.loader.export)) throw new Error("Consumer-relative typed loader export required");
  if (input.file === input.loader.file || !/\.(?:ts|tsx)$/.test(input.loader.file) || input.loader.file.endsWith(".d.ts")) throw new Error("Separate typed loader module required");
  const component = input.kind === "designer" ? "DesignerRoutePage" : input.kind === "writer" ? "WriterRoutePage" : "PublisherRoutePage";
  return [
    `import { ${component} } from "@clossys/publisher/web/registered-route";`,
    named(input.loader, input.file, "loadRouteData"),
    `const metadata = ${JSON.stringify(registeredRouteHeadMetadata(`/agents/${input.kind}`))};\nexport { metadata };`,
    "export default async function CompletePage() {",
    "  const data = await loadRouteData();",
    `  return <${component} serverData={data.serverData} initialSession={data.initialSession} />;`,
    "}", "",
  ].join("\n");
}
export { createContentRouteManifest, emitContentRoutePage } from "./content-route-source.js";
export type { CreateContentRouteManifestInput } from "./content-route-manifest.js";
export type { ContentRouteManifest, ContentRouteRegistration } from "./content-route-types.js";
