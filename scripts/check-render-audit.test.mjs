import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs, recordFindings, RENDER_TEXT, skillFindings } from "./check-render-audit.mjs";

const SCRIPT = fileURLToPath(new URL("./check-render-audit.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./rules/fixtures/R-RENDER-AUDIT/", import.meta.url));
const route = { path: "/", url: "http://127.0.0.1:1/", viewport: "1280x800", captured: true, findings: 0 };
const finding = { rule: "RENDER_EMPTY_ICON", route: "/", viewport: "1280x800", slot: "designer/sections.hero", agent: "designer", selector: "x", message: "m" };
const rec = (extra = {}) => ({ schema: "clossys.render-check/1", verdict: "PASS", ran: { commands: 1, missing: [] }, routes: [route], findings: [], line: "RENDER: PASS 1/1 capture(s) 0 finding(s)", ...extra });
const cli = (...argv) => spawnSync(process.execPath, [SCRIPT, ...argv], { encoding: "utf8" });

test("the repository's Reviewer skill states the render rule verbatim", () => {
  assert.deepEqual(skillFindings(ROOT), []);
  assert.match(RENDER_TEXT, /clossys check --render/);
});

test("a PASS render record holds only when it captured something, missed nothing and found nothing", () => {
  assert.deepEqual(recordFindings(rec()), []);
  assert.equal(recordFindings(rec({ ran: { commands: 0, missing: [] } }))[0].rule, "pass-on-nothing");
  assert.equal(recordFindings(rec({ routes: [{ ...route, captured: false }] }))[0].rule, "pass-on-nothing");
  assert.equal(recordFindings(rec({ ran: { commands: 1, missing: ["a browser"] } }))[0].rule, "pass-on-missing");
  assert.equal(recordFindings(rec({ findings: [finding] }))[0].rule, "pass-with-findings");
  const failing = { verdict: "FAIL", line: "RENDER: FAIL 1/1 capture(s) 1 finding(s)" };
  assert.deepEqual(recordFindings(rec({ ...failing, findings: [finding] })), []);
  assert.deepEqual(recordFindings(rec({ ...failing, findings: [{ ...finding, slot: null, agent: "publisher" }] })), []);
  for (const broken of [{ ...finding, slot: undefined }, { rule: "RENDER_GLYPH", agent: "writer" }, { ...finding, agent: "" }, { ...finding, slot: "button" }]) {
    assert.equal(recordFindings(rec({ ...failing, findings: [broken] }))[0].rule, "unattributed-finding");
  }
  for (const broken of [{}, null, rec({ verdict: undefined }), rec({ line: "RENDER: FAIL 1/1" }), rec({ schema: "clossys.review/1" })]) assert.equal(recordFindings(broken)[0].rule, "no-verdict");
});

test("the CLI exits 1 on each violation fixture and 2 on a usage error", () => {
  assert.equal(cli("--root", `${FIXTURES}skill`).status, 1);
  assert.match(cli("--root", `${FIXTURES}record`, "--record", `${FIXTURES}record/render-pass-zero.json`).stdout, /^pass-on-nothing\s/m);
  assert.match(cli("--root", `${FIXTURES}record`, "--record", `${FIXTURES}record/render-unattributed.json`).stdout, /^unattributed-finding\s/m);
  assert.equal(cli("--root", `${FIXTURES}record`).status, 0);
  assert.equal(cli("--bogus").status, 2);
  assert.throws(() => parseArgs(["--record"]), /needs a value/);
});
