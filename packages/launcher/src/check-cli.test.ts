import { describe, expect, it } from "vitest";
import { CHECK_USAGE, checkMain, parseCheckArgs, parseObservation } from "./check-cli.js";

const satisfied = {
  cwd: { absolutePath: "/tmp/empty", empty: true, git: false, looksLikeFoundry: false },
  ownerCandidates: ["acme"],
  advisorVersion: "0.2.2",
  integratorVersion: "0.8.2",
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
  integratorVersion: "0.8.2",
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

  it("grades adopt only when the observation already has a populated inventory", () => {
    const files: Record<string, string> = {
      "/tmp/adopt.json": JSON.stringify({
        cwd: {
          absolutePath: "/tmp/central",
          empty: false,
          git: true,
          looksLikeFoundry: false,
          githubOwner: "acme",
          githubRepository: "central",
          inventory: { status: "populated", count: 2 },
        },
        ownerCandidates: ["acme"],
        advisorVersion: "0.2.2",
        integratorVersion: "0.8.2",
        ghAvailable: true,
        gitAvailable: true,
      }),
      "/tmp/adopt-empty.json": JSON.stringify({
        cwd: {
          absolutePath: "/tmp/central",
          empty: false,
          git: true,
          looksLikeFoundry: false,
          githubOwner: "acme",
          githubRepository: "central",
          inventory: { status: "missing", count: 0 },
        },
        ownerCandidates: ["acme"],
        advisorVersion: "0.2.2",
        integratorVersion: "0.8.2",
        ghAvailable: true,
        gitAvailable: true,
      }),
    };
    const read = (path: string) => {
      const body = files[path];
      if (body === undefined) throw new Error("missing");
      return body;
    };
    const out: string[] = [];
    expect(checkMain(["--input", "/tmp/adopt.json"], read, (text) => out.push(text), () => {})).toBe(0);
    expect(out[0]).toContain('"action":"adopt"');
    expect(checkMain(["--input", "/tmp/adopt-empty.json"], read, () => {}, () => {})).toBe(1);
  });

  it("maps unreadable input to a thrown input error for exit 2", () => {
    expect(() =>
      checkMain(["--input", "/tmp/missing.json"], () => {
        throw new Error("enoent");
      }, () => {}, () => {}),
    ).toThrow(/cannot read/);
    expect(() => parseObservation(null)).toThrow(/JSON object/);
  });

  it("grades an existing-hub observation as resume by forwarding cwd.hub", () => {
    const files: Record<string, string> = {
      "/tmp/hub.json": JSON.stringify({
        cwd: {
          absolutePath: "/tmp/central",
          empty: false,
          git: true,
          looksLikeFoundry: false,
          githubOwner: "acme",
          githubRepository: "central",
          hub: { schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/central" },
        },
        ownerCandidates: ["acme"],
        advisorVersion: "0.2.2",
        integratorVersion: "0.8.2",
        ghAvailable: true,
        gitAvailable: true,
      }),
      "/tmp/bad-hub.json": JSON.stringify({
        cwd: {
          absolutePath: "/tmp/central",
          empty: false,
          git: true,
          looksLikeFoundry: false,
          hub: { schemaVersion: 2, kind: "account-hub", owner: "acme", repository: "acme/central" },
        },
        ownerCandidates: ["acme"],
        ghAvailable: true,
        gitAvailable: true,
      }),
    };
    const read = (path: string) => {
      const body = files[path];
      if (body === undefined) throw new Error("missing");
      return body;
    };
    const out: string[] = [];
    expect(checkMain(["--input", "/tmp/hub.json"], read, (text) => out.push(text), () => {})).toBe(0);
    expect(out[0]).toContain('"action":"resume"');
    expect(() => checkMain(["--input", "/tmp/bad-hub.json"], read, () => {}, () => {})).toThrow(/account-hub marker/);
  });
});
