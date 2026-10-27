import { routeProviderMount, routeSourcePath } from "../core/route-registry.js";
import type { RouteRegistration, RouteSourceExport } from "../core/route-registry.js";
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
/** The one checked source shape. No consumer-authored JSX body or wrapper is accepted. */
export function emitRegisteredRoutePage(registryFile: string, route: RouteRegistration): string {
  if (!registryFile.endsWith(".json") || route.composition.source.export !== "default") throw new Error("Finite JSON registry and default emitted page export required");
  const file = route.composition.source.file, provider = route.composition.provider;
  if (provider && !routeProviderMount(route)) throw new Error("Registered nonvisual provider mount required");
  const page = `<RegisteredRoutePage registry={registry} routeId=${JSON.stringify(route.routeId)} useRuntime={useRuntime}${route.composition.header.actions ? " renderActions={renderActions}" : ""} />`;
  return [
    '"use client";',
    `import registry from ${JSON.stringify(modulePath(file, registryFile))} with { type: "json" };`,
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
