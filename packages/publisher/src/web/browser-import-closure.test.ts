import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
// npm is the genuine CLI paired with the running Node, not a PATH shim.
const nativeNpm = resolve(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js");
const digest = (bytes: Buffer) => "sha512-" + createHash("sha512").update(bytes).digest("base64");

it("bundles real installed packed client/views and rejects an actual Writer-root import", async () => {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), "publisher-browser-packed-")));
  const home = join(fixture, "home"), packs = join(fixture, "packs"), consumer = join(fixture, "consumer");
  for (const path of [home, packs, consumer]) mkdirSync(path);
  const userconfig = join(fixture, "user.npmrc"), globalconfig = join(fixture, "global.npmrc");
  writeFileSync(userconfig, ""); writeFileSync(globalconfig, "");
  const env = {
    PATH: process.env.PATH!, HOME: home, TMPDIR: fixture,
    NPM_CONFIG_USERCONFIG: userconfig, NPM_CONFIG_GLOBALCONFIG: globalconfig,
    NPM_CONFIG_CACHE: join(fixture, "cache"), NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
  };
  const npm = (args: string[], cwd: string) => execFileSync(process.execPath, [nativeNpm, ...args], { cwd, env, encoding: "utf8", timeout: 180_000, stdio: ["ignore", "pipe", "pipe"] });
  try {
    const receipts: { name: string; version: string; integrity: string; installedManifestSha256?: string; realpathJoined?: boolean }[] = [];
    const archives = [];
    for (const name of ["designer", "writer", "publisher"]) {
      const packageDir = join(root, "packages", name);
      const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
      const result = JSON.parse(npm(["pack", "--ignore-scripts", "--json", "--pack-destination", packs], packageDir))[0];
      const archive = join(packs, result.filename); archives.push(archive);
      expect(digest(readFileSync(archive))).toBe(result.integrity);
      receipts.push({ name: manifest.name, version: manifest.version, integrity: result.integrity });
    }
    writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "packed-browser-consumer", version: "1.0.0", private: true, type: "module" }));
    const publisher = JSON.parse(readFileSync(join(root, "packages/publisher/package.json"), "utf8"));
    const peers = Object.keys(publisher.peerDependencies) as string[];
    const peerSpecs = peers.map(name => `${name}@${publisher.peerDependencies[name]}`);
    npm(["install", "--ignore-scripts", "--no-audit", "--no-fund", ...archives, ...peerSpecs], consumer);
    for (const receipt of receipts) {
      const installed = join(consumer, "node_modules", receipt.name);
      const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
      expect(manifest.name).toBe(receipt.name); expect(manifest.version).toBe(receipt.version);
      expect(realpathSync(installed)).toBe(installed);
      receipt.realpathJoined = true; receipt.installedManifestSha256 = createHash("sha256").update(readFileSync(join(installed, "package.json"))).digest("hex");
      const lock = JSON.parse(readFileSync(join(consumer, "package-lock.json"), "utf8"));
      expect(lock.packages[`node_modules/${receipt.name}`].integrity).toBe(receipt.integrity);
    }
    const external = peers.flatMap(name => [name, `${name}/*`]);
    expect(external.some(name => name.startsWith("@clossys/"))).toBe(false);
    const bundle = async (source: string) => build({
      stdin: { contents: source, resolveDir: consumer, sourcefile: "client-entry.mjs" },
      bundle: true, absWorkingDir: consumer, platform: "browser", format: "esm",
      write: false, metafile: true, external, logLevel: "silent",
    });
    const full = 'export * from "@clossys/publisher/web/client";';
    const selected = 'export { SignInForm, ActivateForm, ResetForm, AuthView, BoundaryView } from "@clossys/publisher/web/client";';
    for (const source of [full, selected]) {
      const result = await bundle(source);
      const inputs = Object.keys(result.metafile!.inputs);
      expect(inputs.length).toBeGreaterThan(0);
      const firstPartyInputs = inputs.filter(path => path.includes("node_modules/@clossys/"));
      expect(firstPartyInputs.length).toBeGreaterThan(0);
      for (const path of firstPartyInputs) {
        expect(path).toMatch(/node_modules\/@clossys\/(designer|writer|publisher)\//);
        expect(realpathSync(resolve(consumer, path))).toContain(consumer);
      }
      for (const output of Object.values(result.metafile!.outputs)) for (const imported of output.imports) {
        if (imported.external) expect(peers.some(peer => imported.path === peer || imported.path.startsWith(`${peer}/`))).toBe(true);
      }
      for (const name of ["designer", "writer", "publisher"]) expect(inputs.some(path => path.includes(`node_modules/@clossys/${name}/`))).toBe(true);
      expect(inputs.some(path => /writer\/dist\/(?:resolve|approval|schema|fingerprint)\.js$/.test(path))).toBe(false);
      const reachable = Object.values(result.metafile!.outputs).flatMap(output => Object.keys(output.inputs));
      for (const name of ["designer", "writer", "publisher"]) expect(reachable.some(path => path.includes(`node_modules/@clossys/${name}/`))).toBe(true);
    }
    const installedClient = join(consumer, "node_modules/@clossys/publisher/dist/web/client.js");
    const original = readFileSync(installedClient);
    expect(original.toString()).toContain('from "@clossys/writer/front-door"');
    let failure: unknown;
    try {
      writeFileSync(installedClient, original.toString().replace('from "@clossys/writer/front-door"', 'from "@clossys/writer"'));
      try { await bundle(full); } catch (error) { failure = error; }
      expect(failure).toBeDefined();
      expect((failure as { errors: { text: string }[] }).errors.some(error => /Could not resolve "node:/.test(error.text))).toBe(true);
    } finally { writeFileSync(installedClient, original); }
    expect(readFileSync(installedClient)).toEqual(original);
    await bundle(full);
    console.info("packed-browser-proof", JSON.stringify({ artifacts: receipts, writerRootMutant: "Node closure refused", restored: true }));

    // P-22: the consent assembly's browser closure reaches the client entry and
    // nothing of the preview, the Designer shell, Writer or copy resolution.
    const consentBundle = async (source: string, conditions?: string[]) => {
      const result = await build({
        stdin: { contents: source, resolveDir: consumer, sourcefile: "consent-entry.mjs" },
        bundle: true, absWorkingDir: consumer, platform: "browser", format: "esm",
        write: false, metafile: true, external, logLevel: "silent", ...(conditions ? { conditions } : {}),
      });
      return Object.keys(result.metafile!.inputs);
    };
    const consentInputs = await consentBundle('export * from "@clossys/publisher/web/consent";');
    expect(consentInputs.some(path => path.endsWith("node_modules/@clossys/publisher/dist/web/consent/ConsentExperience.client.js"))).toBe(true);
    expect(consentInputs.filter(path => /publisher\/dist\/web\/consent\/preview\//.test(path))).toEqual([]);
    expect(consentInputs.filter(path => /designer\/dist\/shell\//.test(path))).toEqual([]);
    expect(consentInputs.filter(path => /writer\/dist\//.test(path))).toEqual([]);
    expect(consentInputs.filter(path => /publisher\/dist\/consent-copy\//.test(path))).toEqual([]);
    const copyInputs = await consentBundle('import "@clossys/publisher/consent-copy";');
    expect(copyInputs.filter(path => path.includes("node_modules/@clossys/"))).toEqual([expect.stringMatching(/publisher\/dist\/consent-copy\/refuse-browser\.js$/)]);
    const previewDefault = await consentBundle('import "@clossys/publisher/web/consent/preview";');
    expect(previewDefault.filter(path => path.includes("node_modules/@clossys/"))).toEqual([expect.stringMatching(/publisher\/dist\/web\/consent\/preview\/refuse-non-development\.js$/)]);
    const previewDevelopment = await consentBundle('export * from "@clossys/publisher/web/consent/preview";', ["development"]);
    expect(previewDevelopment.some(path => path.endsWith("publisher/dist/web/consent/preview/index.js"))).toBe(true);
    expect(previewDevelopment.some(path => /refuse-/.test(path))).toBe(false);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
}, 240_000);
