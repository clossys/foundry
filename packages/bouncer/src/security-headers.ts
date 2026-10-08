/**
 * Site security-headers baseline.
 *
 * One call builds the development variant and the production variant from
 * the same input. The development variant may add `'unsafe-eval'` to
 * `script-src`. That addition is applied only while building the
 * development variant, and a production policy that still contains it is
 * discarded.
 *
 * Production script policy has two modes:
 *
 *   - `nonce` — `'nonce-…'` and `'strict-dynamic'`. No `'unsafe-inline'`,
 *     and no warning.
 *   - `static` — `'self'` and `'unsafe-inline'`, only when the caller
 *     declares an attributed framework exception. The result reports that
 *     exception as a warning. Without that exception the token is refused
 *     and is not emitted.
 *
 * Production also refuses `'unsafe-eval'`, `'wasm-unsafe-eval'`, a
 * scheme-only source (`http:`, `https:`, `ws:`, `wss:`), a source
 * containing `*`, and a `data:` or `blob:` source on every extension
 * directive. Style
 * `'unsafe-inline'` is accepted only from an attributed package declaration
 * whose package name is non-empty. This module does not invent a package
 * declaration.
 *
 * A caller source string that contains whitespace or `;`, including at
 * either end of the raw string, is refused before trimming. That string is
 * not emitted.
 *
 * A missing mode, a missing required directive (`object-src`, `base-uri`,
 * `frame-ancestors`), or a refused source returns `ok: false` and no header
 * map. The refused token is therefore absent from any emitted policy.
 *
 * A host source — one or more DNS labels of ASCII letters, digits, and `-`
 * (a label may start or end with `-`), with an optional trailing dot,
 * optional `host:port` or `host/path`, a scheme-less multi-label host,
 * or a bracketed IPv6 address — is emitted only from the caller's
 * `extensions` list. The same host in `scriptSources` is not copied into the
 * policy. A style
 * declaration source other than `'unsafe-inline'` is not copied into
 * `style-src` unless that exact source is also listed on `extensions`.
 */

export interface SiteSecurityHeadersInput {
  readonly script?:
    | {
        readonly mode: "nonce";
        readonly nonce: string;
      }
    | {
        readonly mode: "static";
        readonly frameworkException?: {
          readonly packageName: string;
        };
      };
  /** Additional `script-src` sources. Production may refuse some of them. */
  readonly scriptSources?: readonly string[];
  /**
   * Caller-supplied package declarations. A style `'unsafe-inline'` source
   * is accepted only when `packageName` is a non-empty string.
   */
  readonly styleDeclarations?: readonly {
    readonly packageName: string;
    readonly source: string;
  }[];
  /** Hosts and other sources emitted only when listed here. */
  readonly extensions?: readonly {
    readonly directive:
      | "script-src"
      | "style-src"
      | "img-src"
      | "font-src"
      | "connect-src"
      | "frame-src"
      | "media-src"
      | "worker-src";
    readonly source: string;
  }[];
}

export interface SiteSecurityHeaders {
  readonly "Content-Security-Policy": string;
  readonly "Strict-Transport-Security": "max-age=63072000; includeSubDomains";
  readonly "Referrer-Policy": "strict-origin-when-cross-origin";
  readonly "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()";
}

export interface SiteSecurityHeaderWarning {
  readonly directive: "script-src";
  readonly source: "'unsafe-inline'";
  readonly packageName: string;
}

export type SiteSecurityHeadersResult =
  | {
      readonly ok: true;
      readonly headers: SiteSecurityHeaders;
      readonly warnings: readonly SiteSecurityHeaderWarning[];
    }
  | {
      readonly ok: false;
      readonly reason: "missing-mode" | "missing-directive" | "refused-source";
      readonly refused: readonly string[];
    };

export interface SiteSecurityHeadersVariants {
  readonly development: SiteSecurityHeadersResult;
  readonly production: SiteSecurityHeadersResult;
}

const STRICT_TRANSPORT_SECURITY = "max-age=63072000; includeSubDomains" as const;
const REFERRER_POLICY = "strict-origin-when-cross-origin" as const;
const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=()" as const;

const DIRECTIVE_ORDER = [
  "default-src",
  "script-src",
  "style-src",
  "img-src",
  "font-src",
  "connect-src",
  "media-src",
  "frame-src",
  "worker-src",
  "object-src",
  "base-uri",
  "frame-ancestors",
] as const;

const EXTENSION_DIRECTIVES = new Set<string>([
  "script-src",
  "style-src",
  "img-src",
  "font-src",
  "connect-src",
  "frame-src",
  "media-src",
  "worker-src",
]);

type Variant = "development" | "production";

interface StyleDeclaration {
  readonly packageName: string;
  readonly source: string;
}

interface Extension {
  readonly directive: string;
  readonly source: string;
}

interface ReadySpec {
  readonly ok: true;
  readonly mode: "nonce" | "static";
  readonly nonce?: string;
  readonly frameworkPackage?: string;
  readonly scriptSources: readonly string[];
  readonly styleDeclarations: readonly StyleDeclaration[];
  readonly extensions: readonly Extension[];
}

type ReadResult = ReadySpec | { readonly ok: false; readonly reason: "missing-mode" | "missing-directive" | "refused-source"; readonly refused: readonly string[] };

function refusal(
  reason: "missing-mode" | "missing-directive" | "refused-source",
  refused: readonly string[],
): SiteSecurityHeadersResult {
  return Object.freeze({
    ok: false,
    reason,
    refused: Object.freeze([...dedupe(refused)]),
  });
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function isNonce(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9+/=_-]{1,256}$/.test(value);
}

function isUnsafeInline(source: string): boolean {
  return source.toLowerCase() === "'unsafe-inline'";
}

function isUnsafeEval(source: string): boolean {
  return source.toLowerCase() === "'unsafe-eval'";
}

function isDataOrBlobScriptSource(source: string): boolean {
  return /^data:/i.test(source) || /^blob:/i.test(source);
}

function isScriptWildcard(source: string): boolean {
  return source.includes("*");
}

/** Caller strings must be one CSP token; separators would split in serialize. */
function callerSourceHasSeparator(source: string): boolean {
  return /[\t\n\f\r ;]/.test(source);
}

const DNS_LABEL = "[a-zA-Z0-9-]+";

function isHostSource(source: string): boolean {
  if (isSchemeOnlyScriptSource(source)) return false;
  if (source.startsWith("*.") || source.includes("://")) return true;
  if (/^\[[^\]]+\](?::\d+)?(?:\/[^\s;]*)?$/.test(source)) return true;
  if (/^(?:\d{1,3}\.){3}\d{1,3}\.?(?::\d+)?(?:\/[^\s;]*)?$/.test(source)) return true;
  return new RegExp(
    `^${DNS_LABEL}(?:\\.${DNS_LABEL})*\\.?(?::\\d+)?(?:\\/[^\\s;]*)?$`,
  ).test(source);
}

function isSchemeOnlyScriptSource(source: string): boolean {
  return /^(https?|wss?|ws):$/i.test(source);
}

function isWasmUnsafeEval(source: string): boolean {
  return source.toLowerCase() === "'wasm-unsafe-eval'";
}

function collectRawSeparatorRefusals(input: SiteSecurityHeadersInput): string[] {
  const refused: string[] = [];
  if (Array.isArray(input.scriptSources)) {
    for (const entry of input.scriptSources) {
      if (typeof entry === "string" && callerSourceHasSeparator(entry)) refused.push(entry);
    }
  }
  if (Array.isArray(input.styleDeclarations)) {
    for (const entry of input.styleDeclarations) {
      if (entry !== null && typeof entry === "object") {
        const source = (entry as { source?: unknown }).source;
        if (typeof source === "string" && callerSourceHasSeparator(source)) refused.push(source);
      }
    }
  }
  if (Array.isArray(input.extensions)) {
    for (const entry of input.extensions) {
      if (entry !== null && typeof entry === "object") {
        const source = (entry as { source?: unknown }).source;
        if (typeof source === "string" && callerSourceHasSeparator(source)) refused.push(source);
      }
    }
  }
  return dedupe(refused);
}

function readStringList(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return undefined;
    const trimmed = entry.trim();
    if (trimmed === "") return undefined;
    out.push(trimmed);
  }
  return out;
}

function readStyleDeclarations(value: unknown): StyleDeclaration[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const out: StyleDeclaration[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") return undefined;
    const packageName = (entry as { packageName?: unknown }).packageName;
    const source = (entry as { source?: unknown }).source;
    if (typeof source !== "string" || source.trim() === "") return undefined;
    const name = typeof packageName === "string" ? packageName.trim() : "";
    out.push({ packageName: name, source: source.trim() });
  }
  return out;
}

function readExtensions(value: unknown): Extension[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const out: Extension[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") return undefined;
    const directive = (entry as { directive?: unknown }).directive;
    const source = (entry as { source?: unknown }).source;
    if (typeof directive !== "string" || typeof source !== "string") return undefined;
    const trimmedDirective = directive.trim();
    const trimmedSource = source.trim();
    if (trimmedDirective === "" || trimmedSource === "") return undefined;
    out.push({ directive: trimmedDirective, source: trimmedSource });
  }
  return out;
}

function readSpec(input: SiteSecurityHeadersInput): ReadResult {
  if (input === null || typeof input !== "object") {
    return { ok: false, reason: "missing-mode", refused: [] };
  }

  const rawSeparatorRefused = collectRawSeparatorRefusals(input);
  if (rawSeparatorRefused.length > 0) {
    return { ok: false, reason: "refused-source", refused: rawSeparatorRefused };
  }

  const scriptSources = readStringList(input.scriptSources);
  const styleDeclarations = readStyleDeclarations(input.styleDeclarations);
  const extensions = readExtensions(input.extensions);
  if (scriptSources === undefined || styleDeclarations === undefined || extensions === undefined) {
    return { ok: false, reason: "refused-source", refused: [] };
  }

  const script = input.script;
  if (script === undefined || script === null || typeof script !== "object") {
    return { ok: false, reason: "missing-mode", refused: [] };
  }
  if (script.mode !== "nonce" && script.mode !== "static") {
    return { ok: false, reason: "missing-mode", refused: [] };
  }

  if (script.mode === "nonce") {
    if (!isNonce(script.nonce)) {
      return { ok: false, reason: "missing-directive", refused: ["script-src"] };
    }
    return {
      ok: true,
      mode: "nonce",
      nonce: script.nonce,
      scriptSources,
      styleDeclarations,
      extensions,
    };
  }

  let frameworkPackage: string | undefined;
  const exception = script.frameworkException;
  if (exception !== undefined && exception !== null && typeof exception === "object") {
    const packageName = exception.packageName;
    if (typeof packageName === "string" && packageName.trim() !== "") {
      frameworkPackage = packageName.trim();
    }
  }

  return {
    ok: true,
    mode: "static",
    frameworkPackage,
    scriptSources,
    styleDeclarations,
    extensions,
  };
}

/**
 * Classifies one caller-supplied script source.
 * `"allow"` means the source may be emitted. Any other return value is the
 * token recorded on the refusal, and that token is not emitted.
 */
function classifyScriptSource(source: string, variant: Variant, staticAttributed: boolean): "allow" | string {
  if (isScriptWildcard(source)) return source;
  if (isDataOrBlobScriptSource(source)) return source;
  if (isUnsafeEval(source)) return variant === "production" ? "'unsafe-eval'" : "allow";
  if (variant === "production" && isWasmUnsafeEval(source)) return "'wasm-unsafe-eval'";
  if (variant === "production" && isSchemeOnlyScriptSource(source)) return source;
  if (isUnsafeInline(source)) return staticAttributed ? "allow" : "'unsafe-inline'";
  return "allow";
}

function collectScriptSources(spec: ReadySpec, variant: Variant): { sources: string[]; refused: string[] } {
  const sources: string[] = [];
  const refused: string[] = [];
  const staticAttributed = spec.mode === "static" && spec.frameworkPackage !== undefined;

  if (spec.mode === "nonce") {
    sources.push(`'nonce-${spec.nonce}'`, "'strict-dynamic'");
  } else {
    sources.push("'self'");
    if (staticAttributed) sources.push("'unsafe-inline'");
    else refused.push("'unsafe-inline'");
  }

  for (const source of spec.scriptSources) {
    if (isHostSource(source)) continue;
    const decision = classifyScriptSource(source, variant, staticAttributed);
    if (decision === "allow") sources.push(isUnsafeEval(source) ? "'unsafe-eval'" : isUnsafeInline(source) ? "'unsafe-inline'" : source);
    else refused.push(decision);
  }

  for (const extension of spec.extensions) {
    if (extension.directive !== "script-src") continue;
    const decision = classifyScriptSource(extension.source, variant, staticAttributed);
    if (decision === "allow") {
      sources.push(isUnsafeEval(extension.source) ? "'unsafe-eval'" : isUnsafeInline(extension.source) ? "'unsafe-inline'" : extension.source);
    } else {
      refused.push(decision);
    }
  }

  if (variant === "development") sources.push("'unsafe-eval'");

  return { sources: dedupe(sources), refused: dedupe(refused) };
}

function collectStyleSources(spec: ReadySpec): { sources: string[]; refused: string[] } {
  const sources = ["'self'"];
  const refused: string[] = [];
  const extensionStyleSources = new Set(
    spec.extensions
      .filter((extension) => extension.directive === "style-src" && !isUnsafeInline(extension.source))
      .map((extension) => extension.source),
  );
  const inlineDeclarations = spec.styleDeclarations.filter((declaration) => isUnsafeInline(declaration.source));
  const attributed = inlineDeclarations.some((declaration) => declaration.packageName !== "");
  const unattributedDeclaration = inlineDeclarations.some((declaration) => declaration.packageName === "");
  const unattributedExtension = spec.extensions.some(
    (extension) => extension.directive === "style-src" && isUnsafeInline(extension.source),
  );

  if ((unattributedDeclaration || unattributedExtension) && !attributed) {
    refused.push("'unsafe-inline'");
  } else if (attributed) {
    sources.push("'unsafe-inline'");
  }

  for (const declaration of spec.styleDeclarations) {
    if (isUnsafeInline(declaration.source)) continue;
    if (declaration.packageName === "") refused.push(declaration.source);
    else if (extensionStyleSources.has(declaration.source)) sources.push(declaration.source);
  }

  for (const extension of spec.extensions) {
    if (extension.directive !== "style-src" || isUnsafeInline(extension.source)) continue;
    sources.push(extension.source);
  }

  return { sources: dedupe(sources), refused: dedupe(refused) };
}

function addSources(directives: Map<string, string[]>, directive: string, sources: readonly string[]): void {
  const existing = directives.get(directive) ?? [];
  directives.set(directive, dedupe([...existing, ...sources]));
}

function missingRequired(directives: ReadonlyMap<string, readonly string[]>): string[] {
  const missing: string[] = [];
  if (directives.get("object-src")?.join(" ") !== "'none'") missing.push("object-src");
  if (directives.get("base-uri")?.join(" ") !== "'self'") missing.push("base-uri");
  if (directives.get("frame-ancestors")?.join(" ") !== "'none'") missing.push("frame-ancestors");
  return missing;
}

function serialize(directives: ReadonlyMap<string, readonly string[]>): string {
  const parts: string[] = [];
  for (const name of DIRECTIVE_ORDER) {
    const sources = directives.get(name);
    if (sources === undefined || sources.length === 0) continue;
    parts.push(`${name} ${sources.join(" ")}`);
  }
  return parts.join("; ");
}

function productionForbiddenSource(source: string): string | undefined {
  if (isUnsafeEval(source)) return "'unsafe-eval'";
  if (isWasmUnsafeEval(source)) return "'wasm-unsafe-eval'";
  if (isSchemeOnlyScriptSource(source)) return source;
  if (isScriptWildcard(source)) return source;
  if (isDataOrBlobScriptSource(source)) return source;
  return undefined;
}

function productionScriptSourceRefusal(source: string, staticAttributed: boolean): string | undefined {
  const forbidden = productionForbiddenSource(source);
  if (forbidden !== undefined) return forbidden;
  if (isUnsafeInline(source) && !staticAttributed) return "'unsafe-inline'";
  return undefined;
}

function productionDirectiveMapRefusal(
  directives: ReadonlyMap<string, readonly string[]>,
  spec: ReadySpec,
): string | undefined {
  const staticAttributed = spec.mode === "static" && spec.frameworkPackage !== undefined;
  for (const [directive, sources] of directives) {
    for (const source of sources) {
      if (directive === "script-src") {
        const violated = productionScriptSourceRefusal(source, staticAttributed);
        if (violated !== undefined) return violated;
      } else {
        const violated = productionForbiddenSource(source);
        if (violated !== undefined) return violated;
      }
    }
  }
  return undefined;
}

function buildVariant(spec: ReadySpec, variant: Variant): SiteSecurityHeadersResult {
  const script = collectScriptSources(spec, variant);
  const style = collectStyleSources(spec);
  const refused = [...script.refused, ...style.refused];

  for (const extension of spec.extensions) {
    if (extension.directive === "script-src" || extension.directive === "style-src") continue;
    if (!EXTENSION_DIRECTIVES.has(extension.directive)) refused.push(extension.source);
  }

  if (refused.length > 0) return refusal("refused-source", refused);

  const directives = new Map<string, string[]>();
  addSources(directives, "default-src", ["'self'"]);
  addSources(directives, "script-src", script.sources);
  addSources(directives, "style-src", style.sources);
  addSources(directives, "object-src", ["'none'"]);
  addSources(directives, "base-uri", ["'self'"]);
  addSources(directives, "frame-ancestors", ["'none'"]);

  for (const extension of spec.extensions) {
    if (extension.directive === "script-src" || extension.directive === "style-src") continue;
    if (!EXTENSION_DIRECTIVES.has(extension.directive)) continue;
    const sources = extension.directive === "frame-src"
      ? [extension.source]
      : ["'self'", extension.source];
    addSources(directives, extension.directive, sources);
  }

  const missing = missingRequired(directives);
  if (missing.length > 0) return refusal("missing-directive", missing);

  if (variant === "production") {
    const violated = productionDirectiveMapRefusal(directives, spec);
    if (violated !== undefined) return refusal("refused-source", [violated]);
  }

  const warnings: SiteSecurityHeaderWarning[] =
    spec.mode === "static" && spec.frameworkPackage !== undefined
      ? [
          {
            directive: "script-src",
            source: "'unsafe-inline'",
            packageName: spec.frameworkPackage,
          },
        ]
      : [];

  const headers: SiteSecurityHeaders = {
    "Content-Security-Policy": serialize(directives),
    "Strict-Transport-Security": STRICT_TRANSPORT_SECURITY,
    "Referrer-Policy": REFERRER_POLICY,
    "Permissions-Policy": PERMISSIONS_POLICY,
  };

  return Object.freeze({
    ok: true,
    headers: Object.freeze(headers),
    warnings: Object.freeze(warnings.map((warning) => Object.freeze(warning))),
  });
}

/**
 * Builds the development and production security-header variants for a site
 * surface from one input. The caller applies the returned header map.
 * Package declarations and extension hosts come only from that input.
 */
export function createSiteSecurityHeaders(input: SiteSecurityHeadersInput): SiteSecurityHeadersVariants {
  const spec = readSpec(input);
  if (!spec.ok) {
    return Object.freeze({
      development: refusal(spec.reason, spec.refused),
      production: refusal(spec.reason, spec.refused),
    });
  }

  return Object.freeze({
    development: buildVariant(spec, "development"),
    production: buildVariant(spec, "production"),
  });
}
