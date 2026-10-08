// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryDir = dirname(dirname(packageDir));
const bundlers = ["webpack", "turbopack"] as const;

function clientPage(nodeMutation = false): string {
  return `"use client";
import { Button } from "@clossys/designer/atoms";
import { contrastRatio, parseBrandDeclarations${nodeMutation ? ", readNodeFile" : ""} } from "@clossys/designer/tokens";
const parsed = parseBrandDeclarations(":root { --example: #000000; }");
export default function Page() {
  return <Button${nodeMutation ? ' onPress={() => readNodeFile("unused.css", "utf8")}' : ""}>{contrastRatio(parsed.declarations["--example"], "#ffffff")}</Button>;
}
`;
}

function withPackedFixture(run: (fixture: string, candidate: string, next: string) => void): void {
  // Turbopack requires borrowed dependency symlinks to stay within its root.
  // This disposable fixture and the real dependencies share the repository root.
  const temporary = mkdtempSync(join(repositoryDir, ".designer-browser-fixture-"));
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
    const candidate = join(fixture, "node_modules", "@clossys", "designer");
    mkdirSync(candidate, { recursive: true });
    execFileSync("tar", ["-xzf", join(temporary, packed[0]!.filename), "--strip-components=1", "-C", candidate]);

    // Borrow installed dependencies, never the workspace candidate link.
    const dependenciesDir = join(repositoryDir, "node_modules");
    for (const name of readdirSync(dependenciesDir)) {
      if (name.startsWith(".") || name === "@clossys") continue;
      symlinkSync(join(dependenciesDir, name), join(fixture, "node_modules", name), "dir");
    }
    const next = join(dependenciesDir, "next", "dist", "bin", "next");
    expect(existsSync(next), "the installed Next fixture dependency is required").toBe(true);
    mkdirSync(join(fixture, "app"));
    writeFileSync(join(fixture, "package.json"), JSON.stringify({ private: true, type: "module" }));
    writeFileSync(join(fixture, "next.config.mjs"), `export default { experimental: { cpus: 1 }, turbopack: { root: ${JSON.stringify(repositoryDir)} } };\n`);
    writeFileSync(join(fixture, "app", "layout.jsx"), "export default function Layout({children}) { return <html><body>{children}</body></html>; }\n");
    writeFileSync(join(fixture, "app", "page.jsx"), clientPage());
    expect(JSON.parse(readFileSync(join(candidate, "package.json"), "utf8")).name).toBe("@clossys/designer");
    run(fixture, candidate, next);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function buildFixture(fixture: string, next: string, bundler: typeof bundlers[number]): void {
  rmSync(join(fixture, ".next"), { recursive: true, force: true });
  execFileSync(process.execPath, [next, "build", `--${bundler}`], {
    cwd: fixture,
    timeout: 120_000,
    stdio: "pipe",
    env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir(), LC_ALL: "C", CI: "1", NEXT_TELEMETRY_DISABLED: "1" },
  });
  expect(existsSync(join(fixture, ".next", "BUILD_ID"))).toBe(true);
}

it("exercises the packed public Node reader and opt-in peer check", () => {
  withPackedFixture((fixture) => {
    writeFileSync(join(fixture, "brand.css"), ":root { --color-accent: #222222; }");
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { readBrandCss, assertTailwindMergeVersion } from "@clossys/designer/tokens/server";
      assertTailwindMergeVersion();
      process.stdout.write(JSON.stringify({ read: readBrandCss("brand.css"), missing: readBrandCss("missing.css") }));
    `], { cwd: fixture, encoding: "utf8", timeout: 10_000 });
    const { read, missing } = JSON.parse(output);
    expect(read).toMatchObject({ complete: true, declarations: { "--color-accent": "#222222" }, unchecked: [], issues: [] });
    expect(missing).toMatchObject({ complete: false, declarations: {}, unchecked: [], issues: [{ reason: "unreadable", detail: expect.any(String) }] });
  });
}, 20_000);

for (const bundler of bundlers) {
  it(`builds packed public tokens and a client Button with Next ${bundler}`, () => {
    withPackedFixture((fixture, _candidate, next) => buildFixture(fixture, next, bundler));
  }, 150_000);

  it(`rejects a consumed packed node:fs export with ${bundler}, then builds the exact restored entry`, () => {
    withPackedFixture((fixture, candidate, next) => {
      const entry = join(candidate, "dist", "tokens", "index.js");
      const original = readFileSync(entry);
      writeFileSync(entry, Buffer.concat([original, Buffer.from('\nexport { readFileSync as readNodeFile } from "node:fs";\n')]));
      writeFileSync(join(fixture, "app", "page.jsx"), clientPage(true));
      let failure: { stdout?: Buffer; stderr?: Buffer } | undefined;
      try {
        buildFixture(fixture, next, bundler);
      } catch (error) {
        failure = error as typeof failure;
      } finally {
        writeFileSync(entry, original);
        writeFileSync(join(fixture, "app", "page.jsx"), clientPage());
      }
      expect(failure, "a consumed Node export must fail the real browser build").toBeDefined();
      expect(`${failure?.stdout ?? ""}\n${failure?.stderr ?? ""}`).toMatch(/node:fs/);
      expect(readFileSync(entry)).toEqual(original);
      buildFixture(fixture, next, bundler);
    });
  }, 300_000);
}

it("typechecks the preserved pure API and deliberate Node migration against packed public declarations", () => {
  withPackedFixture((fixture) => {
    const contract = readFileSync(join(packageDir, "src", "tokens", "public-contract.check.ts"), "utf8")
      .replaceAll('"./index.js"', '"@clossys/designer/tokens"')
      .replaceAll('"./server.js"', '"@clossys/designer/tokens/server"');
    writeFileSync(join(fixture, "public-contract.check.ts"), contract);
    execFileSync(process.execPath, [join(repositoryDir, "node_modules", "typescript", "bin", "tsc"), "--noEmit", "--strict", "--skipLibCheck", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "public-contract.check.ts"], { cwd: fixture, stdio: "pipe", timeout: 30_000 });
  });
}, 40_000);
