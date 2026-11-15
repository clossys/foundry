import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runViewsCli } from "../cli/views.js";
import { CliUsageError } from "../cli/args.js";
import { listViews, showView, ViewNotFoundError, ViewRefError, type ViewsList } from "./catalog.js";

const REPO = fileURLToPath(new URL("../../../..", import.meta.url));

const header = (agent: string, id: string, appliesTo: string, by: string) => [
  "---", "clossys:", "  schema: clossys.view/1", `  id: ${agent}/views/${id}`, `  agent: ${agent}`, "  kind: view", "  status: live",
  `  createdBy: ${by}`, "  createdAt: 2026-11-14T00:00:00Z", `  appliesTo: ${appliesTo}`, "  inputs:", "    - clossys status --json", "  answers: []", "---", "",
].join("\n");

/** A temp workspace: package views under packages/ (read there, as in the foundry repository) and a consumer clossys/. */
function world() {
  const root = mkdtempSync(join(tmpdir(), "views-catalog-"));
  const put = (rel: string, text: string): void => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  put("clossys/clossys.config.ts", "export default {};\n");
  put("packages/designer/views/slot-compare.md", `${header("designer", "slot-compare", "[section]", '{ actor: package, package: "@clossys/designer", version: "1.0.0" }')}# Package compare\n`);
  put("packages/producer/views/queue-inbox.md", `${header("producer", "queue-inbox", "[queue.fix]", '{ actor: package, package: "@clossys/producer", version: "1.0.0" }')}# Package inbox\n`);
  return { root, put };
}

const consumerShadow = (id: string) => `${header("designer", id, "[section, frame]", "{ actor: owner, ref: chat }")}# Consumer compare\n`;

describe("clossys views list", () => {
  it("lists package views with agent, appliesTo and answers", () => {
    const w = world();
    const list = listViews({ packageRoot: w.root, consumerRoot: w.root });
    expect(list.views.map(view => [view.id, view.source, view.shadowsPackage, view.title, view.appliesTo])).toEqual([
      ["designer/slot-compare", "package", false, "Package compare", ["section"]],
      ["producer/queue-inbox", "package", false, "Package inbox", ["queue.fix"]],
    ]);
  });

  it("marks a consumer file that shadows a package file, and lists consumer-only views", () => {
    const w = world();
    w.put("clossys/agents/designer/views/slot-compare.md", consumerShadow("slot-compare"));
    w.put("clossys/agents/designer/views/frame-board.md", consumerShadow("frame-board"));
    const list = listViews({ packageRoot: w.root, consumerRoot: w.root });
    expect(list.views.filter(view => view.agent === "designer").map(view => [view.id, view.source, view.shadowsPackage, view.appliesTo])).toEqual([
      ["designer/frame-board", "consumer", false, ["section", "frame"]],
      ["designer/slot-compare", "consumer", true, ["section", "frame"]],
    ]);
  });

  it("runs as clossys views list --json from inside the workspace", async () => {
    const w = world();
    w.put("clossys/agents/designer/views/slot-compare.md", consumerShadow("slot-compare"));
    const result = await runViewsCli(["list", "--json"], join(w.root, "clossys"), w.root);
    expect(result.exitCode).toBe(0);
    const output = result.output as ViewsList;
    expect(output.schema).toBe("clossys.views-list/1");
    expect(output.workspace).toBe(w.root);
    expect(output.views.find(view => view.id === "designer/slot-compare")?.shadowsPackage).toBe(true);
  });

  it("lists the nine shipped views from the foundry repository", () => {
    const list = listViews({ packageRoot: REPO });
    expect(list.views.map(view => view.id)).toEqual([
      "director/roadmap-board", "designer/slot-compare", "designer/theme-board", "writer/copy-table",
      "publisher/directory-map", "publisher/page-preview", "publisher/release-manifest", "producer/ledger-runs", "producer/queue-inbox",
    ]);
    expect(list.views.every(view => view.source === "package" && !view.invalid && view.title)).toBe(true);
  });
});

describe("clossys views show", () => {
  it("returns the package file when no consumer file shadows it", () => {
    const w = world();
    const view = showView({ packageRoot: w.root, consumerRoot: w.root }, "designer/slot-compare");
    expect([view.source, view.shadowsPackage]).toEqual(["package", false]);
    expect(view.text).toContain("# Package compare");
  });

  it("returns the consumer file when it shadows the package file", async () => {
    const w = world();
    w.put("clossys/agents/designer/views/slot-compare.md", consumerShadow("slot-compare"));
    const view = showView({ packageRoot: w.root, consumerRoot: w.root }, "designer/slot-compare");
    expect([view.source, view.shadowsPackage]).toEqual(["consumer", true]);
    expect(view.text).toContain("# Consumer compare");
    expect(view.text).not.toContain("# Package compare");
    const result = await runViewsCli(["show", "designer/views/slot-compare", "--root", w.root], w.root, w.root);
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("# Consumer compare");
  });

  it("refuses an unknown view (exit 1) and a malformed id (usage)", async () => {
    const w = world();
    expect(() => showView({ packageRoot: w.root, consumerRoot: w.root }, "writer/copy-table")).toThrow(ViewNotFoundError);
    expect(() => showView({ packageRoot: w.root }, "studio/board")).toThrow(ViewRefError);
    expect((await runViewsCli(["show", "writer/copy-table"], w.root, w.root)).exitCode).toBe(1);
    await expect(runViewsCli(["show", "copy-table"], w.root, w.root)).rejects.toThrow(CliUsageError);
    await expect(runViewsCli(["pin"], w.root, w.root)).rejects.toThrow(CliUsageError);
  });

  it("reads package views only when there is no workspace", () => {
    const w = world();
    w.put("clossys/agents/designer/views/slot-compare.md", consumerShadow("slot-compare"));
    expect(showView({ packageRoot: w.root }, "designer/slot-compare").source).toBe("package");
  });
});
