/** @vitest-environment node */
import * as fs from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { emitRegisteredRouteAdapter, emitRegisteredRoutePage, emitRegisteredRouteRegistryModule } from "../web/registered-route-source.js";
import { syntheticRoute } from "./__fixtures__/registered-route.js";
import type { RouteRegistration } from "./route-registry.js";

/** A generated consumer uses the real public declaration graph, including recursive
 * DtcgValue/DtcgNode and runtime source descriptors. No reduced library stand-in. */
it("tsc accepts generated consumer loader data containing real CompositeLibraryData and runtime manifest types", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "SYNTHETIC-complex-loader-types-"));
  const modules = resolve(import.meta.dirname, "../../../..", "node_modules");
  const write = async (file: string, content: string) => { await fs.mkdir(dirname(join(root, file)), { recursive: true }); await fs.writeFile(join(root, file), content); };
  try {
    await fs.symlink(modules, join(root, "node_modules"), "dir");
    const base = syntheticRoute();
    const route: RouteRegistration = { ...base, entry: { file: "src/app/tools/tools/page.tsx", export: "default" }, composition: { ...base.composition, source: { file: "src/publisher/generated/example.tools.tsx", export: "default" }, runtime: { file: "src/publisher/runtime/routes.ts", export: "useRuntime" }, loader: { file: "src/publisher/server/tools.ts", export: "loadTools" } } };
    const registry = { version: 1 as const, consumer: "example", routes: [route] };
    await write("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx", strict: true, skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true, types: ["node"] }, include: ["src"] }));
    await write("src/publisher/payload.ts", 'import type { CompositeLibraryData, ConsumerRuntimeManifest } from "@clossys/designer/catalog";\nexport interface Payload { readonly library: CompositeLibraryData; readonly manifest: ConsumerRuntimeManifest }\n');
    await write("src/publisher/routes.ts", emitRegisteredRouteRegistryModule(registry));
    await write(route.entry.file, emitRegisteredRouteAdapter(route));
    await write(route.composition.source.file, emitRegisteredRoutePage("src/publisher/routes.ts", route));
    await write("src/publisher/server/tools.ts", 'import type { Payload } from "../payload.ts";\ndeclare function actualLoader(): Promise<Payload>;\nexport async function loadTools() { return actualLoader(); }\n');
    await write("src/publisher/runtime/routes.ts", 'import type { Payload } from "../payload.ts";\nimport type { RegisteredRouteRuntime } from "@clossys/publisher/web/registered-route";\nexport function useRuntime(_route: unknown, data: Payload): RegisteredRouteRuntime { const library: Payload["library"] = data.library; const manifest: Payload["manifest"] = data.manifest; throw new Error(String(library.source.id) + manifest.consumer); }\n');
    const tsc = () => spawnSync(process.execPath, [join(modules, "typescript/bin/tsc"), "--project", join(root, "tsconfig.json"), "--pretty", "false"], { cwd: root, encoding: "utf8" });
    const accepted = tsc();
    expect(accepted.status, accepted.stdout + accepted.stderr).toBe(0);
    // Exact-cycle handling must not skip newly added optional function fields.
    await write("src/invalid.ts", `import { registeredRouteServerData } from "@clossys/publisher/core";
interface SafeNode { readonly next: WithCallback | null }
interface WithCallback extends SafeNode { readonly run?: () => void }
interface RecursiveCallback { readonly next: RecursiveCallback | null; readonly run: () => void }
declare const optional: SafeNode;
declare const recursive: RecursiveCallback;
registeredRouteServerData(optional);
registeredRouteServerData(recursive);
registeredRouteServerData({ run: () => 1 });
registeredRouteServerData({ at: new Date(0) });
registeredRouteServerData({ key: Symbol("SYNTHETIC") });
`);
    const rejected = tsc();
    expect(rejected.status, rejected.stdout + rejected.stderr).toBe(2);
    expect(rejected.stdout).not.toContain("TS2589");
    expect(rejected.stdout.match(/TS2554/g), rejected.stdout).toHaveLength(5);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 60000);
