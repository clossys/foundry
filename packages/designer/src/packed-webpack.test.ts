// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryDir = dirname(dirname(packageDir));

it("builds a packed client Button with Next's webpack bundler without installing", () => {
  const temporary = mkdtempSync(join(tmpdir(), "designer-webpack-"));
  const fixture = join(temporary, "consumer");
  try {
    writeFileSync(join(temporary, "npm-user.conf"), "");
    writeFileSync(join(temporary, "npm-global.conf"), "");
    const packed = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], {
      cwd: packageDir,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        TMPDIR: tmpdir(),
        npm_config_userconfig: join(temporary, "npm-user.conf"),
        npm_config_globalconfig: join(temporary, "npm-global.conf"),
        npm_config_cache: join(temporary, "npm-cache"),
      },
    })) as Array<{ filename: string }>;
    expect(packed).toHaveLength(1);
    const candidateDir = join(fixture, "node_modules", "@clossys", "designer");
    mkdirSync(candidateDir, { recursive: true });
    execFileSync("tar", ["-xzf", join(temporary, packed[0]!.filename), "--strip-components=1", "-C", candidateDir]);

    // Borrow installed dependencies, but never replace the packed candidate
    // with the workspace link and never run an install or lifecycle script.
    const dependenciesDir = join(repositoryDir, "node_modules");
    for (const name of readdirSync(dependenciesDir)) {
      if (name.startsWith(".") || name === "@clossys") continue;
      symlinkSync(join(dependenciesDir, name), join(fixture, "node_modules", name), "dir");
    }
    const next = join(dependenciesDir, "next", "dist", "bin", "next");
    expect(existsSync(next), "the repository's installed Next fixture dependency is required").toBe(true);
    mkdirSync(join(fixture, "app"));
    writeFileSync(join(fixture, "package.json"), JSON.stringify({ private: true, type: "module" }));
    writeFileSync(join(fixture, "next.config.mjs"), "export default { experimental: { cpus: 1 } };\n");
    writeFileSync(join(fixture, "app", "layout.jsx"), "export default function Layout({children}) { return <html><body>{children}</body></html>; }\n");
    writeFileSync(join(fixture, "app", "page.jsx"), '"use client";\nimport { Button } from "@clossys/designer/atoms";\nexport default function Page() { return <Button>Example</Button>; }\n');
    execFileSync(process.execPath, [next, "build", "--webpack"], {
      cwd: fixture,
      timeout: 120_000,
      stdio: "pipe",
      env: {
        PATH: process.env.PATH ?? "",
        TMPDIR: tmpdir(),
        LC_ALL: "C",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    });
    expect(existsSync(join(fixture, ".next", "BUILD_ID"))).toBe(true);
    const packedManifest = JSON.parse(readFileSync(join(candidateDir, "package.json"), "utf8"));
    expect(packedManifest.name).toBe("@clossys/designer");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}, 150_000);
