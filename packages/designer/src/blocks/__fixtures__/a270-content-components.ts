import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import cardDocument from "../../catalog/fills/shadcn@aria/components.card.json" with { type: "json" };
import semanticDocument from "../../catalog/fills/foundry/components.semantic-content.json" with { type: "json" };
import { SemanticContent } from "../../components/SemanticContent.js";
import { importShadcnAriaComponents, materializeShadcnComponent } from "../../importers/shadcn-aria-components.js";
import { componentDescriptorHash, type ComponentCandidate, type ResolvedComponent } from "../../catalog-core/resolve-components.js";
import type { ConsumerComponentSelection } from "../../runtime/component-leaf.client.js";

/** Compile the real pinned, rewritten Card source; no stand-in component or export aliases. */
function cardSource() {
  const here = resolve(import.meta.dirname, "../../importers/__fixtures__/shadcn-aria");
  const read = (name: string) => readFileSync(resolve(here, name), "utf8");
  const imported = importShadcnAriaComponents({
    items: readdirSync(here).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"),
    styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") },
    notice: { path: "LICENSE.md", content: read("LICENSE.md") },
  });
  const files = materializeShadcnComponent(imported, "card");
  const scratch = mkdtempSync(resolve(tmpdir(), "a270-content-card-"));
  for (const file of files) {
    const filePath = resolve(scratch, file.path);
    mkdirSync(dirname(filePath), { recursive: true }); writeFileSync(filePath, file.content);
  }
  const code = execFileSync(process.execPath, ["-e",
    'const r=require("esbuild").buildSync({entryPoints:[process.argv[1]],bundle:true,write:false,format:"cjs",platform:"node",jsx:"automatic",external:["react","react/jsx-runtime","clsx","tailwind-merge"]});process.stdout.write(r.outputFiles[0].text)',
    resolve(scratch, "components/card/card.tsx")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(createRequire(import.meta.url), module, module.exports);
  return { files, module: module.exports };
}
const compiled = cardSource();

function chosen(descriptor: ComponentCandidate): ResolvedComponent {
  if (descriptor.impl.kind === "composed") throw new Error("NEED concrete component fixture");
  return { slot: descriptor.slot, originKind: "adopted", origin: { kind: "adopted", source: descriptor.source,
    fill: `${descriptor.source}/${descriptor.slot}`, pin: descriptor.pin, license: descriptor.license,
    sha256: componentDescriptorHash(descriptor), adoptedAt: "2026-10-30" },
    descriptor, impl: descriptor.impl, propMap: descriptor.propMap, reads: { themes: {}, assets: [], components: [] } };
}

/** The selected bridge checks real descriptor identities, source receipts and native CardContent. */
export function contentComponentSelection(): ConsumerComponentSelection {
  const components = {
    "components.card": chosen(cardDocument.components.card as unknown as ComponentCandidate),
    "components.semantic-content": chosen(semanticDocument.components["semantic-content"] as unknown as ComponentCandidate),
  };
  return { selectionHash: "a270-content-source-test", descriptors: Object.fromEntries(Object.entries(components).map(([leaf, value]) => [leaf, componentDescriptorHash(value.descriptor)])),
    profile: { components: { consumer: "example", selectionHash: "a270-content-source-test", components, files: compiled.files,
      check: { ok: false, findings: [] }, packageExports: { "@clossys/designer/components": ["SemanticContent"] } } },
    modules: { "components/card/card.tsx": compiled.module, "@clossys/designer/components": { SemanticContent } },
  };
}
