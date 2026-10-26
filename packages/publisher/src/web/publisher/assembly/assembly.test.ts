import { productionSettingsFromBinding } from "../production-settings.js";
import { expect, it } from "vitest";
import { derivePackPipeline } from "../pipeline.js";
import { STANDARD_PACK_INSTANCES, STANDARD_PACK_REGISTRIES, createStandardPackLibrary } from "../__fixtures__/standard-website.js";
import { fixtureCompiler } from "../__fixtures__/compiler.js";
import { layoutSourceClosure } from "../__fixtures__/source-closure.mjs";
import { ASSEMBLY_OWNERS, deriveItemAssembly } from "./assembly.js";

const renderers = { "layouts.stack": layoutSourceClosure("web/layouts/Stack.tsx"), "layouts.split": layoutSourceClosure("web/layouts/Split.tsx") };
const library = createStandardPackLibrary(renderers);
const configured = Object.fromEntries(STANDARD_PACK_INSTANCES.map(binding => [binding.instanceId, productionSettingsFromBinding(binding)]));
const instances = STANDARD_PACK_INSTANCES;
const registries = STANDARD_PACK_REGISTRIES;
const items = () => derivePackPipeline(instances, library, registries, fixtureCompiler, configured).items;

it("derives all owner lanes from actual inputs and keeps absent dependencies pending", () => {
  const nodes = deriveItemAssembly(items()[0]!, registries);
  expect(nodes.map(node => node.owner)).toEqual(ASSEMBLY_OWNERS);
  expect(nodes.find(node => node.owner === "Tokens")).toMatchObject({ status: "pending", references: [] });
  const contact = deriveItemAssembly(items()[2]!, registries);
  expect(contact.find(node => node.owner === "Tokens")?.references).toEqual(["tokens.breakpoint.tablet"]);
  expect(nodes.find(node => node.owner === "Components")).toMatchObject({ status: "pending", references: [] });
  expect(nodes.find(node => node.owner === "Format")).toMatchObject({ status: "passed", references: ["web.page.responsive"], summary: "Responsive web page" });
  expect(nodes.find(node => node.owner === "Content")?.status).toBe("passed");
  expect(derivePackPipeline(instances, library, registries, fixtureCompiler, configured).readyCount).toBe(0);
});

it("retains About LK2 and short-circuited evidence without a fallback config", () => {
  const about = items().find(item => item.binding.instanceId === "standard.about")!;
  const nodes = deriveItemAssembly(about, registries);
  expect(nodes.find(node => node.owner === "Layouts")).toMatchObject({ status: "failed", references: ["layouts.stack", "stack.default"] });
  expect(nodes.find(node => node.owner === "Layouts")?.findings.map(finding => finding.code)).toContain("LK2");
  expect(nodes.find(node => node.owner === "Tokens")).toMatchObject({ status: "pending", references: [] });
  expect(nodes.find(node => node.owner === "Content")?.status).toBe("pending");
});

it("exposes missing referenced tokens and real renderer mutations as failures", () => {
  const missing = { ...registries, tokens: registries.tokens.filter(token => token.id !== "tokens.breakpoint.tablet") };
  const contact = derivePackPipeline(instances, library, missing, fixtureCompiler, configured).items[2]!;
  expect(deriveItemAssembly(contact, missing).find(node => node.owner === "Tokens")?.status).toBe("failed");
  const broken = structuredClone(renderers);
  broken["layouts.stack"].files[broken["layouts.stack"].entry] += '\nexport const Regression = () => <div className="bg-red-500" />;';
  const mutated = derivePackPipeline(instances, createStandardPackLibrary(broken), registries, fixtureCompiler, configured).items[0]!;
  expect(deriveItemAssembly(mutated, registries).find(node => node.owner === "Layouts")?.findings.some(finding => finding.code === "LK11")).toBe(true);
});

it("binds Format assembly evidence to the supplied registry and retains LK16 refusals", () => {
  const missing = { ...registries, formats: [] };
  const item = derivePackPipeline(instances, library, missing, fixtureCompiler, configured).items[0]!;
  const format = deriveItemAssembly(item, missing).find(node => node.owner === "Format")!;
  expect(format.status).toBe("failed");
  expect(format.references).toEqual([item.binding.format]);
  expect(format.findings.some(finding => finding.code === "LK16")).toBe(true);
});


it("includes host-only frame content in its owner lane without inventing section fills or runtime proof", () => {
  const source = instances[0]!;
  const reference = Object.values(instances[1]!.fills.lead![0]!.content)[0]!;
  const binding = { ...source, frame: { ...source.frame, content: { "skip-link": reference } } };
  const item = derivePackPipeline([binding], library, registries, fixtureCompiler, configured).items[0]!;
  expect(item.binding.frame.content).toEqual({ "skip-link": reference });
  const before = deriveItemAssembly(items()[0]!, registries);
  const nodes = deriveItemAssembly(item, registries);
  const content = nodes.find(node => node.owner === "Content")!;
  expect(before.find(node => node.owner === "Content")!.references).not.toContain(`${reference.kind} · ${reference.ref}`);
  expect(content.references).toContain(`${reference.kind} · ${reference.ref}`);
  expect(content.status).toBe("pending");
  expect(content.detail).toContain("Frame host content required-slot, value and hash verification pending");
  expect(nodes.find(node => node.owner === "Sections")).toEqual(before.find(node => node.owner === "Sections"));
  expect(item.binding.fills).toBe(source.fills);
  expect(item.binding.frame.slotFills).toBe(source.frame.slotFills);
  expect(item.wholeInstanceLK12).toBe("pending");
  expect(item.state).not.toBe("ready");
});
