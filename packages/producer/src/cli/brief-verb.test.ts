// G3: `clossys brief` is a CLI verb (the runner dispatches it), so the loops' refine-brief step can write through it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runIaSyncCli } from "./ia-sync.js";
import { runCli } from "./main.js";
import { USAGE } from "./args.js";
import { LATER, tallyhouseWorld } from "../records/__fixtures__/slot2-workspace.js";

const HERO = "sections.hero.copy";
const HEADING = "contract.copy.fields[header.heading].maxLength.en";
const tighten = (value: string) => ["brief", `writer/${HERO}`, "--tighten", "--path", HEADING, "--op", "max", "--value", value, "--why", "owner feedback 20261118T0912Z-home-hero-copy", "--by", "owner:cli:clossys brief 2026-11-16T09:18:40Z", "--at", LATER];

describe("clossys brief (CLI)", () => {
  it("prints its usage and is listed in the CLI usage", async () => {
    const help = await runCli(["brief", "--help"], process.cwd());
    expect(help.exitCode).toBe(0);
    expect(help.message).toContain("clossys brief <agent>/<slot-id>");
    expect(USAGE).toContain("clossys brief <agent>/<slot>");
  });

  it("reads the resolved brief and appends a stricter tighten entry; a looser one is refused", async () => {
    const ws = tallyhouseWorld();
    await runIaSyncCli(["sync", "--at", LATER], ws.root);
    const shown = await runCli(["brief", `writer/${HERO}`, "--json", "--root", ws.root], ws.root);
    expect(shown.exitCode, shown.message).toBe(0);
    const before = ws.read("writer", HERO).tighten.length;
    const ok = await runCli([...tighten("48"), "--root", ws.root], ws.root);
    expect(ok.exitCode, ok.message).toBe(0);
    expect(ws.read("writer", HERO).tighten.length).toBe(before + 1);
    const bytes = readFileSync(ws.file("writer", HERO), "utf8");
    const loose = await runCli([...tighten("72"), "--root", ws.root], ws.root);
    expect(loose.exitCode).toBe(1);
    expect(loose.message).toContain("brief.tighten-only: refused");
    expect(readFileSync(ws.file("writer", HERO), "utf8")).toBe(bytes);
  });
});
