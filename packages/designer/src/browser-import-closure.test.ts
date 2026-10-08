// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { describe, expect, it } from "vitest";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
// Discover public component/data barrels, including the pure tokens entry.
// Explicit */server entries are Node tooling, outside this browser surface.
const entries = Object.values(manifest.exports as Record<string, { import?: string }>)
  .map((entry) => entry?.import?.match(/^\.\/dist\/([^/]+)\/index\.js$/)?.[1])
  .filter((domain): domain is string => Boolean(domain))
  .map((domain) => join(packageDir, "src", domain, "index.ts"));
const peers = Object.keys(manifest.peerDependencies as Record<string, string>);

async function bundle(entryPoints: string[], plugins: Plugin[] = []) {
  return build({
    entryPoints,
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    outdir: "unused",
    write: false,
    logLevel: "silent",
    // Only declared peers may remain external. In particular, Node builtins
    // must be resolved so a Node-only transitive import makes this test fail.
    external: peers.flatMap((peer) => [peer, `${peer}/*`]),
    plugins,
  });
}

describe("client entry import closure", () => {
  it("discovers public component barrels and bundles them for a browser", async () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toContain(join(packageDir, "src", "tokens", "index.ts"));
    await expect(bundle(entries)).resolves.toBeDefined();
  });

  it("rejects a reachable Node builtin added to the public tokens entry", async () => {
    const nodeImport: Plugin = {
      name: "token-node-import-regression",
      setup(builder) {
        builder.onLoad({ filter: /[/\\]tokens[/\\]index\.ts$/ }, ({ path }) => ({
          contents: readFileSync(path, "utf8") + '\nexport { readFileSync as readNodeFile } from "node:fs";\n',
          loader: "ts",
        }));
      },
    };
    await expect(bundle([join(packageDir, "src", "tokens", "index.ts")], [nodeImport]))
      .rejects.toThrow(/node:fs/);
  });
});
