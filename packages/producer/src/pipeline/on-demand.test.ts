/**
 * An on-demand decide step (clossys retire) is never owed: it opens no item and counts nothing,
 * whether or not its outputs exist yet. Without the counter, an empty output set reads as open.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contextOf, openItems } from "./chain.js";
import { STEPS } from "./steps/index.js";
import type { Step } from "./define.js";

let root: string | undefined;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined; });

const retire = STEPS.find(step => step.id === "retire")!;

describe("an on-demand decide step", () => {
  it("is the retire step's counter", () => {
    expect(retire.open).toBe("on-demand");
  });

  it("opens nothing when none of its outputs exist; the same step without the counter would", () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "clossys-on-demand-")));
    mkdirSync(join(root, "clossys", "agents"), { recursive: true });
    const context = contextOf(root, STEPS);
    expect(openItems(retire, context)).toEqual([]);
    const owed: Step = { ...retire, open: undefined };
    expect(openItems(owed, context)).toEqual(["retire"]);
  });
});
