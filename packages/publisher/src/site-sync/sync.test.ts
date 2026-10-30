import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createSiteSyncPlan, siteSyncHash, siteSyncSubmitEndpoint } from "./plan.js";
import { generatedText, type AppLocalEmission } from "./emitter.js";
import { applySiteSyncPlan } from "./sync.js";
import { runSiteSyncCli } from "./cli.js";
import type { SiteSyncOptions } from "./contract.js";
import type { ContentMap } from "../content-map/contract.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function put(path: string, source: string) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, source); }
async function snapshot(root: string): Promise<Record<string, { hash: string; mtime: number }>> {
  const output: Record<string, { hash: string; mtime: number }> = {};
  async function walk(prefix: string) {
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path);
      else output[path] = { hash: siteSyncHash(await readFile(join(root, path), "utf8")), mtime: (await stat(join(root, path))).mtimeMs };
    }
  }
  await walk(""); return output;
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "publisher-site-sync-")); roots.push(root);
  const appDir = join(root, "apps/site"), outDir = join(appDir, "src/clossys");
  await put(join(appDir, "package.json"), JSON.stringify({ name: "example-co-site", dependencies: { react: "19.3.0" } }));
  const map: ContentMap = { version: 1, publicationId: "example", format: "web.page.responsive", entries: [
    { id: "home", kind: "page", order: 0, title: "Example Co.", path: "/", source: { planItemId: "home" } },
    { id: "preview", kind: "page", order: 1, title: "Preview", path: "/preview", indexing: { mode: "noindex" }, source: { planItemId: "preview" } },
    { id: "external", kind: "external", order: 2, title: "External", path: "/external", href: "https://other.example.test" },
  ] };
  const files: Record<string, string> = {
    "routes.ts": generatedText(`export const publication = ${JSON.stringify(map)} as const;\nexport const routes = publication.entries;\n`),
    "theme.css": generatedText(":root {}\n"),
    "site/app/page.tsx": generatedText('const route: ContentRouteRegistration = {"path":"/"};\nexport default function Page() { return null; }\n'),
    "site/app/preview/page.tsx": generatedText('const route: ContentRouteRegistration = {"path":"/preview"};\nexport default function Preview() { return null; }\n'),
    "components/_consumer/src/hosts.tsx": generatedText('export function Frame({children}) { return children; }\nexport function Consent({children}) { return children; }\nexport function NotFound() { return null; }\n'),
    "dependencies.json": generatedText('{"react":"19.3.0"}\n'),
  };
  files[".manifest.json"] = generatedText(JSON.stringify(Object.fromEntries(Object.entries(files).map(([path, source]) => [path, siteSyncHash(source)]))));
  const emission: AppLocalEmission = { appDir, outDir, files, dependencies: { react: "19.3.0" } };
  const hostFile = "components/_consumer/src/hosts.tsx";
  const options: SiteSyncOptions = { root, target: { app: "apps/site", publication: "example", format: "web.page.responsive" }, origin: "https://example.test", crawl: "allow", host: {
    locale: "en", frame: { file: hostFile, export: "Frame" }, consent: { file: hostFile, export: "Consent" }, notFound: { file: hostFile, export: "NotFound" },
    security: { contact: "https://example.test/contact", expires: "2027-10-29T00:00:00Z" }, formSubmit: "/api/contact",
  } };
  return { root, appDir, emission, options, plan: createSiteSyncPlan(options, emission) };
}
it("writes the complete route plan, checks read-only, and reports hand edits as exit 1", async () => {
  const { root, appDir, plan, options } = await fixture();
  const execute = (value: SiteSyncOptions) => applySiteSyncPlan(plan, value.check);
  const load = async (_root: string, check: boolean) => ({ ...options, check });
  const write = await runSiteSyncCli(["--root", root], load, execute);
  expect(write.exitCode).toBe(0);
  expect(write.files).toEqual(expect.arrayContaining(["app/page.tsx", "app/layout.tsx", "app/not-found.tsx", "app/robots.ts", "app/sitemap.ts", "app/.well-known/security.txt/route.ts", "redirects.generated.mjs"]));
  const before = await snapshot(root);
  expect((await runSiteSyncCli(["--root", root, "--check"], load, execute)).exitCode).toBe(0);
  expect(await snapshot(root)).toEqual(before);
  const page = join(appDir, "app/page.tsx");
  await writeFile(page, `${await readFile(page, "utf8")}// hand edit\n`);
  const edited = await snapshot(root);
  expect((await runSiteSyncCli(["--root", root, "--check"], load, execute)).exitCode).toBe(1);
  expect((await applySiteSyncPlan(plan)).findings).toContainEqual(expect.objectContaining({ kind: "hand-edit", path: "app/page.tsx" }));
  expect(await snapshot(root)).toEqual(edited);
});
it("does not create pages for external or noindex entries", async () => {
  const { plan } = await fixture();
  expect(plan.files["app/preview/page.tsx"]).toBeUndefined();
  expect(plan.files["app/external/page.tsx"]).toBeUndefined();
  expect(plan.emission.files["site/app/preview/page.tsx"]).toBeUndefined();
  expect(plan.files["app/sitemap.ts"]).not.toContain("/preview");
  expect(plan.files["redirects.generated.mjs"]).toContain("https://other.example.test");
});
it("refuses off-origin submit destinations before writing and binds browser fetch to same-origin", async () => {
  const { options, emission, plan } = await fixture();
  for (const formSubmit of ["https://other.example.test/send", "//other.example.test/send", "javascript:alert(1)", "https://example.test@other.example.test/send"]) {
    expect(() => createSiteSyncPlan({ ...options, host: { ...options.host, formSubmit } }, emission)).toThrow(/same-origin/);
  }
  expect(siteSyncSubmitEndpoint("https://example.test/api/contact", options.origin)).toBe("/api/contact");
  expect(plan.emission.files["site-sync/form-submit.ts"]).toContain('mode: "same-origin", redirect: "error"');
});
it("refuses source traversal, missing hosts, route collisions and authored-route overwrite", async () => {
  const { options, emission, appDir, plan } = await fixture();
  expect(() => createSiteSyncPlan({ ...options, host: { ...options.host, frame: { file: "../escape", export: "Frame" } } }, emission)).toThrow();
  expect(() => createSiteSyncPlan({ ...options, host: { ...options.host, frame: { file: "missing.tsx", export: "Frame" } } }, emission)).toThrow(/absent/);
  await put(join(appDir, "app/page.tsx"), "export default function Authored() {}\n");
  expect((await applySiteSyncPlan(plan)).exitCode).toBe(1);
  await expect(readFile(join(appDir, "app/layout.tsx"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("returns 2 for missing or unknown CLI arguments and invalid configuration", async () => {
  for (const argv of [[], ["--root"], ["--root", ".", "--unknown"], ["--root", ".", "--check", "--check"]]) expect((await runSiteSyncCli(argv)).exitCode).toBe(2);
  expect((await runSiteSyncCli(["--root", "."], async () => { throw new TypeError("Missing host authority"); })).exitCode).toBe(2);
});
