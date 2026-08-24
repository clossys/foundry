import { describe, expect, it } from "vitest";
import { main } from "./completion-evidence-cli.js";

describe("foundry-completion-evidence-check", () => {
  it("rejects incomplete arguments without reading anything", () => {
    expect(main([])).toBe(2);
    expect(main(["evidence.json"])).toBe(2);
  });
});
