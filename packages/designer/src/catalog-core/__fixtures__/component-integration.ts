/** SYNTHETIC public-facade corpus. No shipped-component conformance claim. */
import { synthetic, syntheticSource } from "./component-engine/synthetic.js";
import { applyLibraryChange, libraryHash, resolve } from "../api.js";
import { loadCatalog } from "../index.js";
import { componentSourceHash, componentTokensHash } from "../check-components.js";
import type { CompositeCatalogData, CompositeEngineInput, CompositeLibraryData, DtcgToken, LibraryData } from "../types.js";

export function componentIntegration(source = false): CompositeEngineInput {
  const component = source ? syntheticSource() : synthetic();
  const allValues = loadCatalog();
  // Deliberately bounded synthetic registry: all token bindings, one real glyph, and the required consumer favicon.
  const values = { ...allValues, slots: allValues.slots.filter(slot => slot.layer === "themes" || slot.id === "assets.icon-close" || slot.id === "assets.favicon") };
  let library: LibraryData = { source: component.library.source, fills: [], adoptedAt: component.library.adoptedAt };
  library = applyLibraryChange(values, library, { baseHash: libraryHash(library), changes: [
    ...["themes.foreground", "themes.background", "themes.ring"].map(slot => ({ op: "adopt" as const, slot, source: "shadcn@aria" })),
    ...["themes.spacing", "themes.font-sans"].map(slot => ({ op: "adopt" as const, slot, source: "tailwind-default" })),
    { op: "adopt", slot: "assets.icon-close", source: "lucide" },
    { op: "author", slot: "assets.favicon", tokens: { vector: { $type: "svg", $value: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" color="#000000"><style>@media (prefers-color-scheme: dark){svg{color:#ffffff}}</style><path d="M4 4h16v16H4z" fill="currentColor"/></svg>' } } },
  ] });
  const color = (light: string, dark: string): DtcgToken => ({ $type: "color", $value: light, $extensions: { "com.clossys.css": { raw: light }, "com.clossys.modes": { dark } } });
  library = applyLibraryChange(values, library, { baseHash: libraryHash(library), changes: [
    { op: "author", slot: "themes.foreground", tokens: { default: color("#000000", "#ffffff") } },
    { op: "author", slot: "themes.background", tokens: { default: color("#ffffff", "#000000") } },
    { op: "author", slot: "themes.ring", tokens: { default: color("#000000", "#ffffff") } },
  ] });
  const resolved = resolve({ catalog: values, library });
  const observedCss = (id: string, mode: "light" | "dark"): string => {
    let member = resolved.members[id]!;
    while (member.alias[mode] ?? member.alias.light) member = resolved.members[(member.alias[mode] ?? member.alias.light)!]!;
    return member.css[mode] ?? member.css.light;
  };
  const tokens = Object.fromEntries(Object.entries(resolved.members).filter(([id, member]) => id.startsWith("themes.") && member.emit).map(([id, member]) => [id, { property: member.emit!, light: observedCss(id, "light"), ...(member.value.dark === undefined ? {} : { dark: observedCss(id, "dark") }) }]));
  const observation = component.check.observations["components.button"]!;
  observation.tokensHash = componentTokensHash(tokens);
  if (!source) {
    observation.files[0]!.content = `import {Button} from "react-aria-components"; export const Example = () => <Button style={{color:"var(${tokens["themes.foreground.default"]!.property})",background:"var(${tokens["themes.background.default"]!.property})"}}>Continue</Button>;`;
    observation.sourceHash = componentSourceHash(observation.files);
    component.candidate.reads.assets = ["assets.icon-close"];
    component.candidate.impl = { kind: "package", module: "@clossys/designer/components", export: "Button" };
    component.candidate.pin = { package: "@clossys/designer", version: "0.12.0", export: "./components#Button" };
  }
  const { source: consumer, adoptedAt, ...valuePortion } = library;
  const composite: CompositeLibraryData = { source: consumer, adoptedAt, values: valuePortion, components: { fills: [], files: [] } };
  const catalog: CompositeCatalogData = { values, components: component.catalog };
  return { catalog, library: composite, componentOptions: { evidence: { observations: component.check.observations, installedRac: component.check.installedRac }, packageExports: { "@clossys/designer/components": ["Button", "GlyphProvider"], "react-aria-components": ["Button"] } } };
}
export function adoptedComponentIntegration(): CompositeEngineInput {
  const input = componentIntegration();
  return { ...input, library: applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: "components", change: { op: "adopt", slot: "components.button", source: "test-kit" } }] }) };
}
