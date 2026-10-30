import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PageLintReport } from "./page-types.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const timeout = 180_000;
const baselineBody = "<h1>Example</h1><p>Welcome to this practical guide. Need help? Read the examples below.</p>";
const document = (body: string, script = ""): string => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Example</title><link rel="icon" href="data:,"></head><body>${body}${script ? `<script>${script}</script>` : ""}</body></html>`;
const baseline = document(baselineBody);

interface Invocation {
  code: number | null;
  result: { exitCode: number; report?: PageLintReport; reportPath?: string; message?: string };
  stdout: string;
  stderr: string;
}

describe.sequential("PROC-5 real browser through the built CLI", () => {
  let server: Server | undefined;
  let fixtureRoot: string;
  let origin: string;
  let sourceHead: string;
  let html = baseline;
  let documentStatus = 200;
  let requests = 0;
  let sequence = 0;

  beforeAll(async () => {
    // Keep all manifests, served documents, reports, and process transcripts for review.
    fixtureRoot = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "producer-proc5-"));
    const receipt = JSON.parse(readFileSync(join(packageRoot, "dist/check/source-receipt.json"), "utf8"));
    expect(receipt, "Build Producer from a clean source tree before running this native CLI proof.")
      .toMatchObject({ schemaVersion: 1, sourceDirty: false });
    expect(receipt.sourceHead).toMatch(/^[a-f0-9]{40}$/);
    sourceHead = receipt.sourceHead;
    writeFileSync(join(fixtureRoot, "baseline.html"), baseline);
    server = createServer((request, response) => {
      requests += 1;
      if (request.url === "/dropped-request" || request.url === "/unreachable") {
        request.socket.destroy();
        return;
      }
      if (request.url === "/missing.svg") {
        response.writeHead(404, { "content-type": "image/svg+xml" });
        response.end();
        return;
      }
      if (request.url === "/favicon.ico") {
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.url !== "/page") {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("Missing fixture route");
        return;
      }
      response.writeHead(documentStatus, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(html);
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The owned loopback fixture did not acquire an ephemeral TCP port.");
    origin = `http://127.0.0.1:${address.port}`;
  }, timeout);

  afterAll(async () => {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    }
  }, timeout);

  function manifest(url = `${origin}/page`): Record<string, unknown> {
    return { schemaVersion: 1, sourceHead, pages: [{ url, cellIds: ["tokens.color.accent"] }] };
  }

  async function invoke(label: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<Invocation> {
    const child = spawn(process.execPath, [join(packageRoot, "dist/cli/index.js"), "check", ...args, "--json"], {
      cwd: packageRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", part => { stdout += part; });
    child.stderr.on("data", part => { stderr += part; });
    // Async spawn is essential: this process must keep serving the browser's HTTP requests.
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 45_000);
    let code: number | null, signal: NodeJS.Signals | null;
    try {
      [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (exitCode, exitSignal) => resolve([exitCode, exitSignal]));
      });
    } finally {
      clearTimeout(timer);
    }
    writeFileSync(join(fixtureRoot, `${label}.process.json`), JSON.stringify({ args, code, signal, timedOut, stdout, stderr }, null, 2));
    expect(timedOut, `CLI timed out; retained evidence: ${fixtureRoot}`).toBe(false);
    expect(signal, stderr).toBeNull();
    const lines = stdout.trim().split(/\r?\n/);
    expect(lines, `Expected exactly one CLI JSON result. stderr: ${stderr}`).toHaveLength(1);
    const result = JSON.parse(lines[0]!) as Invocation["result"];
    expect(result.exitCode, stderr).toBe(code);
    return { code, result, stdout, stderr };
  }

  async function check(
    label: string,
    input: Record<string, unknown> = manifest(),
    options: { env?: NodeJS.ProcessEnv; verifySource?: boolean } = {},
  ): Promise<Invocation & { report: PageLintReport }> {
    const name = `${String(++sequence).padStart(3, "0")}-${label}`;
    const inputPath = join(fixtureRoot, `${name}.manifest.json`);
    const reportPath = join(fixtureRoot, `${name}.report.json`);
    writeFileSync(inputPath, JSON.stringify(input, null, 2));
    writeFileSync(join(fixtureRoot, `${name}.html`), html);
    const invocation = await invoke(name, ["--pages", inputPath, "--report", reportPath], options.env);
    expect(invocation.result.reportPath).toBe(reportPath);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as PageLintReport;
    expect(invocation.result.report).toEqual(report);
    expect(report).toMatchObject({ schemaVersion: 1, gate: "PROC-5", exitCode: invocation.code });
    if (options.verifySource !== false) expect(report).toMatchObject({ sourceHead, sourceDirty: false });
    expect(report.status).toBe(invocation.code === 0 ? "PASS" : invocation.code === 1 ? "FAIL" : "ERROR");
    return { ...invocation, report };
  }

  async function expectBaseline(label: string): Promise<void> {
    html = baseline;
    documentStatus = 200;
    const before = requests;
    const result = await check(label);
    expect(result.code, `Native Playwright and a usable headless browser are required; install/provision them before this proof and set CHROMIUM_PATH when needed. ${result.stdout} ${result.stderr}`).toBe(0);
    expect(requests).toBeGreaterThan(before);
    expect(result.report.findings).toEqual([]);
    expect(result.report.pages).toEqual([{ url: `${origin}/page`, inspected: true, findings: [] }]);
  }

  it("observes a clean human-readable page in a native browser", async () => {
    await expectBaseline("initial-baseline");
  }, timeout);

  it("ignores hidden source disclosure, engine markers, and provenance attributes", async () => {
    html = document(`${baselineBody}
      <section data-cell-id="tokens.color.accent"><p>Explore the examples.</p></section>
      <details><summary>Source disclosure</summary><pre>NEED: registered specimen tokens.color.accent [fact: pending] TODO-OWNER</pre></details>
      <div hidden><h2>NEED: hidden engine heading</h2><p>tokens.color.accent [fact: pending] TODO-OWNER</p></div>
      <div style="display:none"><h2> </h2><p>NEED: hidden engine details</p></div>
      <h2 aria-hidden="true"> </h2>`);
    try {
      const before = requests;
      const result = await check("hidden-source-and-provenance");
      expect(requests).toBeGreaterThan(before);
      expect(result.code, result.stdout).toBe(0);
      expect(result.report.findings).toEqual([]);
      expect(result.report.pages).toEqual([{ url: `${origin}/page`, inspected: true, findings: [] }]);
    } finally {
      await expectBaseline("restored-after-hidden-source");
    }
  }, timeout);

  const mutations: { name: string; rule: string; body?: string; script?: string; status?: number }[] = [
    { name: "need-specimen", rule: "PAGE_NEED_MARKER", body: "<p>NEED: registered specimen</p>" },
    { name: "raw-technical-id", rule: "PAGE_TECHNICAL_ID", body: "<p>tokens.color.accent</p>" },
    { name: "fact-marker", rule: "PAGE_FACT_MARKER", body: "<p>[fact: pending]</p>" },
    { name: "owner-marker", rule: "PAGE_TODO_OWNER", body: "<p>TODO-OWNER</p>" },
    { name: "empty-heading", rule: "PAGE_EMPTY_HEADING", body: "<h2> \n\t </h2>" },
    { name: "broken-image", rule: "PAGE_BROKEN_IMAGE", body: '<img src="/missing.svg" alt="Example illustration">' },
    { name: "document-http-404", rule: "PAGE_HTTP_ERROR", status: 404 },
    { name: "console-error", rule: "PAGE_CONSOLE_ERROR", script: 'console.error("Fixture console failure")' },
    { name: "runtime-throw", rule: "PAGE_RUNTIME_ERROR", script: 'throw new Error("Fixture runtime failure")' },
    { name: "failed-request", rule: "PAGE_REQUEST_FAILED", script: 'fetch("/dropped-request").catch(() => {})' },
  ];

  it.each(mutations)("rejects $name and passes again after restoration", async mutation => {
    html = document(baselineBody + (mutation.body ?? ""), mutation.script);
    documentStatus = mutation.status ?? 200;
    try {
      const before = requests;
      const result = await check(mutation.name);
      expect(requests).toBeGreaterThan(before);
      expect(result.code, result.stdout).toBe(1);
      expect(result.report.status).toBe("FAIL");
      expect(result.report.pages).toHaveLength(1);
      expect(result.report.pages[0]!.inspected).toBe(true);
      expect(result.report.pages[0]!.findings.map(finding => finding.rule)).toContain(mutation.rule);
      expect(result.report.findings.map(finding => finding.rule)).toContain(mutation.rule);
    } finally {
      await expectBaseline(`restored-${mutation.name}`);
    }
  }, timeout);

  it("fails closed for empty, malformed, stale, and unreachable targets", async () => {
    const staleHead = `${sourceHead[0] === "0" ? "1" : "0"}${sourceHead.slice(1)}`;
    const invalid: [string, Record<string, unknown>][] = [
      ["empty-pages", { ...manifest(), pages: [] }],
      ["missing-pages", { schemaVersion: 1, sourceHead }],
      ["stale-head", { ...manifest(), sourceHead: staleHead }],
      ["invalid-url", manifest("not a URL")],
      // Validation must reject this numeric nonloopback URL before any navigation or DNS.
      ["nonloopback-url", manifest("http://192.0.2.1/page")],
      ["unreachable-target", manifest(`${origin}/unreachable`)],
    ];
    for (const [label, input] of invalid) {
      const before = requests;
      const result = await check(label, input);
      expect(result.code, `${label}: ${result.stdout}`).toBe(2);
      expect(result.report.status).toBe("ERROR");
      expect(result.report.findings.length).toBeGreaterThan(0);
      if (label !== "unreachable-target") expect(requests).toBe(before);
    }
    await expectBaseline("restored-after-invalid-targets");
  }, timeout);

  it("requires both explicit manifest and report paths and rejects a missing manifest file", async () => {
    const inputPath = join(fixtureRoot, "required-paths.manifest.json");
    const reportPath = join(fixtureRoot, "missing-manifest.report.json");
    writeFileSync(inputPath, JSON.stringify(manifest()));
    for (const [label, args] of [
      ["missing-pages-flag", ["--report", reportPath]],
      ["missing-report-flag", ["--pages", inputPath]],
      ["missing-manifest-file", ["--pages", join(fixtureRoot, "absent.manifest.json"), "--report", reportPath]],
    ] as const) {
      const before = requests;
      const result = await invoke(label, [...args]);
      expect(result.code, result.stdout).toBe(2);
      expect(result.result.report?.status ?? "ERROR").toBe("ERROR");
      expect(requests).toBe(before);
    }
    await expectBaseline("final-baseline");
  }, timeout);

  it("fails closed when the configured native browser executable is unavailable", async () => {
    const before = requests;
    try {
      const result = await check("missing-browser-binary", manifest(), {
        env: { ...process.env, CHROMIUM_PATH: join(fixtureRoot, "absent-browser-binary") },
      });
      expect(result.code, result.stdout).toBe(2);
      expect(result.report.status).toBe("ERROR");
      expect(result.report.findings.length).toBeGreaterThan(0);
      expect(result.report.pages.every(page => !page.inspected)).toBe(true);
      expect(requests).toBe(before);
    } finally {
      await expectBaseline("restored-after-missing-browser");
    }
  }, timeout);

  it.each(["missing", "dirty", "malformed", "invalid-json"] as const)("fails closed for a %s native source receipt and restores its exact bytes", async mutation => {
    const receiptPath = join(packageRoot, "dist/check/source-receipt.json");
    const original = readFileSync(receiptPath);
    writeFileSync(join(fixtureRoot, `${mutation}-receipt.backup.json`), original);
    const before = requests;
    try {
      if (mutation === "missing") {
        renameSync(receiptPath, join(fixtureRoot, "missing-receipt.displaced.json"));
      } else {
        const receipt = JSON.parse(original.toString("utf8"));
        const changed = mutation === "dirty"
          ? JSON.stringify({ ...receipt, sourceDirty: true })
          : mutation === "malformed" ? JSON.stringify({ ...receipt, sourceHead: "invalid" }) : "{";
        writeFileSync(receiptPath, changed);
        writeFileSync(join(fixtureRoot, `${mutation}-receipt.mutated.json`), changed);
      }
      const result = await check(`${mutation}-source-receipt`, manifest(), { verifySource: false });
      expect(result.code, result.stdout).toBe(2);
      expect(result.report.status).toBe("ERROR");
      expect(result.report.findings.length).toBeGreaterThan(0);
      expect(result.report.pages).toEqual([]);
      expect(requests).toBe(before);
    } finally {
      writeFileSync(receiptPath, original);
      expect(readFileSync(receiptPath)).toEqual(original);
      await expectBaseline(`restored-after-${mutation}-receipt`);
    }
  }, timeout);
});
