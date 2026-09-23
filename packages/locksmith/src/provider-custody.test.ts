import { describe, expect, it } from "vitest";
import {
  defineProviderCustody,
  defineProviderCustodyManifest,
  evaluateProviderCustody,
  providerCustodyOf,
} from "./index.js";
import type { ProviderCustodyDeclaration } from "./index.js";

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
      reasons: [],
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
    expect(result.reasons).toContain("invalid-rotation-policy");
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
    expect(result.reasons).toEqual(["unsupported-fields"]);
    expect(JSON.stringify(result)).not.toContain("sk_live_should_never_appear");
  });

  it("rejects an unsupported provider", () => {
    const result = evaluateProviderCustody(declaration({ provider: "aws" as never }));
    expect(result.verdict).toBe("violated");
    expect(result.reasons).toContain("unsupported-provider");
    expect(result.provider).toBeNull();
  });

  it("rejects an unsupported rung", () => {
    const result = evaluateProviderCustody(declaration({ rung: "hardcoded-in-source" as never }));
    expect(result.verdict).toBe("violated");
    expect(result.reasons).toContain("unsupported-rung");
    expect(result.rung).toBeNull();
  });

  it("rejects a missing or empty owner", () => {
    expect(evaluateProviderCustody(declaration({ owner: "" })).reasons).toContain("missing-owner");
    const { owner: _omitted, ...withoutOwner } = declaration();
    expect(evaluateProviderCustody(withoutOwner).reasons).toContain("missing-owner");
  });

  it.each(["repository", "repo", ".env", "source", "committed", "git", "REPOSITORY", "  Repo  "])(
    "rejects a store literal that names this repository: %s",
    (store) => {
      const result = evaluateProviderCustody(declaration({ store }));
      expect(result.verdict).toBe("violated");
      expect(result.reasons).toContain("store-is-repository");
    },
  );

  it("accepts a store that merely mentions a provider-side project, not this repository", () => {
    expect(evaluateProviderCustody(declaration({ store: "vercel-project-env:foundry-site" })).verdict).toBe("satisfied");
  });

  it("rejects an empty scope", () => {
    const result = evaluateProviderCustody(declaration({ scope: [] }));
    expect(result.verdict).toBe("violated");
    expect(result.reasons).toContain("missing-scope");
  });

  it("rejects a missing or empty least-privilege note", () => {
    expect(evaluateProviderCustody(declaration({ leastPrivilegeNote: "   " })).reasons).toContain("missing-least-privilege-note");
  });

  it("rejects a missing or empty usedBy", () => {
    expect(evaluateProviderCustody(declaration({ usedBy: [] })).reasons).toContain("missing-used-by");
  });

  it("rejects a malformed rotation policy shape without accepting extra fields on it", () => {
    expect(evaluateProviderCustody(declaration({ rotationPolicy: { maxAgeDays: 90, extra: true } as never })).reasons).toContain("invalid-rotation-policy");
    expect(evaluateProviderCustody(declaration({ rotationPolicy: { maxAgeDays: -1 } })).reasons).toContain("invalid-rotation-policy");
    expect(evaluateProviderCustody(declaration({ rotationPolicy: { maxAgeDays: 0 } })).reasons).toContain("invalid-rotation-policy");
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
    expect(new Set(result.reasons)).toEqual(
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
