/** @vitest-environment node */
import * as fs from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";
import { emit, resolve, runtimeHash } from "@clossys/designer/catalog";
import type { CompositeResolved } from "@clossys/designer/catalog";
import { consumerDogfoodSources, runConsumerDogfood } from "@clossys/designer/catalog/server";
import { compile } from "tailwindcss";
import { createRequire } from "node:module";
import { scanClassCandidates } from "../../../designer/dist/compiled-css/class-scan.js";
import { checkRegisteredRoutes, emitRegisteredRouteAdapter, emitRegisteredRoutePage, emitRegisteredRouteRegistryModule } from "./registered-route-check.js";
import { syntheticPlan, SYNTHETIC_ROUTE_REGISTRIES } from "../core/__fixtures__/registered-route.js";
import { PublisherPlanStore } from "../planning/change-set.js";
import { compileRegisteredRouteFixture, syntheticRegisteredRoute, type CompiledRegisteredRoute } from "./__fixtures__/registered-route-runtime.js";
const exec = promisify(execFile);
/** Test-only use of the same locked compiler as generateCompiledCss. No CSS
 * snapshot or caller-selected output replaces the actual theme/source inputs. */
async function compileReachedFixtureCss(profile: CompositeResolved, files: readonly { file: string; content: string }[]) {
  const directory = await fs.mkdtemp(join(tmpdir(), "SYNTHETIC-reached-classes-"));
  try {
    const reached = files.filter(row => /\.[cm]?[jt]sx?$/.test(row.file)).sort((a, b) => a.file.localeCompare(b.file));
    for (const [index, row] of reached.entries()) await fs.writeFile(join(directory, `${index}.tsx`), row.content);
    const candidates = scanClassCandidates(directory).candidates;
    const theme = emit(profile.values, ["tailwind-theme"], { header: false })[0]!.contents;
    const compilerVersion = (createRequire(import.meta.url)("tailwindcss/package.json") as { version: string }).version;
    const input = { selection: profile.selectionHash, theme, candidates, compilerVersion,
      reached: Object.fromEntries(reached.map(row => [row.file, runtimeHash(row.content)])) };
    const compiler = await compile(`${theme}\n@tailwind utilities;`);
    const css = `${emit(profile.values, ["css-scales"], { header: false })[0]!.contents}\n${compiler.build(candidates)}`;
    return { inputHash: runtimeHash(input), cssHash: runtimeHash(css), css, input };
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
function assertCurrentFixtureCss(actual: Awaited<ReturnType<typeof compileReachedFixtureCss>>, current: Awaited<ReturnType<typeof compileReachedFixtureCss>>) {
  if (actual.inputHash !== current.inputHash || actual.cssHash !== current.cssHash || runtimeHash(actual.css) !== current.cssHash) throw new Error("Stale compiled fixture stylesheet");
}

let temporary: string, compiled: CompiledRegisteredRoute;
beforeAll(async () => { temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "SYNTHETIC-node-source-chain-"))); compiled = await compileRegisteredRouteFixture(join(temporary, "library")); }, 30000);
afterAll(async () => { await fs.rm(temporary, { recursive: true, force: true }); });
it("keeps an immutable Node source graph unauthenticated when selected styling is incomplete", async () => {
  const { route, registry, engine, manifest, registries: selectedRegistries } = syntheticRegisteredRoute(compiled), root = join(temporary, "consumer");
  const registries = { ...selectedRegistries, frames: [...SYNTHETIC_ROUTE_REGISTRIES.frames, ...selectedRegistries.frames] };
  delete (route.composition.header as { actions?: unknown }).actions;
  const write = async (file: string, contents: string) => { await fs.mkdir(dirname(join(root, file)), { recursive: true }); await fs.writeFile(join(root, file), contents); };
  await write("routes.json", JSON.stringify(registry)); await write("routes.ts", emitRegisteredRouteRegistryModule(registry));
  await write(route.entry.file, emitRegisteredRouteAdapter(route));
  await write(route.composition.source.file, emitRegisteredRoutePage("routes.ts", route));
  await write("runtime.tsx", `import { AppFrame } from "@clossys/designer/frames";\nimport { PageHeaderModule } from "@clossys/designer/shell";\nimport "./selected.css";\nexport function useRuntime(){throw new Error("SYNTHETIC fixture source only")}\nexport function SelectedFrame({header,children}) {return <AppFrame><PageHeaderModule id={header.id} header={header.data}/>{children}</AppFrame>}\n`);
  Object.assign(route.composition, { runtime: { file: "runtime.tsx", export: "useRuntime" } });
  await write("routes.json", JSON.stringify(registry)); await write("routes.ts", emitRegisteredRouteRegistryModule(registry));
  await write(route.composition.source.file, emitRegisteredRoutePage("routes.ts", route));
  await write("selected.css", "");
  const source = await consumerDogfoodSources([route.entry.file], { version: 1, sources: { "@clossys/publisher/web/registered-route": join(import.meta.dirname, "registered-route.js") }, pages: [route.entry.file] }, root, root);
  expect(source.files.some(file => file.file.endsWith("publisher/src/core/flow-stage.ts"))).toBe(true);
  const css = await compileReachedFixtureCss(resolve(engine), source.files);
  // Fresh compilation is repeated at the point of use; stale swapped artifacts
  // do not qualify merely because they carry a plausible hash field.
  assertCurrentFixtureCss(css, await compileReachedFixtureCss(resolve(engine), source.files));
  await write("selected.css", css.css);
  // This isolated fixture repository supplies an actual immutable Git artifact;
  // no source-tree branch or repository history is committed by the test.
  await exec("git", ["init", "--quiet", root]);
  await exec("git", ["-C", root, "add", "."]);
  await exec("git", ["-C", root, "-c", "user.name=Example Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Synthetic immutable source fixture"]);
  const store = new PublisherPlanStore(registries), plan = await store.apply(store.propose(syntheticPlan([route])), () => true);
  const result = await checkRegisteredRoutes({ root, contract: { version: 2, sources: {}, registry: { file: "routes.json", export: "default", module: "routes.ts" }, routeRoots: [{ directory: "app", basePath: "/" }] }, plan, registries, styling: { engine, manifest } });
  if (process.env.ROUTE_NODE_DIAGNOSTIC === "1") console.info(JSON.stringify({ findings: result.findings, dogfood: result.dogfood?.findings, pending: result.sourceEvidencePending }, null, 2));
  expect(result.findings).toEqual([]);
  expect(result.dogfood?.findings).toContainEqual(expect.objectContaining({ code: "DF2", evidence: expect.stringContaining("unresolved class utilities: gap-lg") }));
  expect(result.dogfood?.findings.filter(finding => ["DF1", "DF5"].includes(finding.code))).toEqual([]);
  expect(result.ok).toBe(false); expect(result.sourceEvidence).toEqual([]);
  // This synthetic selection has no spacing choice. It proves a real refusal,
  // not an authentic ready route or a substitute for the actual consumer input.
});

it("fresh locked compiler fixture binds the actual reached class set, selected theme and compiler version", async () => {
  const profile = resolve(compiled.input);
  const files = [{ file: "Page.tsx", content: 'export const view = <div className="grid w-full mx-auto"/>;' }];
  const first = await compileReachedFixtureCss(profile, files);
  expect(first.css).toContain(".grid"); expect(first.css).toContain(".w-full");
  expect(first.css).toContain(".mx-auto");
  expect(first.input.compilerVersion).toBe(createRequire(import.meta.url)("tailwindcss/package.json").version);
  expect(first.input.theme).toBe(emit(profile.values, ["tailwind-theme"], { header: false })[0]!.contents);
  const repeat = await compileReachedFixtureCss(profile, files);
  expect(() => assertCurrentFixtureCss(first, repeat)).not.toThrow();
  const changedClasses = await compileReachedFixtureCss(profile, [{ ...files[0]!, content: files[0]!.content.replace("grid w-full", "flex w-full") }]);
  expect(changedClasses.input.candidates).not.toEqual(first.input.candidates);
  expect(() => assertCurrentFixtureCss(first, changedClasses)).toThrow("Stale compiled fixture stylesheet");
  const changedProfile = structuredClone(profile);
  const breakpoint = changedProfile.values.members["tokens.breakpoint.tablet"];
  expect(breakpoint).toBeDefined();
  Object.assign(breakpoint!.value, { light: { unit: "px", value: 801 } });
  Object.assign(breakpoint!.css, { light: "801px" });
  const changedTheme = await compileReachedFixtureCss(changedProfile, files);
  expect(changedTheme.input.theme).not.toBe(first.input.theme);
  expect(() => assertCurrentFixtureCss(first, changedTheme)).toThrow("Stale compiled fixture stylesheet");
  expect(() => assertCurrentFixtureCss({ ...repeat, css: changedClasses.css }, repeat)).toThrow("Stale compiled fixture stylesheet");
});

it("keeps missing selected spacing as a real unresolved utility instead of inventing compiler CSS", async () => {
  const files = [{ file: "Page.tsx", content: 'export const view = <div className="grid gap-lg"/>;' }];
  const current = await compileReachedFixtureCss(resolve(compiled.input), files);
  expect(current.input.candidates).toContain("gap-lg"); expect(current.css).not.toContain(".gap-lg");
  const result = runConsumerDogfood({ files, themeCss: current.css, consumerBoundary: { pages: ["Page.tsx"], sourceImports: {} }, tokenLibrary: { catalog: compiled.input.catalog.values, library: { ...compiled.input.library.values, source: compiled.input.library.source, adoptedAt: compiled.input.library.adoptedAt } } });
  expect(result.findings).toContainEqual(expect.objectContaining({ code: "DF2", evidence: expect.stringContaining("unresolved class utilities: gap-lg") }));
});
