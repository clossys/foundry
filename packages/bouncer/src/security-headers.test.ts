/**
 * The site security-headers baseline: one call returns the development
 * variant and the production variant. Refusals carry no header map, so a
 * refused token is absent from the emitted policy.
 */
import { describe, expect, it } from "vitest";
import { createSiteSecurityHeaders } from "./index.js";
import type { SiteSecurityHeadersResult } from "./index.js";

function emittedPolicy(result: SiteSecurityHeadersResult): string {
  return result.ok ? result.headers["Content-Security-Policy"] : "";
}

const PRODUCTION_NONCE_POLICY =
  "default-src 'self'; script-src 'nonce-n' 'strict-dynamic'; style-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

describe("site security-headers baseline", () => {
  it("production nonce has no 'unsafe-inline' and no warning", () => {
    const result = createSiteSecurityHeaders({
      script: { mode: "nonce", nonce: "n" },
    });

    expect(result.production.ok).toBe(true);
    if (!result.production.ok) return;

    expect(result.production.headers["Content-Security-Policy"]).toBe(PRODUCTION_NONCE_POLICY);
    expect(result.production.headers["Content-Security-Policy"]).not.toContain("'unsafe-inline'");
    expect(result.production.warnings).toEqual([]);
    expect(result.production.headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(result.production.headers["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=(), payment=()");
    expect(result.production.headers["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(result.production.headers["Content-Security-Policy"]).toContain("base-uri 'self'");
    expect(result.production.headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
  });

  it("production static warns and emits the declared exception", () => {
    const declared = createSiteSecurityHeaders({
      script: {
        mode: "static",
        frameworkException: { packageName: "example-framework" },
      },
    });

    expect(declared.production.ok).toBe(true);
    if (!declared.production.ok) return;

    expect(declared.production.headers["Content-Security-Policy"]).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    expect(declared.production.warnings).toEqual([
      {
        directive: "script-src",
        source: "'unsafe-inline'",
        packageName: "example-framework",
      },
    ]);

    const undeclared = createSiteSecurityHeaders({ script: { mode: "static" } });
    expect(undeclared.production.ok).toBe(false);
    if (!undeclared.production.ok) {
      expect(undeclared.production.reason).toBe("refused-source");
      expect(undeclared.production.refused).toContain("'unsafe-inline'");
    }
    expect(emittedPolicy(undeclared.production)).not.toContain("'unsafe-inline'");
  });

  it("production refuses 'unsafe-eval', a script wildcard, and data: and blob: script sources", () => {
    for (const source of ["'unsafe-eval'", "*", "data:", "blob:"]) {
      const result = createSiteSecurityHeaders({
        script: { mode: "nonce", nonce: "n" },
        scriptSources: [source],
      });

      expect(result.production.ok).toBe(false);
      if (!result.production.ok) {
        expect(result.production.reason).toBe("refused-source");
        expect(result.production.refused).toContain(source);
        expect("headers" in result.production).toBe(false);
      }
      expect(emittedPolicy(result.production)).not.toContain(source);
    }
  });

  it("style 'unsafe-inline' without an attributed package is refused", () => {
    const refused = createSiteSecurityHeaders({
      script: { mode: "nonce", nonce: "n" },
      styleDeclarations: [{ packageName: "", source: "'unsafe-inline'" }],
    });

    expect(refused.production.ok).toBe(false);
    if (!refused.production.ok) {
      expect(refused.production.reason).toBe("refused-source");
      expect(refused.production.refused).toContain("'unsafe-inline'");
    }
    expect(emittedPolicy(refused.production)).not.toContain("'unsafe-inline'");

    const accepted = createSiteSecurityHeaders({
      script: { mode: "nonce", nonce: "n" },
      styleDeclarations: [{ packageName: "example-ui", source: "'unsafe-inline'" }],
    });

    expect(accepted.production.ok).toBe(true);
    if (!accepted.production.ok) return;
    expect(accepted.production.headers["Content-Security-Policy"]).toContain("style-src 'self' 'unsafe-inline'");
    expect(accepted.production.warnings).toEqual([]);
  });

  it("HSTS has no preload", () => {
    const result = createSiteSecurityHeaders({
      script: { mode: "nonce", nonce: "n" },
    });

    expect(result.production.ok).toBe(true);
    expect(result.development.ok).toBe(true);
    if (!result.production.ok || !result.development.ok) return;

    expect(result.production.headers["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
    expect(result.production.headers["Strict-Transport-Security"]).not.toContain("preload");
    expect(result.development.headers["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
    expect(result.development.headers["Strict-Transport-Security"]).not.toContain("preload");
  });

  it("a development-only 'unsafe-eval' is absent from production", () => {
    const result = createSiteSecurityHeaders({
      script: { mode: "nonce", nonce: "n" },
    });

    expect(result.development.ok).toBe(true);
    expect(result.production.ok).toBe(true);
    if (!result.development.ok || !result.production.ok) return;

    expect(result.development.headers["Content-Security-Policy"]).toBe(
      "default-src 'self'; script-src 'nonce-n' 'strict-dynamic' 'unsafe-eval'; style-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    expect(result.development.headers["Content-Security-Policy"]).toContain("'unsafe-eval'");
    expect(result.production.headers["Content-Security-Policy"]).toBe(PRODUCTION_NONCE_POLICY);
    expect(result.production.headers["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
  });

  it("refuses a script source string that embeds another token", () => {
    const embeddedEval = createSiteSecurityHeaders({
      script: { mode: "nonce", nonce: "n" },
      scriptSources: ["https://cdn.example 'unsafe-eval'"],
    });

    expect(embeddedEval.production.ok).toBe(false);
    if (!embeddedEval.production.ok) {
      expect(embeddedEval.production.reason).toBe("refused-source");
      expect(embeddedEval.production.refused).toContain("https://cdn.example 'unsafe-eval'");
    }
    expect(emittedPolicy(embeddedEval.production)).not.toContain("'unsafe-eval'");

    const semicolonBreakout = createSiteSecurityHeaders({
      script: { mode: "nonce", nonce: "n" },
      scriptSources: ["https://cdn.example; script-src-elem 'unsafe-inline'"],
    });

    expect(semicolonBreakout.production.ok).toBe(false);
    if (!semicolonBreakout.production.ok) {
      expect(semicolonBreakout.production.refused).toContain(
        "https://cdn.example; script-src-elem 'unsafe-inline'",
      );
    }
    expect(emittedPolicy(semicolonBreakout.production)).not.toContain("script-src-elem");

    for (const source of ["https://cdn.example\nevil", "https://cdn.example\tevil"]) {
      const result = createSiteSecurityHeaders({
        script: { mode: "nonce", nonce: "n" },
        scriptSources: [source],
      });

      expect(result.production.ok).toBe(false);
      if (!result.production.ok) {
        expect(result.production.refused).toContain(source);
      }
    }
  });

  it("refuses an extension source string that embeds another directive", () => {
    const result = createSiteSecurityHeaders({
      script: { mode: "nonce", nonce: "n" },
      extensions: [
        {
          directive: "frame-src",
          source: "https://video.example; frame-ancestors https://evil.example",
        },
      ],
    });

    expect(result.production.ok).toBe(false);
    if (!result.production.ok) {
      expect(result.production.reason).toBe("refused-source");
      expect(result.production.refused).toContain(
        "https://video.example; frame-ancestors https://evil.example",
      );
    }
    expect(emittedPolicy(result.production)).not.toContain("https://evil.example");
    if (result.production.ok) return;
    expect("headers" in result.production).toBe(false);
  });

  it("does not copy a script host from scriptSources; extensions still emit it", () => {
    const host = "https://cdn.example";
    const absent = createSiteSecurityHeaders({
      script: { mode: "nonce", nonce: "n" },
      scriptSources: [host],
    });

    expect(absent.production.ok).toBe(true);
    if (!absent.production.ok) return;
    expect(absent.production.headers["Content-Security-Policy"]).toBe(PRODUCTION_NONCE_POLICY);
    expect(absent.production.headers["Content-Security-Policy"]).not.toContain(host);

    const present = createSiteSecurityHeaders({
      script: { mode: "nonce", nonce: "n" },
      extensions: [{ directive: "script-src", source: host }],
    });

    expect(present.production.ok).toBe(true);
    if (!present.production.ok) return;
    expect(present.production.headers["Content-Security-Policy"]).toContain(`script-src 'nonce-n' 'strict-dynamic' ${host}`);
  });

  it("does not copy a style host from declarations unless it is also on extensions", () => {
    const host = "https://fonts.example";
    const fontsPackage = "example-fonts";
    const withoutExtension = createSiteSecurityHeaders({
      script: { mode: "nonce", nonce: "n" },
      styleDeclarations: [{ packageName: fontsPackage, source: host }],
    });

    expect(withoutExtension.production.ok).toBe(true);
    if (!withoutExtension.production.ok) return;
    expect(withoutExtension.production.headers["Content-Security-Policy"]).toBe(PRODUCTION_NONCE_POLICY);
    expect(withoutExtension.production.headers["Content-Security-Policy"]).not.toContain(host);

    const withInline = createSiteSecurityHeaders({
      script: { mode: "nonce", nonce: "n" },
      styleDeclarations: [
        { packageName: "example-ui", source: "'unsafe-inline'" },
        { packageName: fontsPackage, source: host },
      ],
    });

    expect(withInline.production.ok).toBe(true);
    if (!withInline.production.ok) return;
    expect(withInline.production.headers["Content-Security-Policy"]).toContain("style-src 'self' 'unsafe-inline'");
    expect(withInline.production.headers["Content-Security-Policy"]).not.toContain(host);
  });

  it("production refuses scheme-only script sources and 'wasm-unsafe-eval'", () => {
    for (const source of ["https:", "http:", "ws:", "wss:", "'wasm-unsafe-eval'"]) {
      const result = createSiteSecurityHeaders({
        script: { mode: "nonce", nonce: "n" },
        scriptSources: [source],
      });

      expect(result.production.ok).toBe(false);
      if (!result.production.ok) {
        expect(result.production.reason).toBe("refused-source");
        expect(result.production.refused).toContain(source);
        expect("headers" in result.production).toBe(false);
      }
      expect(emittedPolicy(result.production)).not.toContain(source);
    }
  });

  it("does not copy label-edge-hyphen, single-label, trailing-dot, port, path, IPv4, or IPv6 hosts from scriptSources", () => {
    for (const host of [
      "cdn-.example",
      "-localhost",
      "localhost-",
      "cdn-.example.:443",
      "cdn-.example/a.js",
      "--localhost",
      "local-host",
      "localhost",
      "localhost:443",
      "localhost/a.js",
      "cdn.example",
      "cdn.example.",
      "cdn.example.:443",
      "cdn.example:443",
      "cdn.example/a.js",
      "192.0.2.10",
      "192.0.2.10.",
      "[2001:db8::1]",
    ]) {
      const absent = createSiteSecurityHeaders({
        script: { mode: "nonce", nonce: "n" },
        scriptSources: [host],
      });

      expect(absent.production.ok).toBe(true);
      if (!absent.production.ok) return;
      expect(absent.production.headers["Content-Security-Policy"]).toBe(PRODUCTION_NONCE_POLICY);
      expect(absent.production.headers["Content-Security-Policy"]).not.toContain(host);

      const present = createSiteSecurityHeaders({
        script: { mode: "nonce", nonce: "n" },
        extensions: [{ directive: "script-src", source: host }],
      });

      expect(present.production.ok).toBe(true);
      if (!present.production.ok) return;
      expect(present.production.headers["Content-Security-Policy"]).toContain(host);
    }
  });

  it("refuses raw caller strings with leading or trailing whitespace before trim", () => {
    for (const source of ["\thttps://cdn.example", " 'sha256-abc'", "\fhttps://fonts.example"]) {
      const result = createSiteSecurityHeaders({
        script: { mode: "nonce", nonce: "n" },
        scriptSources: [source],
      });

      expect(result.production.ok).toBe(false);
      if (!result.production.ok) {
        expect(result.production.reason).toBe("refused-source");
        expect(result.production.refused).toContain(source);
      }
      expect(emittedPolicy(result.production)).not.toContain("cdn.example");
      expect(emittedPolicy(result.production)).not.toContain("fonts.example");
    }
  });

  it("production refuses forbidden sources on worker-src and style-src extensions", () => {
    for (const [directive, source] of [
      ["worker-src", "https:"],
      ["worker-src", "'wasm-unsafe-eval'"],
      ["worker-src", "'unsafe-eval'"],
      ["worker-src", "*"],
      ["worker-src", "blob:"],
      ["style-src", "https:"],
    ] as const) {
      const result = createSiteSecurityHeaders({
        script: { mode: "nonce", nonce: "n" },
        extensions: [{ directive, source }],
      });

      expect(result.production.ok).toBe(false);
      if (!result.production.ok) {
        expect(result.production.reason).toBe("refused-source");
        expect(result.production.refused).toContain(source);
      }
      expect(emittedPolicy(result.production)).not.toContain(source);
    }
  });

  it("a host that is not on the extension list is absent", () => {
    const listed = "https://video.example.test";
    const absent = "https://other.example.test";
    const result = createSiteSecurityHeaders({
      script: { mode: "nonce", nonce: "n" },
      extensions: [{ directive: "frame-src", source: listed }],
    });

    expect(result.production.ok).toBe(true);
    expect(result.development.ok).toBe(true);
    if (!result.production.ok || !result.development.ok) return;

    expect(result.production.headers["Content-Security-Policy"]).toBe(
      `default-src 'self'; script-src 'nonce-n' 'strict-dynamic'; style-src 'self'; frame-src ${listed}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
    );
    expect(result.production.headers["Content-Security-Policy"]).toContain(listed);
    expect(result.production.headers["Content-Security-Policy"]).not.toContain(absent);
    expect(result.development.headers["Content-Security-Policy"]).toContain(listed);
    expect(result.development.headers["Content-Security-Policy"]).not.toContain(absent);
  });
});
