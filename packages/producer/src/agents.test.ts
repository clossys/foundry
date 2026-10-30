import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_PACKAGES, AgentResolutionError, resolveAgent } from "./agents.js";

describe("agent mapping", () => {
  it("keeps the four agent candidate lists in one table", () => {
    expect(AGENT_PACKAGES).toEqual({
      director: ["@clossys/director", "@clossys/strategist"],
      designer: ["@clossys/designer"],
      writer: ["@clossys/writer"],
      publisher: ["@clossys/publisher"],
    });
  });

  it("prefers Director when both Director and Strategist resolve", () => {
    const tried: string[] = [];
    const result = resolveAgent("director", (name) => {
      tried.push(name);
      return join("installed", name);
    });
    expect(result).toEqual({
      kind: "director",
      packageName: "@clossys/director",
      packageRoot: join("installed", "@clossys/director"),
    });
    expect(tried).toEqual(["@clossys/director"]);
  });

  it("tries Strategist only after Director is unavailable", () => {
    const tried: string[] = [];
    const result = resolveAgent("director", (name) => {
      tried.push(name);
      if (name === "@clossys/director") throw new Error("not installed");
      return join("installed", name);
    });
    expect(result.packageName).toBe("@clossys/strategist");
    expect(tried).toEqual(["@clossys/director", "@clossys/strategist"]);
  });

  it("resolves the workspace Strategist without requiring a package root export", () => {
    const result = resolveAgent("director");
    expect(result.packageName).toBe("@clossys/strategist");
    expect(JSON.parse(readFileSync(join(result.packageRoot, "package.json"), "utf8")).name)
      .toBe("@clossys/strategist");
  });

  it.each(["designer", "writer", "publisher"] as const)("resolves the installed %s manifest", (kind) => {
    const result = resolveAgent(kind);
    expect(result.packageName).toBe(AGENT_PACKAGES[kind][0]);
    expect(JSON.parse(readFileSync(join(result.packageRoot, "package.json"), "utf8")).name)
      .toBe(result.packageName);
  });

  it("reports exit 2 and every attempted package when none resolves", () => {
    let failure: unknown;
    try {
      resolveAgent("director", () => { throw new Error("not installed"); });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AgentResolutionError);
    expect(failure).toMatchObject({ exitCode: 2, tried: ["@clossys/director", "@clossys/strategist"] });
    expect((failure as Error).message).toContain("@clossys/director");
    expect((failure as Error).message).toContain("@clossys/strategist");
  });
});
