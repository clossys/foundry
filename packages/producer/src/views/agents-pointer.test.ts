import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runInitCli } from "../cli/init.js";
import { TOOL_NAMES } from "../check/views-inputs-only.js";
import { AGENTS_POINTER, ensureAgentsPointer, POINTER_START } from "./agents-pointer.js";

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "views-init-"));
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  return root;
}

const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe("clossys init: the AGENTS.md views pointer", () => {
  it("creates AGENTS.md with the pointer when it is missing", async () => {
    const root = workspace();
    const result = await runInitCli([], root);
    expect(result.exitCode).toBe(0);
    expect(result.output).toEqual({ file: join(root, "AGENTS.md"), outcome: "added" });
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(`${AGENTS_POINTER}\n`);
  });

  it("appends once to an existing AGENTS.md and keeps what was there", async () => {
    const root = workspace();
    writeFileSync(join(root, "AGENTS.md"), "# Repository rules\n\nKeep commits small.");
    expect(ensureAgentsPointer(root).outcome).toBe("added");
    expect((await runInitCli(["--root", root], join(root, "clossys"))).output).toEqual({ file: join(root, "AGENTS.md"), outcome: "present" });
    expect(ensureAgentsPointer(root).outcome).toBe("present");
    const text = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(text.startsWith("# Repository rules\n\nKeep commits small.\n\n")).toBe(true);
    expect(count(text, POINTER_START)).toBe(1);
  });

  it("is agent-neutral and names the discovery and answer verbs", () => {
    expect(TOOL_NAMES.test(AGENTS_POINTER)).toBe(false);
    for (const verb of ["clossys views list", "clossys views show <id>", "clossys answer"]) expect(AGENTS_POINTER).toContain(verb);
  });
});
