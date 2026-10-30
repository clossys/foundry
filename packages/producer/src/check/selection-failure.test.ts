import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startProducerServer, type ProducerServer } from "../server/index.js";
import { readStudioDesignerLibrary } from "../server/theme.js";
import type { StudioSelection } from "../server/selection.js";
import type { PageLintReport } from "./page-types.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const timeout = 120_000;
const renderMessage = "Selected component failed: fixture render fault";

describe("Studio selection faults through the native page gate", () => {
  let directory: string;
  let server: ProducerServer | undefined;
  let browser: any;
  let sourceHead: string;
  let compilerMessage: string;
  let sequence = 0;
  const logs = vi.spyOn(console, "error"); // Observe real logging without replacing the compiler or API.

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "producer-selection-failure-"));
    const root = join(directory, "consumer");
    const cells = join(root, "clossys/agents/designer");
    await mkdir(cells, { recursive: true });
    await writeFile(join(cells, "tree.json"), "{");
    try { await readStudioDesignerLibrary(root); }
    catch (error) { compilerMessage = error instanceof Error ? error.message : String(error); }
    expect(compilerMessage).toContain("Invalid JSON");
    const receipt = JSON.parse(await readFile(join(packageRoot, "dist/check/source-receipt.json"), "utf8"));
    expect(receipt.sourceDirty).toBe(false);
    sourceHead = receipt.sourceHead;

    // Bundle the real provider and boundary. HTTP, SSE, React and Chromium all run natively.
    const provider = join(packageRoot, "studio/components/StudioSelection.tsx");
    const boundary = join(packageRoot, "studio/components/StudioSelectionBoundary.tsx");
    const entry = `import {createElement} from "react";
import {createRoot} from "react-dom/client";
import {StudioSelectionProvider} from ${JSON.stringify(provider)};
import {StudioSelectionBoundary} from ${JSON.stringify(boundary)};
const query = new URLSearchParams(location.search);
function Content() { if (query.has("broken")) throw new Error(${JSON.stringify(renderMessage)}); return createElement("h1", null, "Studio fixture ready"); }
const child = createElement(Content);
createRoot(document.getElementById("root")).render(query.get("mode") === "render" ? createElement(StudioSelectionBoundary, null, child) : createElement(StudioSelectionProvider, null, child));`;
    await writeFile(join(directory, "entry.tsx"), entry);
    await build({ stdin: { contents: entry, loader: "tsx", resolveDir: packageRoot }, outfile: join(directory, "client.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, sourcemap: false, logLevel: "silent" });
    const html = '<!doctype html><html lang="en"><head><title>Studio fixture</title><link rel="icon" href="data:,"><style id="studio-selection-style"></style></head><body><div id="root"></div><script src="/client.js"></script></body></html>';
    await writeFile(join(directory, "page.html"), html);
    const child = `import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
const server = createServer(async (request,response) => {
  if(request.url === "/studio-mark.svg") { response.writeHead(204); response.end(); return; }
  const script = request.url === "/client.js";
  response.writeHead(200,{"content-type":script ? "application/javascript" : "text/html","cache-control":"no-store"});
  response.end(await readFile(new URL(script ? "./client.js" : "./page.html",import.meta.url)));
});
server.listen(Number(process.env.PORT),process.env.HOSTNAME);
process.once("SIGTERM",()=>server.close(()=>process.exit(0)));`;
    const studioEntry = join(directory, "studio-child.mjs");
    await writeFile(studioEntry, child);
    server = await startProducerServer({ root, port: 0, studioEntry, handleSignals: false });
    const { chromium } = createRequire(import.meta.url)("playwright");
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  }, timeout);

  afterAll(async () => {
    try {
      if (directory) await writeFile(join(directory, "server-errors.json"), JSON.stringify(logs.mock.calls, null, 2));
      await browser?.close();
      await server?.close();
    } finally { logs.mockRestore(); }
    // Retain all source fixtures, browser observations and gate reports.
  }, timeout);

  async function inspect(label: string, query: string): Promise<PageLintReport> {
    const name = `${++sequence}-${label}`;
    const manifestPath = join(directory, `${name}.manifest.json`);
    const reportPath = join(directory, `${name}.report.json`);
    const url = `${server!.url}/${query}`;
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, sourceHead, pages: [{ url, cellIds: [] }] }));
    const child = spawn(process.execPath, [join(packageRoot, "dist/cli/index.js"), "check", "--pages", manifestPath, "--report", reportPath, "--json"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45_000);
    let code: number | null;
    try { code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }); }
    finally { clearTimeout(timer); }
    await writeFile(join(directory, `${name}.process.json`), JSON.stringify({ code, stdout, stderr }, null, 2));
    const result = JSON.parse(stdout);
    const report = JSON.parse(await readFile(reportPath, "utf8")) as PageLintReport;
    expect(result).toMatchObject({ exitCode: code, report });
    expect(report).toMatchObject({ schemaVersion: 1, gate: "PROC-5", sourceHead, sourceDirty: false, exitCode: code });
    return report;
  }

  async function visibleFault(query: string, message: string, prefix: string): Promise<void> {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("console", (event: any) => { if (event.type() === "error") errors.push(event.text()); });
    try {
      await page.goto(`${server!.url}/${query}`);
      await page.waitForFunction(() => document.documentElement.dataset.studioState === "selection-unavailable");
      const text = await page.locator("body").innerText();
      expect(text).toContain("NEED:");
      expect(text).toContain(message);
      expect(errors).toContain(`${prefix} ${message}`);
      await writeFile(join(directory, `${++sequence}-browser-observations.json`), JSON.stringify({ query, text, errors }, null, 2));
    } finally { await page.close(); }
  }

  it("preserves the actual compiler exception in API, NEED and both logs; PROC-5 fails", async () => {
    const response = await fetch(`${server!.url}/api/config`);
    expect(response.status).toBe(200);
    const config = await response.json() as { selection: StudioSelection };
    expect(config.selection.message).toBe(compilerMessage);
    expect(config.selection.runtimeUrl).toBeUndefined();
    expect(logs).toHaveBeenCalledWith("Producer Designer selection failed:", compilerMessage);
    await writeFile(join(directory, "api-selection.json"), JSON.stringify(config.selection, null, 2));
    await visibleFault("?mode=selection", compilerMessage, "Studio Designer selection failed:");
    const report = await inspect("selection-fault", "?mode=selection");
    expect(report.status).toBe("FAIL");
    expect(report.exitCode).toBe(1);
    expect(report.findings.map(finding => finding.rule)).toContain("PAGE_NEED_MARKER");
    expect(report.findings.map(finding => finding.rule)).toContain("PAGE_CONSOLE_ERROR");
    expect(report.findings.some(finding => finding.rule === "PAGE_CONSOLE_ERROR" && finding.evidence?.includes(compilerMessage))).toBe(true);
  }, timeout);

  it("preserves render exceptions and passes again after the faulty fixture is corrected", async () => {
    const baseline = await inspect("render-baseline", "?mode=render");
    expect(baseline.status).toBe("PASS");
    await visibleFault("?mode=render&broken=1", renderMessage, "Studio Designer selection render failed:");
    const report = await inspect("render-fault", "?mode=render&broken=1");
    expect(report.status).toBe("FAIL");
    expect(report.exitCode).toBe(1);
    expect(report.findings.map(finding => finding.rule)).toContain("PAGE_NEED_MARKER");
    expect(report.findings.map(finding => finding.rule)).toContain("PAGE_CONSOLE_ERROR");
    const restored = await inspect("render-restored", "?mode=render");
    expect(restored).toMatchObject({ status: "PASS", exitCode: 0, findings: [] });
  }, timeout);
});
