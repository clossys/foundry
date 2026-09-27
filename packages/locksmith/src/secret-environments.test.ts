import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  defineSecretCatalog,
  defineSecretDeclaration,
  evaluateSecretEnvironments,
  projectSecretCatalog,
  secretEnvironmentsReport,
  validateSecretDeclaration,
} from "./index.js";
import type { SecretDeclaration, SecretEnvironmentsEvaluation, SecretEnvironmentsFinding } from "./index.js";

// Deliberately loose: these fixtures are mutated into malformed shapes the
// typed contract would never allow.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

const DECOY = "sk_live_secret_environments_decoy_should_never_escape_0000";
const OBSERVED_AT = "2026-09-27T00:00:00.000Z";

function declaration(): Loose {
  return {
    version: 2,
    environments: ["development", "preview", "production"],
    source: {
      id: "secret-manager",
      provider: "infisical",
      role: "secret-manager",
      environmentMap: { development: "dev", preview: "staging", production: "prod" },
    },
    deliveryTargets: [
      {
        id: "web-hosting",
        provider: "vercel",
        environmentMap: { development: "development", preview: "preview", production: "production" },
        sync: "provider-integration",
      },
    ],
    entries: [
      {
        key: "DATABASE_URL",
        required: true,
        description: "Primary database connection string.",
        group: "database",
        class: "secret",
        purpose: "Connects the web app to its own database.",
        consumers: ["web"],
        deliveryTargets: ["web-hosting"],
      },
      {
        key: "NEXT_PUBLIC_SITE_URL",
        required: true,
        class: "public-config",
        purpose: "Canonical site origin rendered into pages.",
        consumers: ["web"],
        deliveryTargets: ["web-hosting"],
      },
    ],
  };
}

function minimalDeclaration(): Loose {
  return {
    version: 2,
    environments: ["production"],
    source: { id: "secret-manager", provider: "infisical", role: "secret-manager", environmentMap: { production: "prod" } },
    deliveryTargets: [],
    entries: [
      { key: "API_SIGNING_KEY", required: true, class: "secret", purpose: "Signs outbound requests.", consumers: ["api"], deliveryTargets: [] },
    ],
  };
}

function sourceSnapshot(environment: string, names: readonly string[] = ["DATABASE_URL"]): Loose {
  return {
    version: 1,
    provider: "infisical",
    location: "secret-manager",
    observedAt: OBSERVED_AT,
    environments: [environment],
    entries: names.map((name) => ({ name, environments: [environment], storage: "managed" })),
  };
}

function targetSnapshot(): Loose {
  return {
    version: 1,
    provider: "vercel",
    location: "web-hosting",
    observedAt: OBSERVED_AT,
    environments: ["development", "preview", "production"],
    entries: [
      { name: "DATABASE_URL", environments: ["development"], storage: "sensitive", identity: "record-dev" },
      { name: "DATABASE_URL", environments: ["preview"], storage: "sensitive", identity: "record-preview" },
      { name: "DATABASE_URL", environments: ["production"], storage: "sensitive", identity: "record-production" },
      {
        name: "NEXT_PUBLIC_SITE_URL",
        environments: ["development", "preview", "production"],
        storage: "readable",
        identity: "record-site",
      },
    ],
  };
}

function inventories(target: Loose = targetSnapshot()): Loose[] {
  return [sourceSnapshot("dev"), sourceSnapshot("staging"), sourceSnapshot("prod"), target];
}

function rulesOf(findings: readonly SecretEnvironmentsFinding[]): string[] {
  return findings.map((finding) => finding.rule);
}

function pathsFor(evaluation: SecretEnvironmentsEvaluation, rule: string): (string | undefined)[] {
  return evaluation.findings.filter((finding) => finding.rule === rule).map((finding) => finding.path);
}

describe("validateSecretDeclaration", () => {
  it("accepts a minimal secret-manager declaration", () => {
    expect(validateSecretDeclaration(minimalDeclaration())).toEqual([]);
    expect(validateSecretDeclaration(declaration())).toEqual([]);
    const evaluation = evaluateSecretEnvironments({
      declaration: minimalDeclaration(),
      inventories: [sourceSnapshot("prod", ["API_SIGNING_KEY"])],
    });
    expect(evaluation).toEqual({ verdict: "satisfied", exitCode: 0, findings: [] });
  });

  it("defaults an omitted secret environment to separate", () => {
    // DATABASE_URL (secret, no policies) spanning preview+production is a
    // violation; NEXT_PUBLIC_SITE_URL (public-config) spanning all three is not.
    const target = targetSnapshot();
    target.entries = [
      { name: "DATABASE_URL", environments: ["development"], storage: "sensitive" },
      { name: "DATABASE_URL", environments: ["preview", "production"], storage: "sensitive" },
      target.entries[3],
    ];
    const evaluation = evaluateSecretEnvironments({ declaration: declaration(), inventories: inventories(target) });
    expect(evaluation.verdict).toBe("violated");
    expect(pathsFor(evaluation, "separate-shares-identity")).toEqual([
      "web-hosting/preview/DATABASE_URL",
      "web-hosting/production/DATABASE_URL",
    ]);

    // An explicit, reasoned `shared` policy is what lifts the default.
    const shared = declaration();
    shared.entries[0].environments = {
      preview: { mode: "shared", reason: "Preview reads production data read-only during the migration window." },
      production: { mode: "shared", reason: "Preview reads production data read-only during the migration window." },
    };
    const lifted = evaluateSecretEnvironments({ declaration: shared, inventories: inventories(target) });
    expect(lifted).toEqual({ verdict: "satisfied", exitCode: 0, findings: [] });
  });

  it("rejects shared or absent without a reason for a secret", () => {
    const value = declaration();
    value.entries[0].environments = {
      preview: { mode: "shared" },
      development: { mode: "absent", reason: "   " },
      production: { mode: "separate" },
    };
    value.entries[1].environments = { preview: { mode: "absent" } };
    const findings = validateSecretDeclaration(value);
    expect(findings).toEqual([
      expect.objectContaining({ rule: "shared-without-reason", severity: "error", path: "entries[0].environments.preview" }),
      expect.objectContaining({ rule: "absent-without-reason", severity: "error", path: "entries[0].environments.development" }),
    ]);
    const evaluation = evaluateSecretEnvironments({ declaration: value, inventories: inventories() });
    expect(evaluation.verdict).toBe("violated");
  });

  it("requires reason and migration for hosting-as-source", () => {
    const value = declaration();
    value.source = {
      id: "hosting",
      provider: "vercel",
      role: "hosting-as-source",
      environmentMap: { development: "development", preview: "preview", production: "production" },
    };
    value.deliveryTargets = [];
    value.entries[0].deliveryTargets = [];
    value.entries[1].deliveryTargets = [];
    expect(rulesOf(validateSecretDeclaration(value))).toEqual(["hosting-source-without-exception"]);

    value.source.reason = "The hosting provider held these values before the secret manager existed.";
    expect(rulesOf(validateSecretDeclaration(value))).toEqual(["hosting-source-without-exception"]);

    value.source.migration = "";
    expect(rulesOf(validateSecretDeclaration(value))).toEqual(["hosting-source-without-exception"]);

    value.source.migration = "Import into the secret manager and switch the hosting provider to an integration-synced target.";
    expect(validateSecretDeclaration(value)).toEqual([]);

    const infisicalAsHosting = declaration();
    infisicalAsHosting.source.role = "hosting-as-source";
    infisicalAsHosting.source.reason = "r";
    infisicalAsHosting.source.migration = "m";
    expect(rulesOf(validateSecretDeclaration(infisicalAsHosting))).toEqual(["source-role-provider-mismatch"]);

    const vercelAsManager = declaration();
    vercelAsManager.source.provider = "vercel";
    expect(rulesOf(validateSecretDeclaration(vercelAsManager))).toEqual(["source-role-provider-mismatch"]);
  });

  it("unknown field makes the declaration indeterminate and is not echoed", () => {
    for (const mutate of [
      (value: Loose) => {
        value.token = DECOY;
      },
      (value: Loose) => {
        value.entries[1][DECOY] = "x";
      },
      (value: Loose) => {
        value.entries[1].extra = DECOY;
      },
      (value: Loose) => {
        value.source.environmentMap[DECOY] = DECOY;
      },
    ]) {
      const value = declaration();
      mutate(value);
      const findings = validateSecretDeclaration(value);
      expect(rulesOf(findings)).toEqual(["declaration-unreadable"]);
      expect(JSON.stringify(findings)).not.toContain(DECOY);

      const evaluation = evaluateSecretEnvironments({ declaration: value, inventories: inventories() });
      expect(evaluation.verdict).toBe("indeterminate");
      expect(evaluation.exitCode).toBe(2);
      expect(rulesOf(evaluation.findings)).toEqual(["declaration-unreadable"]);
      expect(JSON.stringify(evaluation)).not.toContain(DECOY);
      expect(JSON.stringify(secretEnvironmentsReport({ declaration: value, inventories: inventories() }, "0.0.0"))).not.toContain(DECOY);
    }

    const nested = declaration();
    nested.entries[1].extra = DECOY;
    expect(validateSecretDeclaration(nested)[0]?.path).toBe("entries[1]");
    const mapKey = declaration();
    mapKey.source.environmentMap.qa = "qa";
    expect(validateSecretDeclaration(mapKey)[0]?.path).toBe("source.environmentMap");
  });

  it("reports each structural problem as one unreadable finding with a known-field path", () => {
    const cases: [(value: Loose) => void, string | undefined][] = [
      [(value) => (value.version = 1), "version"],
      [(value) => (value.environments = ["preview"]), "environments"],
      [(value) => (value.environments = ["production", "production"]), "environments"],
      [(value) => (value.environments = []), "environments"],
      [(value) => (value.environments = ["production", "qa"]), "environments"],
      [(value) => (value.entries = []), "entries"],
      [(value) => (value.entries[1].key = "DATABASE_URL"), "entries[1].key"],
      [(value) => (value.entries[1].key = "not-a-name"), "entries[1].key"],
      [(value) => (value.entries[0].required = "yes"), "entries[0].required"],
      [(value) => (value.entries[0].class = "credential"), "entries[0].class"],
      [(value) => (value.entries[0].environments = { preview: { mode: "sometimes" } }), "entries[0].environments.preview.mode"],
      [(value) => (value.entries[0].environments = { preview: { mode: "shared", why: "x" } }), "entries[0].environments.preview"],
      [(value) => (value.entries[0].deliveryTargets = "web-hosting"), "entries[0].deliveryTargets"],
      [(value) => (value.deliveryTargets[0].id = "secret-manager"), "deliveryTargets[0].id"],
      [(value) => (value.deliveryTargets[0].id = "web/hosting"), "deliveryTargets[0].id"],
      [(value) => (value.source.id = "Secret Manager"), "source.id"],
      [(value) => (value.deliveryTargets[0].sync = "nightly"), "deliveryTargets[0].sync"],
      [(value) => (value.deliveryTargets[0].environmentMap.preview = ""), "deliveryTargets[0].environmentMap.preview"],
      [(value) => (value.source.provider = "aws"), "source.provider"],
      [(value) => (value.source.reason = 42), "source.reason"],
      [(value) => delete value.source.environmentMap, "source.environmentMap"],
      [(value) => delete value.entries, "entries"],
    ];
    for (const [mutate, path] of cases) {
      const value = declaration();
      mutate(value);
      expect(validateSecretDeclaration(value)).toEqual([expect.objectContaining({ rule: "declaration-unreadable", path })]);
    }
    for (const value of [null, undefined, 42, "declaration", [declaration()], Object.create(null)]) {
      expect(validateSecretDeclaration(value)).toEqual([expect.objectContaining({ rule: "declaration-unreadable" })]);
    }
  });

  it("reports the semantic violations of a readable declaration", () => {
    const value = declaration();
    value.source.environmentMap.staging = "stg";
    value.entries[0].environments = { staging: { mode: "separate" } };
    value.entries[0].deliveryTargets = ["web-hosting", "ci-deploy"];
    delete value.entries[0].purpose;
    value.entries[1].purpose = 7;
    value.entries[1].consumers = [];
    delete value.entries[0].consumers;
    expect(validateSecretDeclaration(value)).toEqual([
      expect.objectContaining({ rule: "environment-not-declared", path: "source.environmentMap.staging" }),
      expect.objectContaining({ rule: "environment-not-declared", path: "entries[0].environments.staging" }),
      expect.objectContaining({ rule: "unknown-delivery-target", path: "entries[0].deliveryTargets[1]" }),
      expect.objectContaining({ rule: "missing-purpose", path: "entries[0].purpose" }),
      expect.objectContaining({ rule: "missing-consumers", path: "entries[0].consumers" }),
      expect.objectContaining({ rule: "missing-purpose", path: "entries[1].purpose" }),
      expect.objectContaining({ rule: "missing-consumers", path: "entries[1].consumers" }),
    ]);
  });
});

describe("defineSecretDeclaration and projectSecretCatalog", () => {
  it("defineSecretDeclaration returns a frozen copy equal to a valid declaration", () => {
    const value = declaration();
    value.entries[0].environments = { development: { mode: "shared", reason: "Local development uses a disposable database." } };
    const defined = defineSecretDeclaration(value as SecretDeclaration);
    expect(defined).toEqual(value);
    expect(defined).not.toBe(value);
    expect(Object.isFrozen(defined)).toBe(true);
    expect(Object.isFrozen(defined.source)).toBe(true);
    expect(Object.isFrozen(defined.source.environmentMap)).toBe(true);
    expect(Object.isFrozen(defined.deliveryTargets)).toBe(true);
    expect(Object.isFrozen(defined.entries[0])).toBe(true);
    expect(Object.isFrozen(defined.entries[0]?.consumers)).toBe(true);
    expect(Object.isFrozen(defined.entries[0]?.environments)).toBe(true);
    expect(Object.isFrozen(defined.entries[0]?.environments?.development)).toBe(true);
    // Mutating the input afterwards cannot reach the copy.
    value.entries[0].consumers.push("other");
    expect(defined.entries[0]?.consumers).toEqual(["web"]);
  });

  it("defineSecretDeclaration throws a RangeError listing rule ids only", () => {
    const invalid = declaration();
    invalid.entries[0].environments = { preview: { mode: "shared" } };
    invalid.entries[0].purpose = "";
    expect(() => defineSecretDeclaration(invalid)).toThrow(RangeError);
    expect(() => defineSecretDeclaration(invalid)).toThrow(/^secret declaration cannot be defined: missing-purpose, shared-without-reason$/);

    const unreadable = declaration();
    unreadable.entries[0][DECOY] = DECOY;
    let message = "";
    try {
      defineSecretDeclaration(unreadable);
    } catch (error) {
      expect(error).toBeInstanceOf(RangeError);
      message = (error as Error).message;
    }
    expect(message).toBe("secret declaration cannot be defined: declaration-unreadable");
  });

  it("projectSecretCatalog returns the version-1 projection with only key/required/description/group", () => {
    const catalog = projectSecretCatalog(declaration() as SecretDeclaration);
    expect(catalog).toEqual({
      version: 1,
      entries: [
        { key: "DATABASE_URL", required: true, description: "Primary database connection string.", group: "database" },
        { key: "NEXT_PUBLIC_SITE_URL", required: true },
      ],
    });
    expect(catalog).toEqual(
      defineSecretCatalog([
        { key: "DATABASE_URL", required: true, description: "Primary database connection string.", group: "database" },
        { key: "NEXT_PUBLIC_SITE_URL", required: true },
      ]),
    );
    for (const entry of catalog.entries) {
      expect(Object.keys(entry).every((key) => ["key", "required", "description", "group"].includes(key))).toBe(true);
    }
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.entries)).toBe(true);
    expect(Object.isFrozen(catalog.entries[0])).toBe(true);

    const invalid = declaration();
    invalid.version = 1;
    expect(() => projectSecretCatalog(invalid)).toThrow(RangeError);
    expect(() => projectSecretCatalog(invalid)).toThrow(/^secret declaration cannot be projected: declaration-unreadable$/);
  });
});

describe("evaluateSecretEnvironments", () => {
  it("satisfies a declaration every inventory agrees with", () => {
    expect(evaluateSecretEnvironments({ declaration: declaration(), inventories: inventories() })).toEqual({
      verdict: "satisfied",
      exitCode: 0,
      findings: [],
    });
  });

  it("throwing getter is indeterminate", () => {
    let calls = 0;
    const value = declaration();
    Object.defineProperty(value.source, "id", {
      enumerable: true,
      get() {
        calls += 1;
        throw new Error(DECOY);
      },
    });
    const evaluation = evaluateSecretEnvironments({ declaration: value, inventories: inventories() });
    expect(evaluation.verdict).toBe("indeterminate");
    expect(rulesOf(evaluation.findings)).toEqual(["declaration-unreadable"]);
    expect(calls).toBe(0);
    expect(JSON.stringify(evaluation)).not.toContain(DECOY);

    const trapped = new Proxy(declaration(), {
      ownKeys() {
        throw new Error(DECOY);
      },
    });
    expect(() => evaluateSecretEnvironments({ declaration: trapped, inventories: inventories() })).not.toThrow();
    expect(evaluateSecretEnvironments({ declaration: trapped, inventories: inventories() }).verdict).toBe("indeterminate");
    expect(validateSecretDeclaration(trapped)).toEqual([expect.objectContaining({ rule: "declaration-unreadable" })]);

    // A getter inside one inventory makes only that snapshot unreadable.
    const target = targetSnapshot();
    Object.defineProperty(target.entries[0], "identity", {
      enumerable: true,
      get() {
        calls += 1;
        return DECOY;
      },
    });
    const partial = evaluateSecretEnvironments({ declaration: declaration(), inventories: inventories(target) });
    expect(calls).toBe(0);
    expect(partial.verdict).toBe("indeterminate");
    expect(partial.findings).toContainEqual(expect.objectContaining({ rule: "inventory-unreadable", path: "inventories[3]" }));
    expect(pathsFor(partial, "location-unobserved")).toEqual([
      "web-hosting/development",
      "web-hosting/preview",
      "web-hosting/production",
    ]);
    expect(JSON.stringify(partial)).not.toContain(DECOY);
  });

  it("one provider entry spanning preview and production violates separate", () => {
    const target = targetSnapshot();
    target.entries = [
      target.entries[0],
      { name: "DATABASE_URL", environments: ["preview", "production"], storage: "sensitive", identity: "record-shared" },
      target.entries[3],
    ];
    const evaluation = evaluateSecretEnvironments({ declaration: declaration(), inventories: inventories(target) });
    expect(evaluation.verdict).toBe("violated");
    expect(evaluation.exitCode).toBe(1);
    expect(evaluation.findings).toEqual([
      expect.objectContaining({ rule: "separate-shares-identity", severity: "error", path: "web-hosting/preview/DATABASE_URL" }),
      expect.objectContaining({ rule: "separate-shares-identity", severity: "error", path: "web-hosting/production/DATABASE_URL" }),
    ]);
  });

  it("equal identity across environments violates separate", () => {
    const target = targetSnapshot();
    target.entries[1].identity = "record-production";
    const evaluation = evaluateSecretEnvironments({ declaration: declaration(), inventories: inventories(target) });
    expect(evaluation.verdict).toBe("violated");
    expect(pathsFor(evaluation, "separate-shares-identity")).toEqual([
      "web-hosting/preview/DATABASE_URL",
      "web-hosting/production/DATABASE_URL",
    ]);
    for (const finding of evaluation.findings) {
      expect(finding.message).not.toContain("record-production");
      expect(finding.path ?? "").not.toContain("record-production");
    }
  });

  it("missing preview key is declared-environment-missing", () => {
    const target = targetSnapshot();
    target.entries.splice(1, 1);
    const evaluation = evaluateSecretEnvironments({ declaration: declaration(), inventories: inventories(target) });
    expect(evaluation.verdict).toBe("violated");
    expect(evaluation.findings).toEqual([
      expect.objectContaining({ rule: "declared-environment-missing", path: "web-hosting/preview/DATABASE_URL" }),
    ]);

    // An optional key missing is not a finding; neither is public config
    // missing from a secret-manager source (the baseline source never holds it).
    const optional = declaration();
    optional.entries[0].required = false;
    expect(evaluateSecretEnvironments({ declaration: optional, inventories: inventories(target) }).verdict).toBe("satisfied");

    const source = inventories();
    source[1] = sourceSnapshot("staging", []);
    const fromSource = evaluateSecretEnvironments({ declaration: declaration(), inventories: source });
    expect(fromSource.findings).toEqual([
      expect.objectContaining({ rule: "declared-environment-missing", path: "secret-manager/preview/DATABASE_URL" }),
    ]);
  });

  it("undeclared hand-set name is reported", () => {
    const target = targetSnapshot();
    target.environments.push("custom-qa");
    target.entries.push(
      { name: "HAND_SET_TOKEN", environments: ["production"], storage: "sensitive" },
      { name: "HAND_SET_TOKEN", environments: ["preview"], storage: "sensitive" },
      // Observed only in a provider environment the declaration never maps: ignored.
      { name: "QA_ONLY_FLAG", environments: ["custom-qa"], storage: "plain" },
    );
    const evaluation = evaluateSecretEnvironments({ declaration: declaration(), inventories: inventories(target) });
    expect(evaluation.verdict).toBe("violated");
    expect(evaluation.findings).toEqual([expect.objectContaining({ rule: "undeclared-name", path: "web-hosting/HAND_SET_TOKEN" })]);

    // A name the declaration knows but does not deliver to this target is undeclared here too.
    const notDelivered = declaration();
    notDelivered.entries[1].deliveryTargets = [];
    const undelivered = evaluateSecretEnvironments({ declaration: notDelivered, inventories: inventories() });
    expect(undelivered.findings).toEqual([
      expect.objectContaining({ rule: "undeclared-name", path: "web-hosting/NEXT_PUBLIC_SITE_URL" }),
    ]);
  });

  it("secret stored plain or readable is reported", () => {
    const target = targetSnapshot();
    target.entries[0].storage = "readable";
    target.entries[2].storage = "plain";
    const evaluation = evaluateSecretEnvironments({ declaration: declaration(), inventories: inventories(target) });
    expect(evaluation.verdict).toBe("violated");
    // Deduplicated per (rule, location, key).
    expect(evaluation.findings).toEqual([
      expect.objectContaining({ rule: "secret-stored-readable", path: "web-hosting/DATABASE_URL" }),
    ]);

    const unobserved = targetSnapshot();
    unobserved.entries[0].storage = "unknown";
    unobserved.entries[1].storage = "managed";
    const indeterminate = evaluateSecretEnvironments({ declaration: declaration(), inventories: inventories(unobserved) });
    expect(indeterminate.verdict).toBe("indeterminate");
    expect(indeterminate.findings).toEqual([
      expect.objectContaining({ rule: "storage-unobserved", path: "web-hosting/DATABASE_URL" }),
    ]);

    const managedOnly = targetSnapshot();
    managedOnly.entries[1].storage = "managed";
    const managed = evaluateSecretEnvironments({ declaration: declaration(), inventories: inventories(managedOnly) });
    expect(managed.findings).toEqual([
      expect.objectContaining({
        rule: "storage-unobserved",
        path: "web-hosting/DATABASE_URL",
        message: "managed storage is only interpretable at a secret-manager source",
      }),
    ]);
  });

  it("absent environment present is reported", () => {
    const value = declaration();
    value.entries[0].environments = { development: { mode: "absent", reason: "Development uses a local database only." } };
    const evaluation = evaluateSecretEnvironments({ declaration: value, inventories: inventories() });
    expect(evaluation.verdict).toBe("violated");
    expect(pathsFor(evaluation, "absent-environment-present")).toEqual([
      "secret-manager/development/DATABASE_URL",
      "web-hosting/development/DATABASE_URL",
    ]);
  });

  it("merged environment mapping is reported", () => {
    const value = declaration();
    value.deliveryTargets[0].environmentMap = { development: "development", preview: "production", production: "production" };
    const target = targetSnapshot();
    target.environments = ["development", "production"];
    target.entries = [
      { name: "DATABASE_URL", environments: ["development"], storage: "sensitive" },
      { name: "DATABASE_URL", environments: ["production"], storage: "sensitive" },
      { name: "NEXT_PUBLIC_SITE_URL", environments: ["development", "production"], storage: "readable" },
    ];
    const evaluation = evaluateSecretEnvironments({ declaration: value, inventories: inventories(target) });
    expect(evaluation.verdict).toBe("violated");
    expect(evaluation.findings).toEqual([
      expect.objectContaining({ rule: "location-merges-environments", path: "web-hosting/preview+production/DATABASE_URL" }),
    ]);

    // Declaration-only: reported even with no inventories at all.
    const noInventory = evaluateSecretEnvironments({ declaration: value, inventories: [] });
    expect(noInventory.verdict).toBe("violated");
    expect(pathsFor(noInventory, "location-merges-environments")).toEqual(["web-hosting/preview+production/DATABASE_URL"]);
  });

  it("unobserved location is indeterminate, violation still dominates", () => {
    const sourceOnly = [sourceSnapshot("dev"), sourceSnapshot("staging"), sourceSnapshot("prod")];
    const evaluation = evaluateSecretEnvironments({ declaration: declaration(), inventories: sourceOnly });
    expect(evaluation.verdict).toBe("indeterminate");
    expect(evaluation.exitCode).toBe(2);
    expect(evaluation.findings).toEqual([
      expect.objectContaining({ rule: "location-unobserved", path: "web-hosting/development" }),
      expect.objectContaining({ rule: "location-unobserved", path: "web-hosting/preview" }),
      expect.objectContaining({ rule: "location-unobserved", path: "web-hosting/production" }),
    ]);

    const withDrift = [sourceSnapshot("dev"), sourceSnapshot("staging"), sourceSnapshot("prod", ["DATABASE_URL", "STRAY_NAME"])];
    const dominated = evaluateSecretEnvironments({ declaration: declaration(), inventories: withDrift });
    expect(dominated.verdict).toBe("violated");
    expect(dominated.exitCode).toBe(1);
    expect(rulesOf(dominated.findings)).toEqual([
      "undeclared-name",
      "location-unobserved",
      "location-unobserved",
      "location-unobserved",
    ]);
  });

  it("no inventories is indeterminate", () => {
    const empty = evaluateSecretEnvironments({ declaration: declaration(), inventories: [] });
    expect(empty.verdict).toBe("indeterminate");
    expect(empty.findings[0]).toEqual(expect.objectContaining({ rule: "inventories-empty", path: "inventories" }));

    // Even a declaration with no mapped environment at all is never satisfied without an inventory.
    const unmapped = minimalDeclaration();
    unmapped.source.environmentMap = {};
    expect(evaluateSecretEnvironments({ declaration: unmapped, inventories: [] }).verdict).toBe("indeterminate");

    for (const value of [undefined, null, "inventory.json", {}, [1, , 2]]) {
      const unreadable = evaluateSecretEnvironments({ declaration: declaration(), inventories: value });
      expect(unreadable.verdict).toBe("indeterminate");
      expect(unreadable.findings[0]).toEqual(expect.objectContaining({ rule: "inventory-unreadable", path: "inventories" }));
    }
    const trapped = new Proxy([], {
      ownKeys() {
        throw new Error(DECOY);
      },
    });
    const trappedResult = evaluateSecretEnvironments({ declaration: declaration(), inventories: trapped });
    expect(trappedResult.findings[0]).toEqual(expect.objectContaining({ rule: "inventory-unreadable", path: "inventories" }));
    expect(JSON.stringify(trappedResult)).not.toContain(DECOY);

    const missing = evaluateSecretEnvironments({ declaration: declaration() } as Loose);
    expect(missing.findings[0]).toEqual(expect.objectContaining({ rule: "inventory-unreadable", path: "inventories" }));
  });

  it("refuses an unreadable or unmatched snapshot but still evaluates the rest", () => {
    const malformed: ((snapshot: Loose) => void)[] = [
      (snapshot) => (snapshot.version = 2),
      (snapshot) => (snapshot.observedAt = "yesterday"),
      (snapshot) => (snapshot.observedAt = "2026-09-27"),
      (snapshot) => (snapshot.environments = []),
      (snapshot) => (snapshot.entries[0].environments = ["qa"]),
      (snapshot) => (snapshot.entries[0].name = "not a name"),
      (snapshot) => (snapshot.entries[0].storage = "encrypted"),
      (snapshot) => (snapshot.entries[0].identity = ""),
      (snapshot) => (snapshot.entries[0].value = DECOY),
      (snapshot) => delete snapshot.observedAt,
    ];
    for (const mutate of malformed) {
      const target = targetSnapshot();
      mutate(target);
      const evaluation = evaluateSecretEnvironments({ declaration: declaration(), inventories: inventories(target) });
      expect(evaluation.verdict).toBe("indeterminate");
      expect(evaluation.findings[0]).toEqual(expect.objectContaining({ rule: "inventory-unreadable", path: "inventories[3]" }));
      expect(JSON.stringify(evaluation)).not.toContain(DECOY);
    }

    for (const mutate of [(snapshot: Loose) => (snapshot.location = "elsewhere"), (snapshot: Loose) => (snapshot.provider = "github-actions")]) {
      const target = targetSnapshot();
      mutate(target);
      const evaluation = evaluateSecretEnvironments({ declaration: declaration(), inventories: inventories(target) });
      expect(evaluation.verdict).toBe("indeterminate");
      expect(evaluation.findings[0]).toEqual(expect.objectContaining({ rule: "inventory-unmatched", path: "inventories[3]" }));
    }

    // Several snapshots for one location are unioned.
    const split = targetSnapshot();
    const production = { ...targetSnapshot(), environments: ["production"], entries: [split.entries[2], { ...split.entries[3], environments: ["production"] }] };
    split.environments = ["development", "preview"];
    split.entries = [split.entries[0], split.entries[1], { ...split.entries[3], environments: ["development", "preview"] }];
    const unioned = evaluateSecretEnvironments({ declaration: declaration(), inventories: [...inventories(split), production] });
    expect(unioned).toEqual({ verdict: "satisfied", exitCode: 0, findings: [] });
  });

  it("hosting-as-source with exception is satisfied", () => {
    const value = declaration();
    value.source = {
      id: "hosting",
      provider: "vercel",
      role: "hosting-as-source",
      environmentMap: { development: "development", preview: "preview", production: "production" },
      reason: "Values were created in the hosting provider before the secret manager existed.",
      migration: "Import each value into the secret manager, then turn the hosting provider into a synced delivery target.",
    };
    value.deliveryTargets = [];
    value.entries[0].deliveryTargets = [];
    value.entries[1].deliveryTargets = [];
    const snapshot = targetSnapshot();
    snapshot.location = "hosting";
    const evaluation = evaluateSecretEnvironments({ declaration: value, inventories: [snapshot] });
    expect(evaluation).toEqual({ verdict: "satisfied", exitCode: 0, findings: [] });

    // At a hosting-as-source source, required config must be present too.
    snapshot.entries.splice(3, 1);
    const missing = evaluateSecretEnvironments({ declaration: value, inventories: [snapshot] });
    expect(pathsFor(missing, "declared-environment-missing")).toEqual([
      "hosting/development/NEXT_PUBLIC_SITE_URL",
      "hosting/preview/NEXT_PUBLIC_SITE_URL",
      "hosting/production/NEXT_PUBLIC_SITE_URL",
    ]);
  });

  it("manual sync is a warning only", () => {
    const value = declaration();
    value.deliveryTargets[0].sync = "manual";
    const evaluation = evaluateSecretEnvironments({ declaration: value, inventories: inventories() });
    expect(evaluation.verdict).toBe("satisfied");
    expect(evaluation.exitCode).toBe(0);
    expect(evaluation.findings).toEqual([
      expect.objectContaining({ rule: "manual-sync", severity: "warning", path: "web-hosting" }),
    ]);
    const report = secretEnvironmentsReport({ declaration: value, inventories: inventories() }, "0.2.10");
    expect(report.verdict).toBe("satisfied");
    expect(report.nextAction).toBeUndefined();
  });

  it("orders findings by declaration, inventory, then location, without duplicates", () => {
    const value = declaration();
    value.deliveryTargets[0].sync = "manual";
    value.entries[0].purpose = "";
    const target = targetSnapshot();
    target.entries.push({ name: "STRAY", environments: ["preview"], storage: "plain" }, { name: "STRAY", environments: ["production"], storage: "plain" });
    const evaluation = evaluateSecretEnvironments({
      declaration: value,
      inventories: [target, sourceSnapshot("dev"), sourceSnapshot("staging"), { nonsense: true }],
    });
    expect(evaluation.findings.map((finding) => `${finding.rule} ${finding.path}`)).toEqual([
      "missing-purpose entries[0].purpose",
      "inventory-unreadable inventories[3]",
      "location-unobserved secret-manager/production",
      "undeclared-name web-hosting/STRAY",
      "manual-sync web-hosting",
    ]);
    expect(Object.isFrozen(evaluation)).toBe(true);
    expect(Object.isFrozen(evaluation.findings)).toBe(true);
    expect(Object.isFrozen(evaluation.findings[0])).toBe(true);
  });

  it("identity decoy never appears in the evaluation or report", () => {
    const target = targetSnapshot();
    // The decoy is the shared identity that triggers a real finding.
    target.entries[1].identity = DECOY;
    target.entries[2].identity = DECOY;
    const input = { declaration: declaration(), inventories: inventories(target) };
    const evaluation = evaluateSecretEnvironments(input);
    expect(evaluation.verdict).toBe("violated");
    expect(rulesOf(evaluation.findings)).toContain("separate-shares-identity");
    expect(JSON.stringify(evaluation)).not.toContain(DECOY);
    expect(JSON.stringify(secretEnvironmentsReport(input, "0.2.10"))).not.toContain(DECOY);

    // An unknown inventory field's name and value, and an unknown declaration field's name and value.
    const unknownTarget = targetSnapshot();
    unknownTarget.entries[0][DECOY] = DECOY;
    unknownTarget.entries[1].identity = DECOY;
    const unknownDeclaration = declaration();
    unknownDeclaration.source[DECOY] = DECOY;
    for (const candidate of [
      { declaration: declaration(), inventories: inventories(unknownTarget) },
      { declaration: unknownDeclaration, inventories: inventories(unknownTarget) },
      { declaration: declaration(), inventories: inventories(), [DECOY]: DECOY },
    ]) {
      const result = evaluateSecretEnvironments(candidate as Loose);
      expect(result.verdict).toBe("indeterminate");
      expect(JSON.stringify(result)).not.toContain(DECOY);
      expect(JSON.stringify(secretEnvironmentsReport(candidate as Loose, "0.2.10"))).not.toContain(DECOY);
    }
  });
});

// docs/contracts/check-output-envelope.json is read from its one location in
// the repository (it does not ship with this package), the same discipline
// check-output-envelope.test.ts applies to provider-custody's report.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const contract = JSON.parse(readFileSync(join(repoRoot, "docs/contracts/check-output-envelope.json"), "utf8")) as {
  fields: readonly string[];
  requiredFields: readonly string[];
  optionalFields: readonly string[];
  verdicts: readonly string[];
  findingShape: Readonly<Record<string, string>>;
};

describe("secretEnvironmentsReport", () => {
  it("report conforms to the envelope contract", () => {
    const violatedTarget = targetSnapshot();
    violatedTarget.entries[2].storage = "plain";
    const reports = [
      secretEnvironmentsReport({ declaration: declaration(), inventories: inventories() }, "0.2.10"),
      secretEnvironmentsReport({ declaration: declaration(), inventories: inventories(violatedTarget) }, "0.2.10"),
      secretEnvironmentsReport({ declaration: declaration(), inventories: [] }, "0.2.10"),
      secretEnvironmentsReport({ declaration: null, inventories: [] }, "0.2.10"),
    ];
    expect(new Set(reports.map((report) => report.verdict))).toEqual(new Set(contract.verdicts));

    for (const report of reports) {
      for (const field of contract.requiredFields) expect(report).toHaveProperty(field);
      expect(Object.keys(report).filter((key) => !contract.fields.includes(key))).toEqual([]);
      expect(contract.verdicts).toContain(report.verdict);
      expect(report.package).toBe("@clossys/locksmith");
      expect(report.version).toBe("0.2.10");

      expect(typeof report.summary).toBe("string");
      expect(report.summary.split(/(?<=[.!?])\s+/).filter(Boolean)).toHaveLength(1);
      expect(report.summary.trim().endsWith(".")).toBe(true);

      for (const finding of report.findings) {
        const shapeKeys = Object.keys(contract.findingShape);
        expect(Object.keys(finding).filter((key) => !shapeKeys.includes(key))).toEqual([]);
        for (const key of ["rule", "severity", "message"]) expect(finding).toHaveProperty(key);
        expect(["error", "warning"]).toContain(finding.severity);
        expect(finding.message.length).toBeGreaterThan(0);
      }

      if (report.verdict === "satisfied") {
        expect(report.nextAction).toBeUndefined();
      } else {
        expect(report.findings.length).toBeGreaterThan(0);
        expect(contract.optionalFields).toContain("nextAction");
        expect(typeof report.nextAction).toBe("string");
        expect(report.nextAction!.split(/(?<=[.!?])\s+/).filter(Boolean)).toHaveLength(1);
      }
    }
    expect(reports[0]?.findings).toEqual([]);
    expect(reports[1]?.verdict).toBe("violated");
    expect(reports[2]?.verdict).toBe("indeterminate");
    expect(reports[3]?.verdict).toBe("indeterminate");
  });
});
