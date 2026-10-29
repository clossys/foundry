import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = ["designer", "writer", "publisher"];
const runtimeDependencies = ["strategist", "controller"];

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, { cwd, stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"], encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed`);
  return result.stdout;
}

export function assertFixtureExcluded(pack) {
  assert.ok(Array.isArray(pack.files) && pack.files.length > 0, "npm pack must list its contents");
  assert.ok(!pack.files.some(file => /(^|\/)test-fixtures(\/|$)/.test(file.path)), "consumer fixtures must not ship in a package");
}

export async function probeMarketing(origin, entries) {
  const results = [];
  for (const entry of [...entries, { path: "/missing-reference-page", status: 404 }]) {
    const response = await fetch(new URL(entry.path, origin), { redirect: "manual" });
    assert.equal(response.status, entry.status ?? 200, entry.path);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
    const html = await response.text();
    assert.equal((html.match(/<h1(?:\s|>)/gi) ?? []).length, 1, `${entry.path} must have exactly one h1`);
    if (entry.title) assert.ok(html.includes(entry.title), `${entry.path} must contain its page title`);
    results.push({ path: entry.path, status: response.status, h1: 1 });
  }
  const redirect = await fetch(new URL("/welcome", origin), { redirect: "manual" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), "/");
  results.push({ path: "/welcome", status: redirect.status });
  for (const [path, type, content] of [
    ["/robots.txt", /^text\/plain/, "Sitemap: https://example.com/sitemap.xml"],
    ["/sitemap.xml", /^application\/xml/, "<loc>https://example.com/</loc>"],
    ["/.well-known/security.txt", /^text\/plain/, "Contact: mailto:security@example.com"],
    ["/site.css", /^text\/css/, "--"],
  ]) {
    const response = await fetch(new URL(path, origin), { redirect: "manual" });
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") ?? "", type);
    assert.ok((await response.text()).includes(content), `${path} must contain its projected output`);
    results.push({ path, status: response.status });
  }
  return results;
}

export async function rehearseMarketing() {
  const temporary = await mkdtemp(join(tmpdir(), "marketing-reference-"));
  let server;
  try {
    const fixture = join(temporary, "consumer");
    await cp(join(repository, "packages/publisher/test-fixtures/marketing-reference"), fixture, { recursive: true });
    const manifest = JSON.parse(await readFile(join(fixture, "package.json"), "utf8"));
    for (const name of [...runtimeDependencies, ...packages]) {
      const [pack] = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], join(repository, "packages", name), true));
      assertFixtureExcluded(pack);
      assert.ok(pack.files.some(file => file.path.startsWith("dist/")), `${name} must be built before packing`);
      manifest.dependencies[pack.name] = `file:${join(temporary, pack.filename)}`;
    }
    await writeFile(join(fixture, "package.json"), JSON.stringify(manifest, null, 2));
    run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"], fixture);
    run("npm", ["run", "build"], fixture);
    const { serve } = await import(pathToFileURL(join(fixture, "serve.mjs")).href);
    server = await serve();
    const publication = JSON.parse(await readFile(join(fixture, "publication.json"), "utf8"));
    const results = await probeMarketing(`http://127.0.0.1:${server.address().port}`, publication.entries);
    console.log(JSON.stringify({ installedTarballs: packages, runtimeTarballs: runtimeDependencies, fixtureExcluded: true, routes: results }, null, 2));
    return results;
  } finally {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await rehearseMarketing();
