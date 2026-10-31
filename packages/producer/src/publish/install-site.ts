/**
 * `clossys publish --install --site <packId> [--build]`: one routed site app from a consumer's
 * route pack and content map (`clossys/agents/publisher/{route-pack,content-map}/<packId>.json`).
 *
 * Publisher plans the site (`planSite`: real paths from the content map, sections from the
 * route pack, one shared frame) and binds each route exactly as `publish --install --page`
 * does: the route's Publisher page cell supplies its copy bullets, its sections are the route
 * pack's active slots, and every route installs into one shared substrate. Frame links are
 * pointed at the content map (`applySiteNavigation`). The app is generated: one page module per
 * route, a route table, and a `main.tsx` that mounts the module for `location.pathname`. With
 * `--build`, the substrate's own Vite builds `dist/` with one `index.html` per route path.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { applySiteNavigation, installAndBind, isBlocking, planSite, siteLinkFindings, substrateDependencies, type BoundPage, type InstallFinding, type InstallPins, type InstallResult, type ShadcnRunner, type SitePlan, type SiteRoutePack } from "@clossys/publisher/install";
import { loadSelection, SELECTION_FILE } from "../records/index.js";
import { libraryRecordSource } from "../specimen/library-source.js";
import { specimenRoots } from "./publish.js";
import { ensureSubstrate, ensureSubstrateDependencies, npmRunner, pageRecordFromCell, renderBoundPage, shadcnRunner, writerCopy } from "./install.js";
import { installOutRoot, INSTALL_MARKER } from "./install-out.js";

export interface PublishSiteOptions {
  readonly root: string;
  /** The route pack and content map id (`clossys-site`). */
  readonly site: string;
  readonly out?: string;
  readonly records?: readonly string[];
  readonly runner?: ShadcnRunner;
  readonly npm?: ShadcnRunner;
  /** The deployment origin for this install (target config); overrides the route pack's `origin`. */
  readonly origin?: string;
  /** Run the substrate's Vite build into `substrate/dist`. */
  readonly build?: boolean;
  /** Runs the substrate's `vite` binary (`["build"]`); never through a shell. */
  readonly vite?: ShadcnRunner;
}
export interface PublishSiteResult {
  readonly out: string;
  readonly substrate: string;
  readonly plan?: SitePlan;
  readonly installed: InstallResult["installed"];
  readonly findings: readonly InstallFinding[];
  /** Bound pages by route id, navigation applied. */
  readonly pages: readonly BoundPage[];
  /** Route path to its static render (`site/<path>/index.html`). */
  readonly html: Readonly<Record<string, string>>;
  /** The built app, when `build` ran and succeeded. */
  readonly dist?: string;
  /** The resolved route list (`site-routes.json`): what Studio's Publisher page lists. */
  readonly routes?: string;
}

/** `site-routes.json`: the resolved routes of one site install, read-only for Studio. */
export interface SiteRoutesFile {
  readonly schema: "clossys.site-routes/1";
  readonly site: string;
  readonly publicationId: string;
  readonly origin?: string;
  readonly frame: string;
  readonly routes: readonly { readonly path: string; readonly id: string; readonly frame: string; readonly sections: readonly string[]; readonly url?: string; readonly html?: string }[];
  readonly navigation: SitePlan["navigation"];
  readonly sitemap?: readonly string[];
}

/** The substrate's own Vite, run with arguments only. */
export function viteRunner(env: NodeJS.ProcessEnv = process.env): ShadcnRunner {
  return (args, { cwd }) => new Promise(done => {
    execFile(join(cwd, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite"), [...args], { cwd, env, timeout: 600_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** The generated route table (`clossys/site.json`): path to page module id, content-map order. */
export function siteTable(plan: SitePlan, copy: Readonly<Record<string, string>> = {}): { schema: "clossys.site/1"; publicationId: string; origin?: string; routes: { id: string; path: string; title?: string }[] } {
  // `title` is the content-map title's Writer text; the routed entry sets it as the document title.
  return { schema: "clossys.site/1", publicationId: plan.publicationId, ...(plan.origin ? { origin: plan.origin } : {}), routes: plan.routes.map(route => ({ id: route.id, path: route.path, ...(copy[route.title] ? { title: copy[route.title] } : {}) })) };
}

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** `sitemap.xml` from the content map's indexable pages under the deployment origin. */
export function sitemapXml(urls: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url => `  <url><loc>${escapeXml(url)}</loc></url>\n`).join("")}</urlset>\n`;
}

/** The routed entry: mounts the page module whose route path is `location.pathname`. */
export const SITE_MAIN = [
  "// Generated by clossys publish --install --site. Rerun the install rather than editing this file.",
  'import "./app.css";',
  'import { createElement } from "react";',
  'import { createRoot } from "react-dom/client";',
  'import site from "./clossys/site.json";',
  "",
  'const pages = import.meta.glob("./clossys/pages/*.tsx", { eager: true }) as Record<string, { default: () => unknown }>;',
  'const path = location.pathname.replace(/\\/index\\.html$/, "/").replace(/(.)\\/$/, "$1") || "/";',
  "const route = site.routes.find(row => row.path === path) as { id: string; path: string; title?: string } | undefined;",
  "if (route?.title) document.title = route.title;",
  "// `?theme=dark|light` wins; otherwise the visitor's color-scheme preference picks the mode.",
  'const theme = new URLSearchParams(location.search).get("theme");',
  'if (theme === "dark" || (theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.classList.add("dark");',
  "const page = route ? pages[`./clossys/pages/${route.id}.tsx`] : undefined;",
  'const root = createRoot(document.getElementById("root")!);',
  'root.render(page ? createElement(page.default as any) : createElement("p", null, `No route ${path}`));',
  "",
].join("\n");

/** Vite config for the routed app: after the build, every route path gets its own `index.html`. */
export const SITE_VITE_CONFIG = [
  "// Generated by clossys publish --install --site. Rerun the install rather than editing this file.",
  'import { copyFileSync, mkdirSync, readFileSync } from "node:fs";',
  'import { join } from "node:path";',
  'import { fileURLToPath } from "node:url";',
  'import tailwindcss from "@tailwindcss/vite";',
  'import { defineConfig } from "vite";',
  "",
  'const here = fileURLToPath(new URL(".", import.meta.url));',
  'const site = JSON.parse(readFileSync(join(here, "clossys", "site.json"), "utf8")) as { routes: { path: string }[] };',
  "",
  "export default defineConfig({",
  '  base: "/",',
  "  plugins: [tailwindcss(), {",
  '    name: "clossys-site-routes", apply: "build",',
  "    closeBundle() {",
  '      const dist = join(here, "dist");',
  '      for (const route of site.routes) if (route.path !== "/") { const dir = join(dist, ...route.path.split("/").filter(Boolean)); mkdirSync(dir, { recursive: true }); copyFileSync(join(dist, "index.html"), join(dir, "index.html")); }',
  "    },",
  "  }],",
  '  oxc: { jsx: { runtime: "automatic", importSource: "react" } },',
  '  resolve: { alias: { "@": here } },',
  "});",
  "",
].join("\n");

async function readJson(path: string, what: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { throw new Error(`publish --install --site: no ${what} at ${path}`); }
}

const htmlPath = (out: string, path: string) => join(out, "site", ...path.split("/").filter(Boolean), "index.html");

export async function publishSite(options: PublishSiteOptions): Promise<PublishSiteResult> {
  const root = resolve(options.root);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(options.site)) throw new Error(`publish --install --site: ${options.site} needs a pack id ([a-z0-9-])`);
  const base = join(root, "clossys", "agents", "publisher");
  const pack = await readJson(join(base, "route-pack", `${options.site}.json`), "route pack") as SiteRoutePack;
  const map = await readJson(join(base, "content-map", `${options.site}.json`), "content map") as Parameters<typeof planSite>[0];
  const out = resolve(options.out ?? join(installOutRoot(root), `site-${options.site}`));
  if (existsSync(out) && !existsSync(join(out, INSTALL_MARKER))) throw new Error(`publish: ${out} exists and was not written by clossys publish --install`);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, INSTALL_MARKER), "clossys publish --install --site output\n");
  const substrate = join(out, "substrate");

  const planned = planSite(map, pack, options.origin !== undefined ? { origin: options.origin } : {});
  const findings: InstallFinding[] = [...planned.findings];
  const installed: InstallResult["installed"][number][] = [];
  const pages: BoundPage[] = [];
  const html: Record<string, string> = {};
  let dist: string | undefined;
  const plan = planned.plan;
  if (plan) {
    await ensureSubstrate(substrate);
    const selection = loadSelection(join(root, "clossys", SELECTION_FILE));
    const pins: InstallPins = Object.fromEntries(Object.entries(selection.pins).map(([slot, pin]) => [slot, { element: pin.element, version: pin.version }]));
    const source = libraryRecordSource({ roots: specimenRoots(root, options.records) });
    const copy = await writerCopy(root);
    const runner = options.runner ?? shadcnRunner();
    const slots: Parameters<typeof substrateDependencies>[0][number][] = [];
    for (const route of plan.routes) {
      // The cell supplies copy bullets only; the route pack owns the sections, the content map the frame.
      const cell = await pageRecordFromCell(root, route.id, pins);
      if (cell.frame !== route.frame || JSON.stringify(cell.sections) !== JSON.stringify(route.sections)) {
        findings.push({ code: "site-cell-mismatch", severity: "info", detail: `${route.id}: page cell lists ${cell.frame} [${cell.sections.join(", ")}]; the site mounts ${route.frame} [${route.sections.join(", ")}]` });
      }
      const result = await installAndBind({ page: { ...cell, frame: route.frame, sections: route.sections }, pins, source, substrate, runner, copy });
      findings.push(...result.findings);
      installed.push(...result.installed.filter(row => !installed.some(seen => seen.slot === row.slot)));
      slots.push(...result.slots);
      if (!result.page) continue;
      const routed = applySiteNavigation(result.page, plan, copy);
      findings.push(...routed.findings, ...siteLinkFindings(routed.page, plan));
      pages.push(routed.page);
    }
    if (pages.length === plan.routes.length && !findings.some(isBlocking)) {
      const failed = await ensureSubstrateDependencies(substrate, substrateDependencies(slots), options.npm ?? npmRunner());
      if (failed) findings.push(failed);
    }
    if (pages.length === plan.routes.length && !findings.some(isBlocking)) {
      await mkdir(join(substrate, "clossys", "pages"), { recursive: true });
      await writeFile(join(substrate, "clossys", "site.json"), `${JSON.stringify(siteTable(plan, copy), null, 2)}\n`);
      await writeFile(join(substrate, "main.tsx"), SITE_MAIN);
      await writeFile(join(substrate, "vite.config.ts"), SITE_VITE_CONFIG);
      if (plan.sitemap) { await mkdir(join(substrate, "public"), { recursive: true }); await writeFile(join(substrate, "public", "sitemap.xml"), sitemapXml(plan.sitemap)); }
      for (const [index, page] of pages.entries()) {
        const route = plan.routes[index]!;
        try {
          const markup = await renderBoundPage(page, substrate);
          const file = htmlPath(out, route.path);
          await mkdir(join(file, ".."), { recursive: true });
          await writeFile(file, markup);
          html[route.path] = file;
        } catch (error) {
          findings.push({ code: "render-failed", detail: `${page.id}: the bound page did not render: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` });
        }
      }
      if (options.build && !findings.some(isBlocking)) {
        const run = await (options.vite ?? viteRunner())(["build"], { cwd: substrate });
        if (run.code !== 0) findings.push({ code: "build-failed", detail: `vite build exited ${run.code}: ${(run.stderr || run.stdout).trim().split("\n").slice(-3).join(" ")}` });
        else dist = join(substrate, "dist");
      }
    }
  }
  let routes: string | undefined;
  if (plan) {
    const file: SiteRoutesFile = {
      schema: "clossys.site-routes/1", site: options.site, publicationId: plan.publicationId, ...(plan.origin ? { origin: plan.origin } : {}), frame: plan.frame,
      routes: plan.routes.map(route => ({ path: route.path, id: route.id, frame: route.frame, sections: route.sections, ...(plan.origin ? { url: new URL(route.path, plan.origin).href } : {}), ...(html[route.path] ? { html: html[route.path] } : {}) })),
      navigation: plan.navigation, ...(plan.sitemap ? { sitemap: plan.sitemap } : {}),
    };
    routes = join(out, "site-routes.json");
    await writeFile(routes, `${JSON.stringify(file, null, 2)}\n`);
  }
  const report = { site: options.site, ...(plan ? { plan } : {}), installed, findings, routes: Object.fromEntries(pages.map(page => [plan!.routes.find(route => route.id === page.id)!.path, page.id])) };
  await writeFile(join(out, "site-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return { out, substrate, ...(plan ? { plan } : {}), installed, findings, pages, html, ...(dist ? { dist } : {}), ...(routes ? { routes } : {}) };
}

/** Whether the site stopped short of a static render for every route (exit 1). */
export function siteFailed(result: PublishSiteResult): boolean {
  return !result.plan || Object.keys(result.html).length !== result.plan.routes.length || result.findings.some(isBlocking);
}

export function siteSummary(result: PublishSiteResult): string {
  const blocking = result.findings.filter(isBlocking).length, info = result.findings.length - blocking;
  return [
    ...(result.plan ? [`Site: ${result.plan.publicationId} (${result.plan.routes.length} routes, frame ${result.plan.frame})`, ...result.plan.routes.map(route => `  ${route.path} ${route.id}: ${route.sections.join(", ")}`),
      `Nav: ${result.plan.navigation.primary.map(link => link.href).join(" ")} · footer: ${result.plan.navigation.secondary.map(link => link.href).join(" ")}`] : []),
    `Installed: ${result.installed.length}`,
    `Findings: ${blocking}${info ? ` (+${info} info)` : ""}`,
    ...result.findings.map(row => `  ${isBlocking(row) ? "" : "info "}${row.code}${row.slot ? ` ${row.slot}` : ""}: ${row.detail}`),
    `Substrate: ${result.substrate}`,
    ...(result.dist ? [`App: ${result.dist}`] : []),
    ...(result.plan?.origin ? [`Origin: ${result.plan.origin}${result.plan.sitemap ? ` (sitemap: ${result.plan.sitemap.length} urls)` : ""}`] : []),
    ...(result.routes ? [`Routes: ${result.routes}`] : []),
    `Report: ${join(result.out, "site-report.json")}`,
    ...(siteFailed(result) ? [`publish --install --site failed: ${blocking} blocking finding(s)`] : []),
  ].join("\n");
}
