/** Source-build qualification against the actual selected closure; never imported by the runtime replay. */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve as pathResolve } from "node:path";
import { resolve } from "../catalog-core/api.js";
import { surfaceEntryOf, isSurfacePackageEntry, surfaceOf } from "../catalog-core/surface-library.js";
import { bindSurfaceSource } from "../catalog-core/surface-bindings.js";
import { surfaceRuntimeIdentity } from "../catalog-core/surface-check.js";
import { runtimeHash } from "../catalog-core/runtime-ports.js";
import { sha256 } from "../catalog-core/digest.js";
import { SPECIMEN_SECTION_EXPORTS } from "../importers/specimen-sections.js";
import type { CompositeEngineInput } from "../catalog-core/types.js";
import type { SurfaceCommandReceipt, SurfaceDependency, SurfaceMeasurement, SurfacePackageEvidence } from "../catalog-core/surface-types.js";

const worker = new URL(import.meta.url.endsWith(".ts") ? "./surface-evidence-compiler.ts" : "./surface-evidence-compiler.js", import.meta.url);
async function compile<T>(request: object): Promise<{ result: T; command: SurfaceCommandReceipt; stdout: string; stderr: string }> {
  const root = pathResolve(dirname(fileURLToPath(worker)), "../..");
  const argv = ["node", relative(root, fileURLToPath(worker)).split("\\").join("/")];
  return await new Promise((done, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) { reject(new Error(`Native surface qualification failed (compiler exit ${code}): ${stderr}`)); return; }
      try { done({ result: JSON.parse(stdout) as T, stdout, stderr, command: { argv, exitCode: code, stdoutSha256: sha256(stdout), stderrSha256: sha256(stderr) } }); } catch (error) { reject(error); }
    });
    child.stdin.on("error", reject); child.stdin.end(JSON.stringify(request));
  });
}

/** Read installed runtime exports and compiler-visible declarations before source preparation. */
export async function specimenSurfaceEnvironment(input: CompositeEngineInput) {
  const modules = new Set<string>(["@clossys/designer/studio"]);
  for (const doc of input.library.components.fills) {
    const component = Object.values(doc.components)[0]!;
    if (component.impl.kind === "package") {
      modules.add(component.impl.module);
      for (const pointer of Object.values(component.propMap)) {
        const subpath = pointer.match(/^\.\/([^#]+)#/)?.[1];
        if (subpath && component.pin?.package) modules.add(`${component.pin.package}/${subpath}`);
      }
    }
  }
  const imports = new RegExp("\\b(?:import|export)\\s[^;]*?\\bfrom\\s*[\"']([^\"']+)[\"']", "g");
  for (const file of input.library.components.files) for (const edge of file.content.matchAll(imports)) if (!edge[1]!.startsWith(".")) modules.add(edge[1]!);
  const { result } = await compile<{ packages: SurfacePackageEvidence[]; dependencies: SurfaceDependency[] }>({ modules: [...modules].sort() });
  const packageExports = { ...input.componentOptions?.packageExports, ...Object.fromEntries(result.packages.map(row => [row.module, row.values])) };
  return { dependencies: result.dependencies, input: { ...input, componentOptions: { ...input.componentOptions, packageExports }, surfaceOptions: { packages: [...(input.surfaceOptions?.packages ?? []).filter(row => !modules.has(row.module)), ...result.packages], measurements: input.surfaceOptions?.measurements ?? [] } } };
}

/** A single completed compiler program qualifies all current native sources. No synthetic records or cache. */
export async function qualifySpecimenSurfaces(input: CompositeEngineInput): Promise<CompositeEngineInput> {
  const native = new Set<string>(SPECIMEN_SECTION_EXPORTS.map(row => row.id));
  const profile = resolve(input);
  const rows = Object.values(profile.surfaces?.fills ?? {}).filter(row => native.has(surfaceEntryOf(row.document).slot) && !isSurfacePackageEntry(surfaceEntryOf(row.document)));
  if (!rows.length) return input;
  const sources = rows.map(row => {
    const fill = surfaceOf(row.document);
    const owned = input.library.surfaces!.files.filter(file => fill.outputSha256.some(pin => pin.path === file.path));
    const bound = bindSurfaceSource(fill, owned, profile, input.surfaceOptions!.packages);
    if (bound.proof.findings.length) throw new Error(`Native surface source closure unavailable: ${JSON.stringify(bound.proof.findings)}`);
    return { row, fill, files: Object.fromEntries([...owned.filter(file => file.path.match(/\.tsx?$/)), ...bound.componentFiles.filter(file => fill.bindings.length && file.path !== "component-index.ts")].map(file => [file.path, file.content])), dependencies: Object.fromEntries(bound.packages.map(pkg => [pkg.module, { version: pkg.version, artifact: `sha256:${pkg.artifactSha256}` as const }])) };
  });
  const files: Record<string, string> = {};
  for (const source of sources) for (const [path, text] of Object.entries(source.files)) {
    if (Object.hasOwn(files, path) && files[path] !== text) throw new Error(`Native surface source collision: ${path}`);
    files[path] = text;
  }
  const { result, command, stdout, stderr } = await compile<{ outputs: Record<string, string>; manifest: { version: string; compilerSha256: string; inputs: unknown[] } }>({ files });
  const compilerSource = { entry: "surface-evidence-compiler.js", files: { "surface-evidence-compiler.js": await readFile(worker, "utf8"), "invocation-manifest.json": JSON.stringify(result.manifest), "input-manifest.json": JSON.stringify(Object.entries(files).map(([path, text]) => ({ path, sha256: sha256(text) }))), "compiler-stdout.json": stdout, "compiler-stderr.txt": stderr }, dependencies: { typescript: { version: result.manifest.version, artifact: `sha256:${result.manifest.compilerSha256}` as const } } };
  const compiler = { id: "native-specimen-installed-typescript", source: compilerSource, sourceHash: runtimeHash(compilerSource) };
  const measurements: SurfaceMeasurement[] = sources.map(source => {
    const entry = source.fill.impl.entry.replace(/\.tsx?$/, ".js");
    if (!Object.hasOwn(result.outputs, entry)) throw new Error(`Native surface compiled entry unavailable: ${entry}`);
    // The compiler resolved every relative import and emitted exactly these selected source files.
    const compiled = { entry, files: Object.fromEntries(Object.keys(source.files).map(path => { const output = path.replace(/\.tsx?$/, ".js"); if (!Object.hasOwn(result.outputs, output)) throw new Error(`Native surface compiled closure unavailable: ${output}`); return [output, result.outputs[output]!]; })), dependencies: source.dependencies };
    return { version: 1, slot: source.fill.slot, scope: "real", identity: surfaceRuntimeIdentity(source.row), source: { entry: source.fill.impl.entry, files: source.files, dependencies: source.dependencies }, compiled, compiler, command, checks: { types: "pass", closure: "pass" }, runtime: null };
  });
  const qualified = { ...input, surfaceOptions: { ...input.surfaceOptions!, measurements: [...input.surfaceOptions!.measurements.filter(row => !native.has(row.slot)), ...measurements] } };
  const findings = resolve(qualified).surfaces!.check.findings.filter(row => native.has(row.subject) && row.code === "S8" && row.severity === "error");
  if (findings.length) throw new Error(`Native surface qualification refused: ${JSON.stringify(findings)}`);
  return qualified;
}
