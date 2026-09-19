import { describe, expect, it } from "vitest";
import { CHECK_USAGE, checkMain, parseCheckArgs, parseObservation } from "./check-cli.js";

const satisfied = {
  cwd: { absolutePath: "/tmp/empty", empty: true, git: false, looksLikeFoundry: false },
  ownerCandidates: ["acme"],
  advisorVersion: "0.2.2",
  ghAvailable: true,
  gitAvailable: true,
};

const violated = {
  cwd: { absolutePath: "/tmp/foundry", empty: false, git: true, looksLikeFoundry: true },
  ownerCandidates: ["acme"],
  ghAvailable: true,
  gitAvailable: true,
};

const indeterminate = {
  cwd: { absolutePath: "/tmp/empty", empty: true, git: false, looksLikeFoundry: false },
  ownerCandidates: [],
  advisorVersion: "0.2.2",
  ghAvailable: true,
  gitAvailable: true,
};

describe("launcher-check", () => {
  it("prints usage on --help and on no arguments", () => {
    expect(parseCheckArgs([])).toEqual({ help: true });
    const out: string[] = [];
    expect(checkMain(["--help"], () => "", (text) => out.push(text), () => {})).toBe(0);
    expect(out[0]).toContain(CHECK_USAGE);
  });

  it("grades a create plan, a Foundry-tree refusal, and a missing-owner refusal", () => {
    const files: Record<string, string> = {
      "/tmp/satisfied.json": JSON.stringify(satisfied),
      "/tmp/violated.json": JSON.stringify(violated),
      "/tmp/indeterminate.json": JSON.stringify(indeterminate),
    };
    const read = (path: string) => {
      const body = files[path];
      if (body === undefined) throw new Error("missing");
      return body;
    };
    const out: string[] = [];
    expect(checkMain(["--input", "/tmp/satisfied.json"], read, (text) => out.push(text), () => {})).toBe(0);
    expect(out[0]).toContain('"action":"create"');
    expect(checkMain(["--input", "/tmp/violated.json"], read, () => {}, () => {})).toBe(1);
    expect(checkMain(["--input", "/tmp/indeterminate.json"], read, () => {}, () => {})).toBe(2);
  });

  it("maps unreadable input to a thrown input error for exit 2", () => {
    expect(() =>
      checkMain(["--input", "/tmp/missing.json"], () => {
        throw new Error("enoent");
      }, () => {}, () => {}),
    ).toThrow(/cannot read/);
    expect(() => parseObservation(null)).toThrow(/JSON object/);
  });
});
