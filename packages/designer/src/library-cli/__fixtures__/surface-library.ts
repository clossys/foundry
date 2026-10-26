/** Actual local compiler/loader for explicitly SYNTHETIC isolated source. No real component observation. */
import * as fs from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { applyLibraryChange, libraryHash, resolve, emit } from "../../catalog-core/api.js";
import { syntheticSurface } from "../../catalog-core/__fixtures__/surface-engine/synthetic.js";
import { surfaceOf } from "../../catalog-core/surface-library.js";
import { surfaceRuntimeIdentity } from "../../catalog-core/surface-check.js";
import { runtimeHash } from "../../catalog-core/runtime-ports.js";
import { sha256 } from "../../catalog-core/digest.js";
import { libraryFiles, readLibrary } from "../fs-library.js";
import type { CompositeEngineInput } from "../../catalog-core/types.js";
import type { SurfaceMeasurement, SurfaceCommandReceipt } from "../../catalog-core/surface-types.js";
import type { RuntimeSourceClosure, RuntimeRendererDescriptor } from "../../catalog-core/runtime-ports.js";
const execute = promisify(execFile);
const require = createRequire(import.meta.url);
export async function saveSurfaceLibrary(root: string, input: CompositeEngineInput): Promise<void> {
    await fs.mkdir(join(root, "fills"), { recursive: true });
    for (const [path, content] of libraryFiles(input.catalog, input.library, [], input.componentOptions, input.surfaceOptions)) {
        await fs.mkdir(dirname(join(root, path)), { recursive: true });
        await fs.writeFile(join(root, path), content);
    }
}
export function syntheticSurfacePair(): CompositeEngineInput {
    const section = syntheticSurface({ secondary: true }), frame = syntheticSurface({ layer: "frames", leaf: "synthetic-shell" });
    const input = section.input;
    for (const key of ["slots", "fills", "transforms", "materializations"] as const)
        input.catalog.surfaces![key] = [...input.catalog.surfaces![key], ...frame.input.catalog.surfaces![key]] as never;
    input.library = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [
            { portion: "values", change: { op: "author", slot: "tokens.breakpoint", tokens: Object.fromEntries(["mobile", "mobile-lg", "tablet", "tablet-lg", "desktop", "wide"].map((name, index) => [name, { $type: "dimension", $value: { value: 400 + index * 200, unit: "px" } }])) } },
            ...[section, frame].map(f => ({ portion: "surfaces" as const, change: { op: "adopt" as const, slot: f.bundle.slot, source: "synthetic" } })),
        ], surfaceBundles: [section.bundle, frame.bundle] }, { componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions! });
    return input;
}
export async function compileSurfaceLibrary(root: string, input: CompositeEngineInput) {
    // The only source snapshot entering the compiler is the existing disk reader's result.
    input.library = await readLibrary(root, input.catalog);
    const compilerPath = require.resolve("typescript/lib/tsc.js"), compilerRoot = dirname(compilerPath);
    const executableFiles = await Promise.all(["tsc.js", "_tsc.js"].map(async (path) => ({ path, content: await fs.readFile(join(compilerRoot, path), "utf8") })));
    const compilerVersion = JSON.parse(await fs.readFile(require.resolve("typescript/package.json"), "utf8")).version as string;
    const harness = await fs.readFile(fileURLToPath(import.meta.url), "utf8");
    const initialProfile = resolve(input);
    const records = Object.values(initialProfile.surfaces!.fills);
    const sourceFiles = input.library.surfaces!.files.filter(file => /\.tsx?$/.test(file.path));
    const compile = async (files: readonly string[], name: string) => {
        const outDir = join(root, `compiled-${name}`), config = join(root, `synthetic-${name}.json`);
        await fs.writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }));
        const configText = JSON.stringify({ compilerOptions: { strict: true, module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022", types: [], skipLibCheck: true, rootDir: root, outDir }, files });
        await fs.writeFile(config, configText);
        const argv = [process.execPath, compilerPath, "--project", config];
        const result = await execute(argv[0]!, argv.slice(1), { cwd: root });
        const command: SurfaceCommandReceipt = { argv, exitCode: 0, stdoutSha256: sha256(result.stdout), stderrSha256: sha256(result.stderr) };
        const listArgv = [...argv, "--listFilesOnly"], listed = await execute(listArgv[0]!, listArgv.slice(1), { cwd: root });
        const declarations = await Promise.all(listed.stdout.trim().split(/\r?\n/).filter(path => path.endsWith(".d.ts")).map(async (path) => { if (!path.startsWith(compilerRoot + "/"))
            throw new Error("Unexpected compiler declaration input"); return { path: relative(compilerRoot, path), content: await fs.readFile(path, "utf8") }; }));
        const toolInputs = [...executableFiles, ...declarations].map(file => ({ path: file.path, sha256: sha256(file.content), bytes: Buffer.byteLength(file.content) }));
        const toolManifest = { scope: "SYNTHETIC exact invocation; Node builtins, optional compile cache and general dynamic tool closure unqualified", node: { version: process.version, executable: process.execPath }, version: compilerVersion, entry: "tsc.js", inputs: toolInputs, config: { name: relative(root, config), sha256: sha256(configText) }, listCommand: { argv: listArgv, exitCode: 0, stdoutSha256: sha256(listed.stdout), stderrSha256: sha256(listed.stderr) } };
        const manifestText = JSON.stringify(toolManifest);
        const compilerSource: RuntimeSourceClosure = { entry: "surface-library.ts", files: { "surface-library.ts": harness, "invocation-manifest.json": manifestText, [relative(root, config)]: configText }, dependencies: { typescript: { version: compilerVersion, artifact: `sha256:${sha256(JSON.stringify(toolInputs))}` } } };
        const compiler: RuntimeRendererDescriptor = { id: "SYNTHETIC:installed-tsc-cli", source: compilerSource, sourceHash: runtimeHash(compilerSource) };
        if (process.env.C1_SURFACE_EVIDENCE_DIR) {
            const snapshotRoot = join(process.env.C1_SURFACE_EVIDENCE_DIR, "compiler-inputs");
            await fs.mkdir(snapshotRoot, { recursive: true });
            for (const file of [...executableFiles, ...declarations])
                await fs.writeFile(join(snapshotRoot, file.path), file.content);
            await fs.writeFile(join(snapshotRoot, `synthetic-${name}.json`), configText);
        }
        const outputs: Record<string, string> = {};
        const walk = async (path: string): Promise<void> => {
            for (const file of await fs.readdir(path, { withFileTypes: true })) {
                const full = join(path, file.name);
                if (file.isDirectory())
                    await walk(full);
                else if (file.name.endsWith(".js"))
                    outputs[relative(outDir, full)] = await fs.readFile(full, "utf8");
            }
        };
        await walk(outDir);
        return { outDir, outputs, command, compiler, toolManifest };
    };
    const initial = await compile(sourceFiles.map(file => join(root, file.path)), "source");
    const measurement = (row: typeof records[number], compiled: RuntimeSourceClosure, compilation: typeof initial): SurfaceMeasurement => {
        const fill = surfaceOf(row.document), owned = new Set(fill.outputSha256.map(file => file.path));
        return { version: 1, slot: fill.slot, scope: "synthetic", identity: surfaceRuntimeIdentity(row), source: { entry: fill.impl.entry, files: Object.fromEntries(sourceFiles.filter(file => owned.has(file.path)).map(file => [file.path, file.content])), dependencies: {} }, compiled, compiler: compilation.compiler, command: compilation.command, checks: { types: "pass", closure: "pass" }, runtime: null };
    };
    input.surfaceOptions = { packages: [], measurements: records.map(row => measurement(row, { entry: surfaceOf(row.document).impl.entry.replace(/\.ts$/, ".js"), files: initial.outputs, dependencies: {} }, initial)) };
    const measuredProfile = resolve(input);
    if (!measuredProfile.check.ok)
        throw new Error(JSON.stringify(measuredProfile.check.findings));
    const emitted = emit(measuredProfile, ["surface-index"]);
    for (const file of emitted) {
        await fs.mkdir(dirname(join(root, file.path)), { recursive: true });
        await fs.writeFile(join(root, file.path), file.contents);
    }
    const final = await compile(emitted.filter(file => /\.tsx?$/.test(file.path)).map(file => join(root, file.path)), "facades");
    const compiled: RuntimeSourceClosure = { entry: "surface-index.js", files: final.outputs, dependencies: {} };
    const script = 'const m=await import(process.argv[1]);const leaf=await import(new URL("./sections/synthetic/index.js",process.argv[1]));console.log(JSON.stringify({primary:m.Synthetic(),frame:m.SyntheticShell(),secondary:leaf.SyntheticCaption(),samePrimary:leaf.Synthetic===m.Synthetic,root:Object.keys(m).sort()}));';
    const runtimeArgv = [process.execPath, "--input-type=module", "-e", script, pathToFileURL(join(final.outDir, compiled.entry)).href];
    const runtimeResult = await execute(runtimeArgv[0]!, runtimeArgv.slice(1), { cwd: root });
    const runtimeCommand: SurfaceCommandReceipt = { argv: runtimeArgv, exitCode: 0, stdoutSha256: sha256(runtimeResult.stdout), stderrSha256: sha256(runtimeResult.stderr) };
    const observed = JSON.parse(runtimeResult.stdout) as {
        primary: string;
        frame: string;
        secondary: string;
        samePrimary: boolean;
        root: string[];
    };
    const measurements = records.map(row => { const m = measurement(row, compiled, final); const renderer = { id: `SYNTHETIC:${m.slot}`, source: compiled, sourceHash: runtimeHash(compiled) }; return { ...m, runtime: { renderer, command: runtimeCommand, checks: { module: "pass" as const } } }; });
    input.surfaceOptions = { packages: [], measurements };
    // Native module import loads exactly the independently executed, hashed compiler output.
    const module = await import(/* @vite-ignore */ pathToFileURL(join(final.outDir, compiled.entry)).href) as Record<string, () => string>;
    if (process.env.C1_SURFACE_EVIDENCE_DIR) {
        const evidence = process.env.C1_SURFACE_EVIDENCE_DIR;
        await fs.mkdir(evidence, { recursive: true });
        await fs.writeFile(join(evidence, "synthetic-measurements.json"), JSON.stringify({ scope: "SYNTHETIC", libraryHash: libraryHash(input.library), measurements, observed, compilerVersion, sourceCompile: initial.command, compilerInvocations: { source: initial.toolManifest, facades: final.toolManifest } }, null, 2));
    }
    return { input, measurements, module, observed, compiled, emitted };
}
