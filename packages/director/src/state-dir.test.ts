import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STATE_DIR } from "./state-dir.js";
import { runStoreFile } from "./store.js";

const CONTRACT = fileURLToPath(new URL("../../../docs/contracts/consumer-layout.json", import.meta.url));

describe("Director's state folder (consumer-layout contract)", () => {
  it("is the contract's stateDir, and the run store lives in it", () => {
    const contract = JSON.parse(readFileSync(CONTRACT, "utf8")) as { stateDir: string };
    expect(STATE_DIR).toBe(contract.stateDir);
    expect(runStoreFile("check:pipeline")).toBe(`${contract.stateDir}/runs/check.pipeline.jsonl`);
  });
});
