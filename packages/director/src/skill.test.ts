import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { READ_COMMANDS } from "./cli/read.js";

const skill = readFileSync(new URL("../skill/SKILL.md", import.meta.url), "utf8");
const section = (heading: string) => {
  const start = skill.indexOf(`\n## ${heading}\n`);
  expect(start, heading).toBeGreaterThan(-1);
  const rest = skill.slice(start + heading.length + 5);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
};

describe("Director interview skill", () => {
  it("names only Director check commands the CLI has", () => {
    const named = [...skill.matchAll(/clossys director check ([a-z-]+)/g)].map(match => match[1]!);
    expect(named.length).toBeGreaterThan(0);
    for (const command of named) expect([...READ_COMMANDS, "review", "archetype", "judge"], command).toContain(command);
  });

  it("asks one question per turn with a multiple-choice control on Claude and numbered options on Codex", () => {
    const ask = section("How you ask");
    expect(ask).toMatch(/One question per turn/);
    expect(ask).toMatch(/Hypothesis-first/);
    expect(ask).toMatch(/`AskUserQuestion`/);
    expect(ask).toMatch(/\*\*Codex\*\*[\s\S]*numbered/);
  });

  it("records owner words verbatim and pins only an explicit yes as an owner pick", () => {
    expect(section("Owner words are evidence")).toMatch(/verbatim[\s\S]*source: user[\s\S]*Informs:/);
    const loop = section("Loop");
    expect(loop).toMatch(/Pin only on an explicit yes/);
    expect(loop).toContain("npx clossys pin director/<id> <name>-v<N> --by owner --basis picked");
    expect(skill).not.toMatch(/--basis (?:bulk|planner|agent)\b/);
  });

  it("stops on the completion check, then compiles every brief and checks its handoff", () => {
    const done = section("Done when");
    expect(done).toContain("npx clossys director check complete --level mvs --archetype <name>");
    expect(done).toMatch(/exits 0/);
    expect(done).toContain("npx clossys director check brief <contract> --write");
    expect(done).toContain("npx clossys director check handoff <contract>");
    for (const contract of ["designer.identity", "writer.messaging", "publisher.launch", "customer.persona"]) expect(done).toContain(contract);
  });

  it("states downstream change control: a pin stales briefs, recompiling is explicit, re-runs wait for the owner", () => {
    const downstream = section("Downstream changes");
    expect(downstream).toMatch(/makes that\s+brief stale/);
    expect(downstream).toMatch(/Recompiling is explicit/);
    expect(downstream).toMatch(/only on the owner's\s+go/);
  });

  it("records the critic's verdict as a judgement finding bound to pinned versions", () => {
    const critic = section("Pre-mortem and judged checks");
    expect(critic).toMatch(/fresh-context helper/);
    expect(critic).toMatch(/judge: C4/);
    expect(critic).toMatch(/a new pin voids it/);
    expect(critic).toContain("npx clossys director check judge C4 --verdict pass|fail --heard");
    expect(critic).toMatch(/never write or\s+edit that file by hand/);
  });
});
