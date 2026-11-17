import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentId } from "../records/types.js";
import { checkViews, checkViewText, pathReason, VIEWS_INPUTS_ONLY } from "./views-inputs-only.js";

/** The foundry repository root: its packages/<agent>/views/ are the shipped view prompts. */
const REPO = fileURLToPath(new URL("../../../..", import.meta.url));

/** The nine starter views (system.md 12.7). */
const STARTERS = [
  "director/roadmap-board",
  "designer/slot-compare", "designer/theme-board",
  "writer/copy-table",
  "publisher/directory-map", "publisher/page-preview", "publisher/release-manifest",
  "producer/ledger-runs", "producer/queue-inbox",
];

/** A structurally valid view prompt; each mutation below changes one part of it. */
function view(agent: AgentId, id: string, parts: { inputs?: string[]; appliesTo?: string; answers?: string; body?: string; rules?: boolean } = {}): string {
  const inputs = parts.inputs ?? [`clossys slot ${agent}/<slot-id> --json`];
  return [
    "---",
    "clossys:",
    "  schema: clossys.view/1",
    `  id: ${agent}/views/${id}`,
    `  agent: ${agent}`,
    "  kind: view",
    "  status: live",
    `  createdBy: { actor: package, package: "@clossys/${agent}", version: "1.0.0" }`,
    "  createdAt: 2026-11-14T00:00:00Z",
    `  appliesTo: ${parts.appliesTo ?? "[section]"}`,
    "  inputs:",
    ...inputs.map(input => `    - ${input}`),
    `  answers: ${parts.answers ?? "[queue.pick]"}`,
    "---",
    "",
    "# One slot",
    "",
    "## Purpose",
    "Show one slot to the owner.",
    "",
    "## Inputs",
    `1. \`clossys slot ${agent}/<slot-id> --json\`.`,
    "",
    "## Output shape",
    parts.body ?? "A table: candidate name, check status, `sha256` first 8. The ref `designer/themes.*` is a ref.",
    "",
    ...(parts.rules === false ? [] : [
      "## Rules",
      "- Read-only.",
      "- The answer goes back only through `clossys answer <queue-item> <answer> --by owner --via chat --quote \"<words>\"`.",
    ]),
    "",
  ].join("\n");
}

const findings = (text: string, agent: AgentId = "designer", viewId = "one-slot") => checkViewText("test", text, { agent, viewId });
const details = (text: string, agent: AgentId = "designer", viewId = "one-slot") => findings(text, agent, viewId).map(finding => finding.detail);

function world(): { root: string; put(rel: string, text: string): void } {
  const root = mkdtempSync(join(tmpdir(), "views-check-"));
  const put = (rel: string, text: string): void => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  put("clossys/clossys.config.ts", "export default {};\n");
  for (const agent of ["director", "designer", "writer", "publisher", "producer"]) mkdirSync(join(root, "packages", agent), { recursive: true });
  return { root, put };
}

describe(VIEWS_INPUTS_ONLY, () => {
  it("passes a view whose inputs are read verbs and whose body names refs only", () => {
    expect(details(view("designer", "one-slot"))).toEqual([]);
  });

  it("fails a body naming a file path under clossys/agents/", () => {
    const text = view("designer", "one-slot", { body: "Open clossys/agents/designer/sections.hero/pin.json and show it." });
    expect(details(text).join("\n")).toMatch(/the body names a file path \(clossys\/agents\/designer\/sections\.hero\/pin\.json\)/);
  });

  it("fails other paths, globs and raw reads in the body", () => {
    expect(details(view("designer", "one-slot", { body: "Look in `.clossys/checks/` first." })).join("\n")).toMatch(/file path/);
    expect(details(view("designer", "one-slot", { body: "Read node_modules/@clossys/designer/views." })).join("\n")).toMatch(/file path/);
    expect(details(view("designer", "one-slot", { body: "List every `*.json` file." })).join("\n")).toMatch(/path glob/);
    expect(details(view("designer", "one-slot", { body: "Run `cat slot.json`." })).join("\n")).toMatch(/raw file read \(cat slot\.json\)/);
    expect(details(view("designer", "one-slot", { body: "Use fs.readFileSync on it." })).join("\n")).toMatch(/raw file read/);
  });

  it("fails an input that is not one of the four read verbs", () => {
    expect(details(view("designer", "one-slot", { inputs: ["clossys pin designer/sections.hero hero-v2.json"] })).join("\n")).toMatch(/must start with clossys status, clossys slot, clossys render, clossys preview/);
    expect(details(view("designer", "one-slot", { inputs: ["clossys views list --json"] })).join("\n")).toMatch(/must start with/);
    expect(details(view("designer", "one-slot", { inputs: ["cat clossys/agents/designer/sections.hero/slot.json"] })).join("\n")).toMatch(/must start with/);
    expect(details(view("designer", "one-slot", { inputs: ["clossys slot designer/sections.hero --json", "clossys status --json"] }))).toEqual([]);
  });

  it("fails an input that names a file path even behind a read verb", () => {
    expect(details(view("designer", "one-slot", { inputs: ["clossys slot clossys/agents/designer/sections.hero --json"] })).join("\n")).toMatch(/input .* names a file path/);
  });

  it("fails a vendor or tool name in a prompt", () => {
    for (const name of ["Claude", "Codex", "Cursor", "ChatGPT", "OpenAI", "gpt-5"]) {
      expect(details(view("designer", "one-slot", { body: `Ask ${name} to draw the table.` })).join("\n")).toMatch(/names a coding tool, model or vendor/);
    }
  });

  it("fails a write verb run from the body", () => {
    expect(details(view("designer", "one-slot", { body: "Then run `clossys pin designer/sections.hero <candidate>`." })).join("\n")).toMatch(/runs clossys pin: a view is read-only/);
  });

  it("fails a missing ## Rules section", () => {
    expect(details(view("designer", "one-slot", { rules: false }))).toContain("the ## Rules section is missing");
  });

  it("fails appliesTo outside slot kinds, queue ids and refs, and answers outside the four queues", () => {
    expect(details(view("designer", "one-slot", { appliesTo: "[packages/designer]" })).join("\n")).toMatch(/appliesTo "packages\/designer" is not a slot kind/);
    expect(details(view("designer", "one-slot", { appliesTo: "[writer/*.copy, queue.fix, element/frame]" }))).toEqual([]);
    // The Publisher slot/2 kinds publication and release are slot kinds a view may apply to (foundry-build-0038).
    expect(details(view("designer", "one-slot", { appliesTo: "[publication, release, page]" }))).toEqual([]);
    expect(details(view("designer", "one-slot", { answers: "[queue.ship]" })).join("\n")).toMatch(/answers "queue\.ship" is not one of/);
  });

  it("fails a header whose id does not match the file", () => {
    expect(details(view("designer", "one-slot"), "writer", "one-slot").join("\n")).toMatch(/header id "designer\/views\/one-slot" must be writer\/views\/one-slot/);
  });

  it("tells refs and placeholders from paths", () => {
    for (const token of ["designer/themes.*", "writer/<slot-id>#<record>", "writer/sections.hero.copy/home.hero-v3.json", "<agent>/<slot-id>", "light/dark", "http://127.0.0.1:4600/", "queue.approve", "home.hero-v2.json"]) {
      expect(pathReason(token), token).toBeUndefined();
    }
    for (const token of ["clossys/agents/writer/views/copy-table.md", "./x", "~/code", "slot.json", "*.md", "a/b/c"]) {
      expect(pathReason(token), token).toBeDefined();
    }
  });

  it("checks package and consumer views alike", () => {
    const w = world();
    w.put("packages/designer/views/one-slot.md", view("designer", "one-slot"));
    w.put("clossys/agents/writer/views/one-slot.md", view("writer", "one-slot", { body: "Read clossys/agents/writer/views/x.md." }));
    const run = checkViews(w.root);
    expect(run.files).toBe(2);
    expect(run.status).toBe("fail");
    expect(run.findings.map(finding => finding.subject)).toEqual(["consumer writer views: writer/one-slot"]);
  });

  it("passes the nine shipped starter views", () => {
    const shipped = ["director", "designer", "writer", "publisher", "producer"].flatMap(agent => {
      const dir = join(REPO, "packages", agent, "views");
      return readdirSync(dir).filter(name => name.endsWith(".md")).map(name => `${agent}/${name.slice(0, -3)}`);
    });
    expect(shipped.sort()).toEqual([...STARTERS].sort());
    const run = checkViews(REPO, { consumer: false });
    expect(run.findings).toEqual([]);
    expect(run.files).toBe(9);
  });
});
