import { Suspense } from "react";
import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { PricingTable } from "./PricingTable.js";
import { STRUCTURED_BLOCK_SAMPLES } from "../studio/surface-preview-samples.js";
import { fixtureConsumerComponents } from "../catalog-core/__fixtures__/surface-consumer-components.js";
import { ConsumerComponentProvider } from "../runtime/component-leaf.client.js";
import { specimenDataset } from "../studio/specimen-dataset.js";
import { renderPricingSection } from "../runtime/sections/pricing.js";
import { groupASectionInput } from "../runtime/sections/group-a-dataset.js";
import document from "../catalog/fills/foundry/sections.pricing.json" with { type: "json" };

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { componentDescriptorHash, type ComponentCandidate } from "../catalog-core/resolve-components.js";
import type { ConsumerComponentSelection } from "../runtime/component-leaf.client.js";

const sample = specimenDataset.sections.pricing;
let selected: ConsumerComponentSelection;
// This is a consumer override using the native materializer's exact Card/Table
// descriptors and bytes. It does not alter the package's default-pick fixture.
beforeAll(async () => {
  selected = fixtureConsumerComponents();
  const bundles = loadCatalogBundles();
  for (const leaf of ["card", "table"]) {
    const slot = `components.${leaf}`;
    const document = bundles.componentFills.find(doc => doc.$extensions["com.clossys.fill"].slot === slot && doc.$extensions["com.clossys.fill"].source === "shadcn@aria")!;
    const descriptor = Object.values(document.components)[0]! as ComponentCandidate;
    const bundle = bundles.sourceBundles.find(row => row.slot === slot && row.descriptorHash === componentDescriptorHash(descriptor))!;
    expect(bundle, `${slot} native materialized bundle`).toBeDefined();
    if (descriptor.impl.kind !== "source") throw new Error("Expected source implementation");
    const files = new Map(bundle.files.map(file => [file.path, file.content]));
    const compiled = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { build } from "esbuild";
      import { posix } from "node:path";
      let data = ""; for await (const chunk of process.stdin) data += chunk;
      const { entry, rows } = JSON.parse(data), files = new Map(rows);
      const output = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", plugins: [{ name: "native-test-source", setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          if (!args.importer) return { path: args.path, namespace: "native-source" };
          if (!args.path.startsWith(".")) return { path: args.path, external: true };
          const path = posix.normalize(posix.join(posix.dirname(args.importer), args.path));
          const found = [path, path + ".ts", path + ".tsx", path + "/index.ts"].find(value => files.has(value));
          if (!found) throw new Error("Missing native test source " + path);
          return { path: found, namespace: "native-source" };
        });
        builder.onLoad({ filter: /.*/, namespace: "native-source" }, args => ({ contents: files.get(args.path), loader: args.path.endsWith("tsx") ? "tsx" : "ts" }));
      } }] });
      process.stdout.write(output.outputFiles[0].text);
    `], { input: JSON.stringify({ entry: descriptor.impl.entry, rows: [...files] }), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    const module = { exports: {} as Record<string, unknown> };
    // Test-only execution of the exact native output, not a production loader.
    new Function("require", "module", "exports", compiled)(createRequire(import.meta.url), module, module.exports);
    const current = selected.profile.components.components[slot]!;
    selected.profile.components.components[slot] = { ...current, descriptor, impl: descriptor.impl, propMap: descriptor.propMap };
    selected = { ...selected, modules: { ...selected.modules, [descriptor.impl.entry]: module.exports }, descriptors: { ...selected.descriptors, [slot]: componentDescriptorHash(descriptor) } };
    selected.profile.components.files = [...selected.profile.components.files.filter(file => !files.has(file.path)), ...bundle.files];
  }
});
function preview(children: React.ReactNode) {
  return render(<ConsumerComponentProvider value={selected}><Suspense fallback={null}>{children}</Suspense></ConsumerComponentProvider>);
}

describe("A270 generic pricing specimen", () => {
  it("renders generic plans through selected shadcn Card sub-parts without price placeholders", async () => {
    const { container } = preview(STRUCTURED_BLOCK_SAMPLES.PricingTable!());
    await screen.findByRole("heading", { name: sample.heading });
    expect(container.querySelector('[data-ds-leaf="sections.pricing"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-slot="card-header"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-slot="card-content"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-slot="card-footer"]')).toHaveLength(3);
    for (const tier of sample.tiers) {
      expect(screen.getByText(tier.name)).toBeInTheDocument();
      expect(screen.getByText(tier.cta)).toBeInTheDocument();
    }
    expect(container.textContent).not.toMatch(/[$€£]|\b(?:monthly|annually|free|price)\b/i);
    expect(container.querySelectorAll('.text-h1')).toHaveLength(0);
  });

  it("accepts host JSON plans without prices and preserves actionable destinations", async () => {
    const input = groupASectionInput("pricing", document);
    const plans = sample.tiers.map(tier => ({ id: tier.id, name: tier.name, features: [...tier.features], cta: { href: `#${tier.id}`, label: tier.cta } }));
    const { container } = preview(renderPricingSection({ ...input, content: { ...input.content, plans: { ...input.content.plans!, value: plans } } }));
    for (const tier of sample.tiers) expect(await screen.findByRole("link", { name: tier.cta })).toHaveAttribute("href", `#${tier.id}`);
    expect(container.textContent).not.toMatch(/[$€£]/);
  });

  it("renders comparison rows with the selected shadcn Table parts and row headers", async () => {
    preview(<PricingTable tiers={sample.tiers.map(({ cta, ...tier }) => ({ ...tier, cta }))} comparison={{ groups: [{ id: "tools", label: "Included tools", rows: [{ id: "workspace", label: "Workspace", cells: Object.fromEntries(sample.tiers.map(tier => [tier.id, { kind: "text" as const, text: "Included" }])) }] }] }} />);
    const table = await screen.findByRole("grid", { name: "Included tools" });
    expect(table).toHaveAttribute("data-slot", "table");
    expect(within(table).getByRole("rowheader", { name: "Workspace" })).toBeInTheDocument();
    expect(within(table).getAllByRole("gridcell", { name: "Included" })).toHaveLength(3);
  });
});
