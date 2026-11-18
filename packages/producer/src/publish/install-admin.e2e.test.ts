/**
 * foundry-build-0048 U20b: the admin workspace renders. A scratch consumer (the install-consumer fixture, its Designer
 * IA holding every admin unit, the five data-bound sections among them, each pinned to a DRAFT fixture registry item,
 * and the admin Writer copy pinned) runs `clossys init`, which seeds and pins the five admin pages; then
 * `publish --install --next --bind` for the admin publication writes the route files, the `[agent]` folders with
 * their static parameters and the records snapshot; the installed pages render the consumer's own records.
 * The esbuild render stands in for Next's server render; `FOUNDRY_ADMIN_NEXT_BUILD=1` also runs a real `next build`.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import { runInitCli } from "../cli/init.js";
import { raiseRequest } from "../records/request.js";
import { listSlots } from "../records/slots.js";
import { withDesignerSlots } from "../specimen/__fixtures__/canonical-library.js";
import { publishNext, type PublishNextResult } from "./install-next.js";
import { localItemRunner, NEXT_BIND_RECORDS } from "./install-next-bind.js";

const AT = "2026-11-18T09:00:00Z";
const fixture = join(import.meta.dirname, "__fixtures__", "install-consumer");
const packagesDir = join(import.meta.dirname, "..", "..", "..");
const template = join(packagesDir, "publisher", "templates", "site");
const instantiate = join(packagesDir, "publisher", "dist", "site-template", "instantiate-cli.js");
const PAGES = ["page.admin-home", "page.admin-gallery", "page.admin-slot", "page.admin-requests", "page.admin-questions"];
const BOUND = ["sections.slot-gallery", "sections.slot-detail", "sections.candidate-preview", "sections.question-packet", "sections.queue-list"];
const temps: string[] = [];
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const sha = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
const readJson = <T = Record<string, unknown>>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

/** A DRAFT fixture registry item for a Designer slot: one component file, the copy slots it reads. */
function item(slot: string, name: string, code: string, copyKeys: { slot: string; prop: string; previewKey: string }[] = []) {
  const layer = slot.slice(0, slot.indexOf("."));
  return {
    $schema: "https://ui.shadcn.com/schema/registry-item.json", name, type: "registry:block",
    files: [{ path: `registry/${layer}/${name}.tsx`, type: "registry:component", target: `components/${layer}/${name}.tsx`, content: code }],
    meta: {
      slot, source: { kind: "original", ref: [], hash: `sha256:${sha(code)}`, license: "MIT" },
      element: {
        id: name, package: "designer", layer, slot, kind: "registry:block", license: { spdx: "MIT" }, creator: { agent: "designer", model: "fixture" },
        reason: "DRAFT U20b fixture: renders the records its port receives, or its empty state.", createdAt: AT, checks: [], deps: { npm: {}, elements: [] },
        reads: { copyKeys, themeVars: [] },
      },
      preview: {
        schema: "clossys.element-preview/1", fixtures: Object.fromEntries(copyKeys.map(key => [key.prop, { $copy: key.previewKey }])),
        inputs: { copy: copyKeys.map(key => key.previewKey).sort() }, container: layer === "frames" ? "page" : "section-in-frame", theme: "light", width: 1280,
      },
    },
  };
}
const ITEMS: Record<string, ReturnType<typeof item>> = {
  "frames.app-shell": item("frames.app-shell", "admin-shell", 'import type * as React from "react";\n\nexport function AdminShell({ children }: { children?: React.ReactNode }) {\n  return <main data-frame="app-shell">{children}</main>;\n}\n'),
  "frames.app-sidebar": item("frames.app-sidebar", "admin-sidebar", 'export function AdminSidebar() {\n  return <nav data-frame="app-sidebar" />;\n}\n'),
  "sections.page-header": item("sections.page-header", "admin-page-header", 'export function AdminPageHeader({ title }: { title: string }) {\n  return <header data-section="page-header"><h1>{title}</h1></header>;\n}\n', [{ slot: "sections.page-header.copy", prop: "title", previewKey: "admin-home.header" }]),
  "sections.notices": item("sections.notices", "admin-notices", 'export function AdminNotices({ text }: { text: string }) {\n  return <aside data-section="notices">{text}</aside>;\n}\n', [{ slot: "sections.notices.copy", prop: "text", previewKey: "admin-home.notices" }]),
  "sections.empty-state": item("sections.empty-state", "admin-empty-state", 'export function AdminEmptyState({ text }: { text: string }) {\n  return <section data-section="empty-state">{text}</section>;\n}\n', [{ slot: "sections.empty-state.copy", prop: "text", previewKey: "admin-home.first-run" }]),
  "sections.slot-gallery": item("sections.slot-gallery", "admin-slot-gallery", 'export function AdminSlotGallery({ slots }: { slots?: { id: string; kind: string; status: string | null }[] }) {\n  if (!slots?.length) return <section data-section="slot-gallery" data-empty="" />;\n  return <section data-section="slot-gallery"><ul>{slots.map(row => <li key={row.id} data-slot={row.id}>{row.id} ({row.kind})</li>)}</ul></section>;\n}\n'),
  "sections.slot-detail": item("sections.slot-detail", "admin-slot-detail", 'export function AdminSlotDetail({ slot }: { slot?: { id: string; agent: string; kind: string; pin: { candidate: string } | null } | null }) {\n  if (!slot) return <section data-section="slot-detail" data-empty="" />;\n  return <section data-section="slot-detail"><p data-detail={slot.id}>{slot.agent}/{slot.id} is a {slot.kind}, pinned to {slot.pin ? slot.pin.candidate : "nothing"}</p></section>;\n}\n'),
  "sections.candidate-preview": item("sections.candidate-preview", "admin-candidate-preview", 'export function AdminCandidatePreview({ candidates }: { candidates?: { name: string; pinned: boolean }[] }) {\n  if (!candidates?.length) return <section data-section="candidate-preview" data-empty="" />;\n  return <section data-section="candidate-preview"><ul>{candidates.map(row => <li key={row.name} data-candidate={row.name}>{row.name}{row.pinned ? " (pinned)" : ""}</li>)}</ul></section>;\n}\n'),
  "sections.question-packet": item("sections.question-packet", "admin-question-packet", 'export function AdminQuestionPacket({ questions }: { questions?: { id: string; ask: string; default: string | null }[] }) {\n  if (!questions?.length) return <section data-section="question-packet" data-empty="" />;\n  return <section data-section="question-packet"><ol>{questions.map(row => <li key={row.id} data-question={row.id}>{row.ask} (default {row.default ?? "none"})</li>)}</ol></section>;\n}\n'),
  "sections.queue-list": item("sections.queue-list", "admin-queue-list", 'export function AdminQueueList({ entries }: { entries?: { id: string; target: string; status: string; why: string }[] }) {\n  if (!entries?.length) return <section data-section="queue-list" data-empty="" />;\n  return <section data-section="queue-list"><ol>{entries.map(row => <li key={row.id} data-entry={row.id}>{row.target} is {row.status}: {row.why}</li>)}</ol></section>;\n}\n'),
};
/** The admin Writer copy (DRAFT fixture strings), by Writer slot and key. */
const COPY: Record<string, Record<string, string>> = {
  "sections.page-header.copy": {
    "admin-home.header": "DRAFT Workspace home", "admin-gallery.header": "DRAFT Agent slots", "admin-slot.header": "DRAFT Slot",
    "admin-requests.header": "DRAFT Requests", "admin-questions.header": "DRAFT Owner questions",
  },
  "sections.notices.copy": { "admin-home.notices": "DRAFT Nothing needs you right now." },
  "sections.empty-state.copy": { "admin-home.first-run": "DRAFT Start by placing an agent." },
  ...Object.fromEntries(PAGES.map(page => [`${page}.meta`, { [`${page.slice("page.".length)}.meta`]: `DRAFT ${page.slice("page.admin-".length)}` }])),
};

function pin(dir: string, name: string, bytes: string): void {
  mkdirSync(join(dir, "candidates"), { recursive: true });
  writeFileSync(join(dir, "candidates", name), bytes);
  writeFileSync(join(dir, "pin.json"), json({ candidate: name, sha256: sha(bytes), decidedBy: "planner:U20B-FIXTURE", basis: "planner", at: AT }));
}

/** The scratch consumer: the install-consumer fixture, every admin unit pinned, the admin copy pinned, and records to show. */
async function consumer(): Promise<{ root: string; site: string; app: string }> {
  // A real `next build` resolves Next, React and @clossys/* from the workspace's node_modules, so that run's consumer
  // lives inside this package (as page-host.test.ts does); the render-only run stays in the OS temp dir.
  const parent = process.env.FOUNDRY_ADMIN_NEXT_BUILD === "1" ? join(import.meta.dirname, "..", "..") : tmpdir();
  const root = realpathSync(mkdtempSync(join(parent, process.env.FOUNDRY_ADMIN_NEXT_BUILD === "1" ? ".admin-e2e-next-" : "producer-admin-e2e-")));
  temps.push(root);
  cpSync(fixture, root, { recursive: true });
  const clossys = join(root, "clossys");
  await withDesignerSlots(clossys);
  const designer = join(clossys, "agents", "designer");
  // The five data-bound sections, in their own IA group, each slot.json at the position the IA gives it.
  const designerIa = readJson<{ nodes: unknown[] }>(join(designer, "ia.json"));
  designerIa.nodes.push({ id: "sections.records", label: "Records", children: [{ id: "records", label: "Records", slots: BOUND }] });
  writeFileSync(join(designer, "ia.json"), json(designerIa));
  const placed = new Map(listSlots(clossys, "designer").map(entry => [entry.id, entry.position]));
  for (const slot of BOUND) {
    const { l0, l1, l2, order } = placed.get(slot)!;
    mkdirSync(join(designer, slot), { recursive: true });
    writeFileSync(join(designer, slot, "slot.json"), json({ schema: "clossys.slot/1", id: slot, agent: "designer", ia: { l0, l1, l2, order }, kind: "element", contract: {}, inputs: [], uses: [] }));
  }
  for (const [slot, registry] of Object.entries(ITEMS)) pin(join(designer, slot), `${registry.name}-v1.json`, json(registry));
  // The admin copy: one Writer slot per copy record the admin page defaults cite.
  const writer = join(clossys, "agents", "writer");
  const writerIa = readJson<{ nodes: { id: string; children: { id: string; slots: string[] }[] }[] }>(join(writer, "ia.json"));
  writerIa.nodes.push({ id: "admin", label: "Admin", children: [{ id: "admin.copy", label: "Copy", slots: Object.keys(COPY) }] } as never);
  writeFileSync(join(writer, "ia.json"), json(writerIa));
  const copyAt = new Map(listSlots(clossys, "writer").map(entry => [entry.id, entry.position]));
  for (const [slot, keys] of Object.entries(COPY)) {
    const dir = join(writer, slot), { l0, l1, l2, order } = copyAt.get(slot)!;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "slot.json"), json({ schema: "clossys.slot/1", id: slot, agent: "writer", kind: "strings", ia: { l0, l1, l2, order }, contract: {}, inputs: [], uses: [] }));
    const body = Object.entries(keys).map(([key, text]) => `### ${key}\n<!-- ${JSON.stringify({ id: key, bindings: [] })} -->\n${text}\n`).join("\n");
    pin(dir, "admin-v1.md", `---\nslot: ${JSON.stringify(slot)}\nsource: {"kind":"original","ref":[]}\nlocales: ["en"]\n---\n\n## en\n\n${body}`);
  }
  // Records the data-bound sections read: one open owner question and one request.
  const pick = join(clossys, "agents", "producer", "queue.pick", "entries");
  mkdirSync(pick, { recursive: true });
  const question = "20261118T0900Z-hero-pick";
  writeFileSync(join(pick, `${question}.json`), json({
    schema: "clossys.queue-entry/1", id: question, agent: "producer", kind: "queue-entry", status: "open", queue: "queue.pick",
    ask: "DRAFT Which hero candidate ships?", subject: "designer/sections.hero", decider: "owner", default: "simple-hero-v3",
    createdAt: AT, refs: [], events: [{ at: AT, op: "raised", by: "agent:designer" }],
  }));
  raiseRequest(clossys, { target: "designer/sections.pricing-matrix", from: "owner", rel: "uses", why: "DRAFT the pricing page needs a matrix", source: "ia", by: "producer", at: AT });
  const site = join(root, "apps", "site");
  // The site comes from Publisher's own instantiate (as a consumer's does): the template copied standalone, its
  // {{consumer-root}} paths resolved, its @clossys/* pinned to the versions this workspace builds.
  // A typed selection module (as page-host.test.ts's): the fixture sections mount no selected Designer leaf, and a
  // real `next build` type-checks the generated host against Designer's ConsumerComponentSelection.
  writeFileSync(join(root, "component-selection.ts"), [
    'import type { ConsumerComponentSelection } from "@clossys/designer/frames";',
    "// DRAFT U20b fixture: the admin fixture sections mount no selected Designer leaf.",
    'export const componentSelection = { profile: { components: { components: {}, selectionHash: "fixture" } }, selectionHash: "fixture", descriptors: {}, modules: {} } as unknown as ConsumerComponentSelection;',
    "",
  ].join("\n"));
  mkdirSync(join(clossys, "designer"), { recursive: true });
  writeFileSync(join(clossys, "designer", "brand.css"), "/* DRAFT U20b fixture: the consumer's brand tokens (none). */\n");
  const pins = Object.fromEntries(Object.keys(readJson<{ dependencies: Record<string, string> }>(join(template, "package.json")).dependencies)
    .filter(name => name.startsWith("@clossys/"))
    .map(name => [name, readJson<{ version: string }>(join(packagesDir, name.slice("@clossys/".length), "package.json")).version]));
  writeFileSync(join(root, ".pins.json"), json(pins));
  const made = await new Promise<{ code: number; out: string }>(done => execFile(process.execPath, [instantiate, "--root", root, "--pins", join(root, ".pins.json"), "--standalone"], (error, stdout, stderr) => done({ code: error ? 1 : 0, out: `${stdout}\n${stderr}` })));
  if (made.code !== 0) throw new Error(`publisher-site-instantiate failed: ${made.out}`);
  return { root, site, app: join(site, "app") };
}
const install = (root: string, app: string, check = false): Promise<PublishNextResult> => publishNext({
  root, publication: "admin", app, check, out: join(root, ".out"),
  bind: { selection: { module: join(root, "component-selection.ts") }, runner: localItemRunner },
});
const blocking = (result: PublishNextResult) => result.findings.filter(finding => finding.severity !== "info");

/** Bundle the installed root layout and one installed route module; `params` are the dynamic route's values. */
async function render(site: string, route: string, params?: Record<string, string>): Promise<string> {
  const here = createRequire(import.meta.url);
  const entry = `import Layout from "./app/layout"; import Page from "./app/${route}"; export { Layout, Page };`;
  const result = await build({
    stdin: { contents: entry, resolveDir: site, loader: "tsx" }, bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic", logLevel: "silent",
    banner: { js: `import { createRequire as __createRequire } from "node:module"; const require = __createRequire(${JSON.stringify(import.meta.filename)});` },
    loader: { ".css": "empty" },
    nodePaths: [join(import.meta.dirname, "..", "..", "node_modules"), join(import.meta.dirname, "..", "..", "..", "..", "node_modules")],
    plugins: [{ name: "host-react", setup(builder) { builder.onResolve({ filter: /^(?:react(?:-dom)?|next)(?:\/.*)?$/ }, args => ({ path: here.resolve(args.path), external: true })); } }],
  });
  const out = join(site, ".render", `${route.replace(/\W/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  mkdirSync(join(site, ".render"), { recursive: true });
  writeFileSync(out, result.outputFiles[0]!.text);
  const module = await import(pathToFileURL(out).href) as { Layout: (props: { children: ReactNode }) => ReactElement; Page: (props: { params?: Promise<Record<string, string>> }) => ReactElement | Promise<ReactElement> };
  // A dynamic route's Page is async (it awaits Next's params): resolve it to its element, as Next does, then render.
  const page = await module.Page(params ? { params: Promise.resolve(params) } : {});
  return renderToStaticMarkup(createElement(module.Layout, null, page));
}

describe("the admin workspace renders the consumer's records (init, publish admin, build)", () => {
  it("init pins the admin pages; the bound install routes <agent> as [agent] from the records; every admin page renders records-derived text", { timeout: 300_000 }, async () => {
    const { root, site, app } = await consumer();
    const init = await runInitCli(["--at", AT], root);
    expect(init.exitCode, init.message).toBe(0);
    const seat = (init.output as { admin: { pinned: string[]; waiting: { slot: string; reason: string }[] } }).admin;
    expect(seat.waiting, JSON.stringify(seat.waiting)).toEqual([]);
    expect(seat.pinned).toEqual(expect.arrayContaining(PAGES));

    const result = await install(root, app);
    expect(blocking(result)).toEqual([]);
    // The dynamic routes are [param] folders whose static params are the records' agents and slots.
    expect(existsSync(join(app, "admin", "[agent]", "page.tsx"))).toBe(true);
    expect(existsSync(join(app, "admin", "[agent]", "[slot]", "page.tsx"))).toBe(true);
    const gallery = readFileSync(join(app, "admin", "[agent]", "page.tsx"), "utf8");
    expect(gallery).toContain("generateStaticParams");
    expect(gallery).toContain('{ agent: "designer" }');
    expect(gallery).not.toContain('agent: "requests"');
    expect(readFileSync(join(site, NEXT_BIND_RECORDS), "utf8")).toContain('"schema": "clossys.admin-records/1"');

    const home = await render(site, "admin/page");
    expect(home).toContain("DRAFT Workspace home");
    expect(home).toContain("DRAFT Nothing needs you right now.");
    const designer = await render(site, "admin/[agent]/page", { agent: "designer" });
    expect(designer).toContain("DRAFT Agent slots");
    expect(designer).toContain('data-slot="sections.slot-gallery"');
    expect(designer).toContain("frames.app-shell (element");
    const detail = await render(site, "admin/[agent]/[slot]/page", { agent: "designer", slot: "sections.page-header" });
    expect(detail).toContain("designer/sections.page-header is a element");
    expect(detail).toContain("pinned to admin-page-header-v1.json");
    expect(detail).toContain('data-candidate="admin-page-header-v1.json"');
    const questions = await render(site, "admin/questions/page");
    expect(questions).toContain("DRAFT Which hero candidate ships? (default simple-hero-v3)");
    const requests = await render(site, "admin/requests/page");
    expect(requests).toContain("designer/sections.pricing-matrix is open: DRAFT the pricing page needs a matrix");
    // An agent the records do not hold is not a page: the route calls notFound().
    await expect(render(site, "admin/[agent]/page", { agent: "nobody" })).rejects.toThrow();
    // A reinstall over unchanged records is byte-identical.
    expect((await install(root, app, true)).files.filter(file => file.state === "drift")).toEqual([]);

    if (process.env.FOUNDRY_ADMIN_NEXT_BUILD === "1") {
      const next = createRequire(join(import.meta.dirname, "..", "..", "..", "..", "package.json")).resolve("next/dist/bin/next");
      const built = await new Promise<{ code: number; out: string }>(done => execFile(process.execPath, [next, "build"], { cwd: site, timeout: 280_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } }, (error, stdout, stderr) => done({ code: error ? 1 : 0, out: `${stdout}\n${stderr}` })));
      expect(built.code, built.out.slice(-4000)).toBe(0);
      // React's server render separates adjacent text nodes with `<!-- -->`: drop them to read the page's text.
      const html = (path: string) => readFileSync(join(site, ".next", "server", "app", `${path}.html`), "utf8").replaceAll("<!-- -->", "");
      expect(html("admin")).toContain("DRAFT Workspace home");
      expect(html("admin/designer")).toContain('data-slot="sections.slot-gallery"');
      expect(html("admin/questions")).toContain("DRAFT Which hero candidate ships?");
      expect(html("admin/requests")).toContain("designer/sections.pricing-matrix is open");
      expect(readdirSync(join(site, ".next", "server", "app", "admin"))).not.toContain("nobody.html");
    }
  });
});
