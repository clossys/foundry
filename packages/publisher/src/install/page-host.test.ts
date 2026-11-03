/**
 * The Publisher page host, section instances and first-party dependencies, on public fixtures:
 * every emitted page mounts inside `PublisherHost` fed by the consumer's own component
 * selection module; one section slot mounts several times, each instance with its own copy;
 * the shadcn runner never sees an `@clossys/*` dependency the substrate already declares.
 */
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directoryRecordSource, recordStoreSource } from "../specimen/source.js";
import type { SpecimenRecordSource } from "../specimen/types.js";
import { designerSelectionModule, workspaceNodePaths } from "./__fixtures__/page-host.js";
import {
  bindPage, installAndBind, installPage, resolveNativeNextDraft, resolvePage,
  type InstallPageRecord, type InstallPins, type NativeNextDraftCandidate, type ShadcnRunner,
} from "./index.js";

const fixtures = join(import.meta.dirname, "__fixtures__");
const requireHere = createRequire(import.meta.url);
const temps: string[] = [];
let pins: InstallPins;
let server: Server, registryUrl: string;

/** One frame and three instances of one section slot: instance 1 takes the slot's shared copy, 2 and 3 their own. */
const page: InstallPageRecord = {
  id: "home", frame: "frames.plain", sections: ["sections.hero", "sections.hero", "sections.hero"],
  bindings: {
    "frames.plain": { copy: { "frame.title": "site.name" } },
    "sections.hero": { copy: { "hero.heading": "home.hero.heading", "hero.body": "home.hero.body" } },
    "sections.hero#2": { copy: { "hero.heading": "home.proof.heading", "hero.body": "home.proof.body" } },
    "sections.hero#3": { copy: { "hero.heading": "home.close.heading" } },
  },
};
const copy = {
  "site.name": "Example Studio",
  "home.hero.heading": "Pages assembled from records", "home.hero.body": "Every word here comes from a Writer key.",
  "home.proof.heading": "One slot, many instances", "home.proof.body": "Each instance binds its own Writer keys.",
  "home.close.heading": "Start from the selection",
};

/** A frame on Designer's SiteFrame: it mounts selected component leaves, so it renders only inside the host. */
const siteFrame = `import type { ReactNode } from "react";
import { SiteFrame } from "@clossys/designer/frames";
export function PlainFrame({ title, children }: { title: string; children?: ReactNode }) {
  const resolveCopy = (ref: { id: string }) => ({ ref, text: title, recordId: ref.id, revision: "1", locale: "en", source: { kind: "consumer" as const, reference: "fixture" }, entryId: ref.id });
  return <SiteFrame shell={{ brand: { assetId: "mark", label: { id: "brand" }, size: "md", variant: "mark" }, skipLink: { id: "skip" } }} resolveCopy={resolveCopy} resolveAsset={() => ({ type: "image", src: "/mark.svg", width: 48, height: 48, alt: title })}>{children}</SiteFrame>;
}
`;

async function temp(prefix = "page-host-", parent = tmpdir()) {
  const dir = await mkdtemp(join(parent, prefix));
  temps.push(dir);
  return dir;
}
/** The public fixture library with the frame rewritten onto Designer's SiteFrame. */
async function siteLibrary(): Promise<SpecimenRecordSource> {
  const root = join(await temp(), "library");
  await cp(join(fixtures, "library"), root, { recursive: true });
  const itemPath = join(root, "frames.plain/plain-frame/v1/plain-frame.json");
  const item = JSON.parse(await readFile(itemPath, "utf8"));
  item.files[0].content = siteFrame;
  await writeFile(itemPath, JSON.stringify(item));
  const records = directoryRecordSource({ roots: [root] });
  return recordStoreSource({
    async load(id, version) {
      const record = await records.read(id, version);
      return record ? { id: record.id, version: record.version, kind: record.kind, files: record.sources!, preview: record.preview, contentHash: record.contentHash } : undefined;
    },
  });
}
async function admissions(source: SpecimenRecordSource): Promise<Record<string, NativeNextDraftCandidate>> {
  return Object.fromEntries(await Promise.all(Object.entries(pins).map(async ([slot, pin]) => [slot, { ...pin, contentHash: (await source.read(`${slot}/${pin.element}`, pin.version))!.contentHash }])));
}
/** A runner standing in for `shadcn add <item.json>`: writes the item's files at their targets and records the item it saw. */
function fakeRunner(seen: unknown[] = []): ShadcnRunner {
  return async (args, { cwd }) => {
    const item = JSON.parse(await readFile(args[1]!, "utf8"));
    seen.push(item);
    for (const file of item.files) { await mkdir(dirname(join(cwd, file.target)), { recursive: true }); await writeFile(join(cwd, file.target), file.content); }
    return { code: 0, stdout: "", stderr: "" };
  };
}
const realRunner: ShadcnRunner = (args, { cwd }) => new Promise(done => {
  execFile(process.execPath, [requireHere.resolve("shadcn"), ...args], { cwd, env: { ...process.env, REGISTRY_URL: registryUrl }, timeout: 60_000 },
    (error, stdout, stderr) => done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
});
async function writeSubstrate(dir: string, manifest: object = { name: "page-host", private: true, type: "module" }) {
  await writeFile(join(dir, "package.json"), JSON.stringify(manifest));
  await writeFile(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] }, jsx: "react-jsx" } }));
  await writeFile(join(dir, "components.json"), JSON.stringify({ $schema: "https://ui.shadcn.com/schema.json", style: "new-york", rsc: true, tsx: true, tailwind: { config: "", css: "app.css", baseColor: "neutral", cssVariables: true }, aliases: { components: "@/components", utils: "@/lib/utils", ui: "@/components/ui", lib: "@/lib", hooks: "@/hooks" } }));
  await writeFile(join(dir, "app.css"), "");
}
/** Bundle app/page.tsx with esbuild and render it with this process's React. */
async function render(dir: string, module: string): Promise<string> {
  await writeFile(join(dir, "app/page.tsx"), module);
  const esbuild = await import("esbuild");
  const built = await esbuild.build({
    entryPoints: [join(dir, "app/page.tsx")], nodePaths: workspaceNodePaths(), bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
    plugins: [{ name: "host-react", setup(build) { build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, args => ({ path: requireHere.resolve(args.path), external: true })); } }],
  });
  const out = join(dir, `render-${temps.length}-${Date.now()}.mjs`);
  await writeFile(out, built.outputFiles[0]!.text);
  const entry = await import(pathToFileURL(out).href);
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(React.createElement(entry.default));
}
const instanceHeadings = (html: string) => [...html.matchAll(/<h1 data-copy="hero.heading">([^<]*)<\/h1>/g)].map(match => match[1]);

beforeAll(async () => {
  pins = JSON.parse(await readFile(join(fixtures, "pins.json"), "utf8"));
  server = createServer((request, response) => {
    if (request.url?.startsWith("/r/colors/")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ inlineColors: { light: {}, dark: {} }, cssVars: { light: {}, dark: {} }, cssVarsV4: { light: {}, dark: {} }, inlineColorsTemplate: "", cssVarsTemplate: "" }));
    } else { response.statusCode = 404; response.end("{}"); }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  registryUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/r`;
});
afterAll(async () => {
  await new Promise<void>(done => server.close(() => done()));
  await Promise.all(temps.map(dir => rm(dir, { recursive: true, force: true })));
});

describe("Publisher page host", () => {
  // Mutation proof: emit nextModule's Page without the PageHost wrap; this test fails with
  // "NEED component selection" because SiteFrame mounts selected leaves outside any provider.
  it("renders a Designer SiteFrame page inside PublisherHost fed by the consumer's selection module", async () => {
    const source = await siteLibrary();
    const draft = await resolveNativeNextDraft({ page, candidates: await admissions(source), source, copy, selection: { module: "selection.ts" } });
    expect(draft.findings).toEqual([]);
    const dir = await temp();
    await writeSubstrate(dir);
    const installed = await installAndBind({ ...draft.install!, substrate: dir, runner: fakeRunner() });
    expect(installed.findings).toEqual([]);
    await mkdir(join(dir, "app"));
    await writeFile(join(dir, draft.host!.file), draft.host!.module);
    await writeFile(join(dir, "selection.ts"), designerSelectionModule());
    const html = await render(dir, draft.module!);
    expect(html).toContain('data-ds-leaf="frames.site-shell"');
    expect(html).toContain('id="publisher-main-content"');
    expect(instanceHeadings(html)).toEqual([copy["home.hero.heading"], copy["home.proof.heading"], copy["home.close.heading"]]);
    // The same page with the host stripped is the defect this unit fixes.
    await expect(render(dir, draft.module!.replace(/createElement\(PageHost, null, (mount\([^)]*\))\)/, "$1"))).rejects.toThrow(/NEED component selection/);
  }, 120_000);

  it("emits no page without the consumer's component selection", async () => {
    const source = await siteLibrary();
    const draft = await resolveNativeNextDraft({ page, candidates: await admissions(source), source, copy });
    expect(draft.findings).toEqual([expect.objectContaining({ code: "need-component-selection" })]);
    expect(draft.module).toBeUndefined();
  });
});

describe("section instances", () => {
  it("mounts one section slot three times, each instance with its own copy binding", async () => {
    const resolved = await resolvePage(page, pins, directoryRecordSource({ roots: [join(fixtures, "library")] }));
    expect(resolved.findings).toEqual([]);
    const bound = bindPage({ page, slots: resolved.slots, copy });
    expect(bound.findings).toEqual([]);
    const sections = bound.page!.sections;
    expect(sections.map(slot => [slot.slot, slot.key])).toEqual([["sections.hero", "sections.hero"], ["sections.hero", "sections.hero#2"], ["sections.hero", "sections.hero#3"]]);
    expect(sections.map(slot => slot.copy["hero.heading"])).toEqual(["home.hero.heading", "home.proof.heading", "home.close.heading"]);
    // An instance without its own binding for a copy slot takes the slot's shared binding.
    expect(sections.map(slot => slot.copy["hero.body"])).toEqual(["home.hero.body", "home.proof.body", "home.hero.body"]);
    expect(bound.page!.frame.props.children).toEqual([{ $element: "sections.hero" }, { $element: "sections.hero#2" }, { $element: "sections.hero#3" }]);
  });
});

describe("first-party dependencies", () => {
  it("never hands shadcn an @clossys/* dependency the substrate already declares (vendored or file:)", async () => {
    const root = join(await temp(), "library");
    await cp(join(fixtures, "library"), root, { recursive: true });
    const itemPath = join(root, "frames.plain/plain-frame/v1/plain-frame.json");
    const item = JSON.parse(await readFile(itemPath, "utf8"));
    await writeFile(itemPath, JSON.stringify({ ...item, dependencies: ["@clossys/designer@^0.13.0", "@clossys/writer", "lucide-react@^0.500.0"], devDependencies: ["@clossys/publisher@latest"] }));
    const source = directoryRecordSource({ roots: [root] });
    const dir = await temp();
    const manifest = { name: "vendored", private: true, type: "module", dependencies: { "@clossys/designer": "file:../vendor/clossys-designer.tgz" }, devDependencies: { "@clossys/publisher": "file:../vendor/clossys-publisher.tgz" } };
    await writeSubstrate(dir, manifest);
    const seen: { dependencies?: string[]; devDependencies?: string[] }[] = [];
    const result = await installPage({ page: { id: "home", frame: "frames.plain", sections: [] }, pins, source, substrate: dir, runner: fakeRunner(seen) });
    expect(result.findings).toEqual([]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.dependencies).toEqual(["@clossys/writer", "lucide-react@^0.500.0"]);
    expect(seen[0]!.devDependencies ?? []).toEqual([]);
    expect(JSON.parse(await readFile(join(dir, "package.json"), "utf8"))).toEqual(manifest);
  });
});

// Acceptance: one frame plus three instances of one section slot, each with different Writer
// copy, installs through the real shadcn CLI into a fixture Next app and `next build` exits 0.
// The app lives inside the workspace so Next, React and @clossys/* resolve from its node_modules.
const nextBin = (() => { try { return requireHere.resolve("next/dist/bin/next"); } catch { return undefined; } })();
it.skipIf(!nextBin || process.env.FOUNDRY_SKIP_NEXT_BUILD === "1")("installs a frame plus three section instances into a fixture Next app that builds", async () => {
  const source = await siteLibrary();
  const draft = await resolveNativeNextDraft({ page, candidates: await admissions(source), source, copy, selection: { module: "selection.ts" } });
  expect(draft.findings).toEqual([]);
  const dir = await temp(".page-host-next-", join(import.meta.dirname, "../.."));
  await writeSubstrate(dir, { name: "page-host-next", private: true, type: "module", dependencies: { "@clossys/designer": "file:../../designer", "@clossys/publisher": "file:.." } });
  const installed = await installAndBind({ ...draft.install!, substrate: dir, runner: realRunner });
  expect(installed.findings).toEqual([]);
  await mkdir(join(dir, "app")); await mkdir(join(dir, "public"));
  await writeFile(join(dir, "app/page.tsx"), draft.module!);
  await writeFile(join(dir, draft.host!.file), draft.host!.module);
  await writeFile(join(dir, "selection.ts"), designerSelectionModule());
  await writeFile(join(dir, "app/layout.tsx"), 'import type { ReactNode } from "react";\nexport default function Layout({ children }: { children: ReactNode }) { return <html lang="en"><body>{children}</body></html>; }\n');
  await writeFile(join(dir, "public/mark.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="20"/></svg>');
  const result = await new Promise<{ code: number; stdout: string; stderr: string }>(done => execFile(process.execPath, [nextBin!, "build"], { cwd: dir, timeout: 300_000, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } }, (error, stdout, stderr) => done({ code: error ? 1 : 0, stdout, stderr })));
  expect(result, JSON.stringify(result).slice(-4000)).toMatchObject({ code: 0 });
  const html = await readFile(join(dir, ".next/server/app/index.html"), "utf8");
  expect(html).toContain('data-ds-leaf="frames.site-shell"');
  expect(instanceHeadings(html)).toEqual([copy["home.hero.heading"], copy["home.proof.heading"], copy["home.close.heading"]]);
}, 360_000);
