/**
 * P-8: no core module reads a browser global at module scope or imports an
 * adapter; a legacy record parses only with `policy.legacy`, takes
 * `assumedPolicyVersion`, keeps its original expiry, never carries
 * `gpcOverride` and is never rewritten. Covers C-2, C-10.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addCalendarMonthsUtc } from "../calendar-months.js";
import { DAY, HOUR, POLICY, T0, at, flush, harness, legacyRecord, plusMs } from "./fixtures.test.js";
import { parseStoredChoice, type ConsentPolicy } from "./record.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const BROWSER_GLOBALS = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "location",
  "addEventListener",
  "fetch",
] as const;

/** Static loaders, so every module is named literally in an import the bundler can see. */
const MODULE_LOADERS: Record<string, () => Promise<Record<string, unknown>>> = {
  "./record.js": () => import("./record.js"),
  "./decision.js": () => import("./decision.js"),
  "./lifecycle.js": () => import("./lifecycle.js"),
  "./index.js": () => import("./index.js"),
  "./adapters/local-storage.js": () => import("./adapters/local-storage.js"),
};

describe("no module touches a browser global at module scope (C-2)", () => {
  const saved = new Map<string, PropertyDescriptor | undefined>();

  afterEach(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor === undefined) {
        delete (globalThis as Record<string, unknown>)[name];
      } else {
        Object.defineProperty(globalThis, name, descriptor);
      }
    }
    saved.clear();
  });

  function trapGlobals(touched: string[]): void {
    for (const name of BROWSER_GLOBALS) {
      saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          touched.push(name);
          return undefined;
        },
      });
    }
  }

  for (const [specifier, load] of Object.entries(MODULE_LOADERS)) {
    it(`evaluating ${specifier} reads no browser global`, async () => {
      const touched: string[] = [];
      vi.resetModules();
      trapGlobals(touched);
      const loaded = await load();
      expect(Object.keys(loaded).length).toBeGreaterThan(0);
      expect(touched).toEqual([]);
    });
  }

  it("constructing the adapter reads no global; only its functions do", async () => {
    const touched: string[] = [];
    vi.resetModules();
    const { createLocalStorageConsentPort } = await import("./adapters/local-storage.js");
    trapGlobals(touched);
    const port = createLocalStorageConsentPort({ key: "consent" });
    expect(touched).toEqual([]);
    expect(port.read()).toEqual({ kind: "unavailable" });
    expect(touched).toContain("localStorage");
  });
});

/** Relative import specifiers of one source file, resolved to paths. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers = [...source.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map(
    (match) => match[1] ?? match[2] ?? "",
  );
  return specifiers.map((specifier) =>
    specifier.startsWith(".") ? resolve(dirname(file), specifier.replace(/\.js$/, ".ts")) : specifier,
  );
}

describe("no core module imports an adapter (C-2)", () => {
  const coreFiles = readdirSync(HERE)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => join(HERE, name));

  it("finds the core modules", () => {
    expect(coreFiles.map((file) => relative(HERE, file)).sort()).toEqual([
      "decision.ts",
      "index.ts",
      "lifecycle.ts",
      "record.ts",
    ]);
  });

  it("the core import closure never reaches adapters/ and stays inside the package source", () => {
    const seen = new Set<string>();
    const queue = [...coreFiles];
    while (queue.length > 0) {
      const file = queue.shift()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const target of importsOf(file)) {
        expect(target.startsWith("/"), `${relative(HERE, file)} imports the bare specifier ${target}`).toBe(true);
        expect(relative(HERE, target).startsWith("adapters"), `${relative(HERE, file)} imports ${target}`).toBe(false);
        queue.push(target);
      }
    }
    expect([...seen].map((file) => relative(HERE, file)).sort()).toEqual([
      "../calendar-months.ts",
      "decision.ts",
      "index.ts",
      "lifecycle.ts",
      "record.ts",
    ]);
  });
});

const LEGACY_POLICY: ConsentPolicy = { ...POLICY, legacy: { accept: true, assumedPolicyVersion: "policy-1" } };
const LEGACY_CURRENT: ConsentPolicy = { ...POLICY, legacy: { accept: true, assumedPolicyVersion: POLICY.version } };

describe("legacy records migrate in parsing, without renewal (C-10)", () => {
  const decided = plusMs(T0, -10 * DAY);

  it("parse only with policy.legacy", () => {
    expect(parseStoredChoice(legacyRecord("granted", decided), POLICY)).toBeNull();
    expect(parseStoredChoice(JSON.stringify(legacyRecord("granted", decided)), POLICY)).toBeNull();
    expect(parseStoredChoice(legacyRecord("granted", decided), LEGACY_POLICY)).not.toBeNull();
  });

  it("take assumedPolicyVersion and keep the expiry their own decidedAt gives", () => {
    const parsed = parseStoredChoice(JSON.stringify(legacyRecord("granted", decided)), LEGACY_POLICY);
    expect(parsed).toEqual({
      status: "granted",
      decidedAt: decided,
      expiresAt: addCalendarMonthsUtc(at(decided), POLICY.expiryMonths).toISOString(),
      policyVersion: "policy-1",
    });
  });

  it("a legacy record with no readable date reads as no choice", () => {
    for (const record of [{ status: "granted" }, { status: "granted", decidedAt: "" }, { status: "denied", decidedAt: "yesterday" }]) {
      expect(parseStoredChoice(record, LEGACY_CURRENT)).toBeNull();
    }
  });

  it("C-7 applies unchanged: an assumed older version leaves a grant not live", () => {
    expect(harness({ policy: LEGACY_POLICY, initial: legacyRecord("granted", decided) }).snap()).toMatchObject({
      effective: "none",
      persistence: "none",
    });
    expect(harness({ policy: LEGACY_CURRENT, initial: legacyRecord("granted", decided) }).snap()).toMatchObject({
      effective: "granted",
      persistence: "stored",
    });
  });

  it("a legacy record past its original expiry reads as no choice", () => {
    const old = plusMs(T0, -200 * DAY);
    expect(harness({ policy: LEGACY_CURRENT, initial: legacyRecord("granted", old) }).snap().effective).toBe("none");
  });

  it("is never rewritten by mount, refresh or a cross-tab re-read", async () => {
    const raw = JSON.stringify(legacyRecord("granted", decided));
    const h = harness({ policy: LEGACY_CURRENT, initial: raw });
    h.time.advance(HOUR);
    h.lifecycle.refresh();
    h.storage.emitExternalChange();
    await flush();
    expect(h.storage.writes).toEqual([]);
    expect(h.storage.removes).toEqual([]);
    expect(h.storage.value).toBe(raw);
  });

  it("the next explicit choice writes the full shape", () => {
    const h = harness({ policy: LEGACY_CURRENT, initial: legacyRecord("granted", decided) });
    h.time.advance(HOUR);
    h.lifecycle.grant();
    expect(Object.keys(h.storage.writes[0] ?? {}).sort()).toEqual(["decidedAt", "expiresAt", "policyVersion", "status"]);
  });
});

describe("a legacy record never carries gpcOverride (C-10, C-8)", () => {
  const overridable: ConsentPolicy = { ...LEGACY_CURRENT, gpcOverridable: true };

  it("an override found on a legacy grant is ignored, whatever its value", () => {
    for (const gpcOverride of [true, "yes"]) {
      const parsed = parseStoredChoice({ ...legacyRecord("granted", plusMs(T0, -DAY)), gpcOverride }, overridable);
      expect(parsed).not.toBeNull();
      expect(parsed && "gpcOverride" in parsed).toBe(false);
    }
  });

  it("so a legacy grant never overrides a signal that is on", () => {
    const h = harness({
      policy: overridable,
      signals: { gpc: true },
      initial: { ...legacyRecord("granted", plusMs(T0, -DAY)), gpcOverride: true },
    });
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false });
  });
});
