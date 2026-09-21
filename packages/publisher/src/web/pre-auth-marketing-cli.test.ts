import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreAuthMarketingCliInputError, main } from "./pre-auth-marketing-cli.js";

const fixturePath = fileURLToPath(new URL("./fixtures/pre-auth-marketing.surface.json", import.meta.url));

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "publisher-pre-auth-check-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("publisher-pre-auth-check", () => {
  it("exits 0 on the shipped fixture and 1 when SectionedView is substituted", () => {
    expect(main([fixturePath])).toBe(0);
    const bad = join(root, "sectioned.json");
    const doc = JSON.parse(readFileSync(fixturePath, "utf8"));
    doc.template = "SectionedView";
    writeFileSync(bad, JSON.stringify(doc));
    expect(main([bad])).toBe(1);
  });

  it("uses exit-2 input semantics", () => {
    expect(() => main([])).toThrow(PreAuthMarketingCliInputError);
    expect(main(["--help"])).toBe(0);
  });
});
