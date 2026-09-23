import { describe, expect, it } from "vitest";
import {
  defineProviderCustody,
  defineProviderCustodyManifest,
  evaluateProviderCustody,
  providerCustodyOf,
} from "./index.js";
import type { ProviderCustodyDeclaration, ProviderCustodyEvaluation } from "./index.js";

/** The stable rule ids off an evaluation's findings, in order -- what `.reasons` used to be before the check-output-envelope rework. */
function rulesOf(evaluation: ProviderCustodyEvaluation): readonly string[] {
  return evaluation.findings.map((finding) => finding.rule);
}

function declaration(overrides: Partial<ProviderCustodyDeclaration> = {}): ProviderCustodyDeclaration {
  return {
    key: "CLOUDFLARE_API_TOKEN",
    provider: "cloudflare",
    rung: "scoped-environment-secret",
    owner: "team-platform",
    store: "github-environment:deploy-cloudflare",
    scope: ["zone:edit:example.com", "workers:deploy:foundry-site"],
    leastPrivilegeNote: "Narrowest token Cloudflare's dashboard allows: one zone, Workers deploy only, no account-wide access.",
    usedBy: [".github/workflows/deploy.yml#deploy-cloudflare"],
    rotationPolicy: { maxAgeDays: 90 },
    ...overrides,
  };
}

describe("evaluateProviderCustody", () => {
  it("satisfies a complete, consistent declaration", () => {
    const result = evaluateProviderCustody(declaration());
    expect(result).toMatchObject({
      key: "CLOUDFLARE_API_TOKEN",
      provider: "cloudflare",
      rung: "scoped-environment-secret",
      verdict: "satisfied",
      exitCode: 0,
      findings: [],
    });
  });

  it("satisfies every closed provider and every closed rung", () => {
    for (const provider of ["cloudflare", "vercel", "github"] as const) {
      for (const rung of ["operator-interactive", "scoped-environment-secret", "federated-oidc"] as const) {
        expect(evaluateProviderCustody(declaration({ provider, rung })).verdict).toBe("satisfied");
      }
    }
  });

  it("accepts a null rotation policy explicitly, but not an absent one", () => {
    expect(evaluateProviderCustody(declaration({ rotationPolicy: null })).verdict).toBe("satisfied");
    const { rotationPolicy: _omitted, ...withoutPolicy } = declaration();
    const result = evaluateProviderCustody(withoutPolicy);
    expect(result.verdict).toBe("violated");
    expect(rulesOf(result)).toContain("invalid-rotation-policy");
  });

  it("is indeterminate for a non-object, never a pass", () => {
    for (const input of [null, undefined, "CLOUDFLARE_API_TOKEN", 42, [declaration()]]) {
      const result = evaluateProviderCustody(input);
      expect(result.verdict).toBe("indeterminate");
      expect(result.exitCode).toBe(2);
    }
  });

  it("is indeterminate for an unsupported extra field, so a smuggled field cannot be silently accepted", () => {
    const result = evaluateProviderCustody({ ...declaration(), token: "sk_live_should_never_appear" });
    expect(result.verdict).toBe("indeterminate");
    expect(rulesOf(result)).toEqual(["unsupported-fields"]);
    expect(JSON.stringify(result)).not.toContain("sk_live_should_never_appear");
  });

  it("rejects an unsupported provider", () => {
    const result = evaluateProviderCustody(declaration({ provider: "aws" as never }));
    expect(result.verdict).toBe("violated");
    expect(rulesOf(result)).toContain("unsupported-provider");
    expect(result.provider).toBeNull();
  });

  it("rejects an unsupported rung", () => {
    const result = evaluateProviderCustody(declaration({ rung: "hardcoded-in-source" as never }));
    expect(result.verdict).toBe("violated");
    expect(rulesOf(result)).toContain("unsupported-rung");
    expect(result.rung).toBeNull();
  });

  it("rejects a missing or empty owner", () => {
    expect(rulesOf(evaluateProviderCustody(declaration({ owner: "" })))).toContain("missing-owner");
    const { owner: _omitted, ...withoutOwner } = declaration();
    expect(rulesOf(evaluateProviderCustody(withoutOwner))).toContain("missing-owner");
  });

  it.each(["repository", "repo", ".env", "source", "committed", "git", "REPOSITORY", "  Repo  "])(
    "rejects a store literal that names this repository: %s",
    (store) => {
      const result = evaluateProviderCustody(declaration({ store }));
      expect(result.verdict).toBe("violated");
      expect(rulesOf(result)).toContain("store-is-repository");
    },
  );

  it("accepts a store that merely mentions a provider-side project, not this repository", () => {
    expect(evaluateProviderCustody(declaration({ store: "vercel-project-env:foundry-site" })).verdict).toBe("satisfied");
  });

  it("rejects an empty scope", () => {
    const result = evaluateProviderCustody(declaration({ scope: [] }));
    expect(result.verdict).toBe("violated");
    expect(rulesOf(result)).toContain("missing-scope");
  });

  it("rejects a missing or empty least-privilege note", () => {
    expect(rulesOf(evaluateProviderCustody(declaration({ leastPrivilegeNote: "   " })))).toContain("missing-least-privilege-note");
  });

  it("rejects a missing or empty usedBy", () => {
    expect(rulesOf(evaluateProviderCustody(declaration({ usedBy: [] })))).toContain("missing-used-by");
  });

  it("rejects a malformed rotation policy shape without accepting extra fields on it", () => {
    expect(rulesOf(evaluateProviderCustody(declaration({ rotationPolicy: { maxAgeDays: 90, extra: true } as never })))).toContain("invalid-rotation-policy");
    expect(rulesOf(evaluateProviderCustody(declaration({ rotationPolicy: { maxAgeDays: -1 } })))).toContain("invalid-rotation-policy");
    expect(rulesOf(evaluateProviderCustody(declaration({ rotationPolicy: { maxAgeDays: 0 } })))).toContain("invalid-rotation-policy");
  });

  it("reports every violated field at once, not just the first", () => {
    const result = evaluateProviderCustody({
      key: "",
      provider: "aws",
      rung: "in-code",
      owner: "",
      store: "repository",
      scope: [],
      leastPrivilegeNote: "",
      usedBy: [],
      rotationPolicy: "soon",
    });
    expect(result.verdict).toBe("violated");
    expect(new Set(rulesOf(result))).toEqual(
      new Set([
        "missing-key",
        "unsupported-provider",
        "unsupported-rung",
        "missing-owner",
        "store-is-repository",
        "missing-scope",
        "missing-least-privilege-note",
        "missing-used-by",
        "invalid-rotation-policy",
      ]),
    );
  });
});

describe("defineProviderCustody", () => {
  it("freezes a satisfied declaration, including its arrays", () => {
    const defined = defineProviderCustody(declaration());
    expect(Object.isFrozen(defined)).toBe(true);
    expect(Object.isFrozen(defined.scope)).toBe(true);
    expect(Object.isFrozen(defined.usedBy)).toBe(true);
    expect(Object.isFrozen(defined.rotationPolicy)).toBe(true);
  });

  it("throws, naming every reason, for an unsatisfied declaration", () => {
    expect(() => defineProviderCustody(declaration({ store: "repository" }))).toThrow(/store-is-repository/);
  });
});

describe("defineProviderCustodyManifest / providerCustodyOf", () => {
  it("looks up a declared key and reports undefined for one never declared", () => {
    const manifest = defineProviderCustodyManifest([
      declaration({ key: "CLOUDFLARE_API_TOKEN", provider: "cloudflare" }),
      declaration({ key: "VERCEL_DEPLOY_TOKEN", provider: "vercel", store: "vercel-project-env:foundry-site" }),
    ]);
    expect(manifest.version).toBe(1);
    expect(providerCustodyOf(manifest, "CLOUDFLARE_API_TOKEN")?.provider).toBe("cloudflare");
    expect(providerCustodyOf(manifest, "VERCEL_DEPLOY_TOKEN")?.provider).toBe("vercel");
    expect(providerCustodyOf(manifest, "NEVER_DECLARED")).toBeUndefined();
  });

  it("freezes the manifest itself", () => {
    const manifest = defineProviderCustodyManifest([declaration()]);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.entries)).toBe(true);
  });

  it("throws on the first unsatisfied entry rather than silently dropping it", () => {
    expect(() => defineProviderCustodyManifest([declaration(), declaration({ owner: "" })])).toThrow(/missing-owner/);
  });
});

describe("evaluateProviderCustody: accessor-safety and prototype-pollution resistance (mirrors credential.test.ts)", () => {
  it("never invokes a throwing top-level getter", () => {
    const hostile = { ...declaration() } as Record<string, unknown>;
    Object.defineProperty(hostile, "store", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });
    expect(() => evaluateProviderCustody(hostile)).not.toThrow();
    expect(evaluateProviderCustody(hostile).verdict).toBe("indeterminate");
  });

  it("never invokes a throwing getter nested inside rotationPolicy", () => {
    const hostilePolicy = {} as Record<string, unknown>;
    Object.defineProperty(hostilePolicy, "maxAgeDays", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });
    const hostile = declaration({ rotationPolicy: hostilePolicy as never });
    expect(() => evaluateProviderCustody(hostile)).not.toThrow();
    const result = evaluateProviderCustody(hostile);
    expect(result.verdict).toBe("violated");
    expect(rulesOf(result)).toContain("invalid-rotation-policy");
  });

  it("is not fooled by a scope/usedBy array whose Array.prototype.every and Symbol.iterator are polluted", () => {
    const everyDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "every");
    const iteratorDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
    if (everyDescriptor === undefined || iteratorDescriptor === undefined) throw new Error("array builtins unavailable");

    let result: ReturnType<typeof evaluateProviderCustody> | undefined;
    try {
      Object.defineProperty(Array.prototype, "every", { configurable: true, writable: true, value: () => true });
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        writable: true,
        value: function* () {
          yield "repository:admin";
        },
      });
      // An empty scope should still be rejected as missing-scope even though
      // the polluted Array.prototype.every would report "every element
      // passes" for any predicate -- readNonEmptyStringArray never calls it.
      result = evaluateProviderCustody(declaration({ scope: [] }));
    } finally {
      Object.defineProperty(Array.prototype, "every", everyDescriptor);
      Object.defineProperty(Array.prototype, Symbol.iterator, iteratorDescriptor);
    }
    expect(result?.verdict).toBe("violated");
    expect(rulesOf(result as ProviderCustodyEvaluation)).toContain("missing-scope");
  });

  it("rejects hostile scope/usedBy prototypes, accessors, and symbol-keyed entries", () => {
    const hostilePrototype = ["zone:edit:example.com"];
    Object.setPrototypeOf(hostilePrototype, {
      every: () => true,
      [Symbol.iterator]: function* () {
        yield "zone:edit:example.com";
      },
    });
    const accessorEntry = ["zone:edit:example.com"];
    Object.defineProperty(accessorEntry, "0", {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error("must not run");
      },
    });
    const symbolEntry = ["zone:edit:example.com"];
    Object.defineProperty(symbolEntry, Symbol("hidden"), { value: "account:admin", enumerable: true });

    for (const scope of [hostilePrototype, accessorEntry, symbolEntry]) {
      const result = evaluateProviderCustody(declaration({ scope: scope as never }));
      expect(result.verdict).toBe("violated");
      expect(rulesOf(result)).toContain("missing-scope");
    }
  });

  it("bounds array length before inspecting entries or allocating from it", () => {
    const huge: string[] = [];
    huge.length = 0xffff_ffff;
    const result = evaluateProviderCustody(declaration({ scope: huge }));
    expect(result.verdict).toBe("violated");
    expect(rulesOf(result)).toContain("missing-scope");
  });

  it("catches throwing proxy traps on the declaration and on an array field instead of letting them escape", () => {
    const throwingDeclaration = new Proxy({ ...declaration() }, {
      ownKeys() {
        throw new Error("must not escape");
      },
    });
    const throwingScope = new Proxy(["zone:edit:example.com"], {
      getOwnPropertyDescriptor() {
        throw new Error("must not escape");
      },
    });

    expect(() => evaluateProviderCustody(throwingDeclaration)).not.toThrow();
    expect(evaluateProviderCustody(throwingDeclaration).verdict).toBe("indeterminate");

    expect(() => evaluateProviderCustody(declaration({ scope: throwingScope as never }))).not.toThrow();
    const result = evaluateProviderCustody(declaration({ scope: throwingScope as never }));
    // Matches credential.ts's own convention for this exact case (see its
    // "catches throwing proxy traps" test): the outer catch-all converts a
    // mid-evaluation throw to indeterminate/invalid-declaration, not a
    // partial violated result built from whatever reasons had accumulated
    // before the throw.
    expect(result.verdict).toBe("indeterminate");
    expect(rulesOf(result)).toContain("invalid-declaration");
  });

  it("rejects inherited declarations and a custom-prototype rotationPolicy", () => {
    const inherited = Object.create(declaration()) as unknown;
    expect(rulesOf(evaluateProviderCustody(inherited) as ProviderCustodyEvaluation)).toEqual(["invalid-declaration"]);
    expect(evaluateProviderCustody(inherited).verdict).toBe("indeterminate");

    const inheritedPolicy = Object.create({ maxAgeDays: 90 }) as unknown;
    const result = evaluateProviderCustody(declaration({ rotationPolicy: inheritedPolicy as never }));
    expect(result.verdict).toBe("violated");
    expect(rulesOf(result)).toContain("invalid-rotation-policy");
  });
});
