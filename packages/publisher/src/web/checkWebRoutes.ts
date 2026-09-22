/**
 * Pure check for publishing web routes: every route must name a template
 * from the registered set (`listWebTemplateNames()` on the consumer's own
 * `createWebRenderer` instance, plus any shipped names they include).
 * Direct Designer block composition in a route file is refused (issue #1103).
 */

export interface WebRouteManifestEntry {
  /** Stable route id or URL path — echoed in findings only. */
  id: string;
  /** `SurfaceDocument.template` string this route publishes. */
  template?: string;
  /** Optional source file path, relative to the scan root. */
  file?: string;
}

export interface WebRouteManifest {
  /** Every template name the consumer's renderer registers, including shipped names when `includeBuiltins` is true. */
  registeredTemplates: readonly string[];
  routes: readonly WebRouteManifestEntry[];
}

export interface WebRouteFinding {
  rule: string;
  routeId: string;
  message: string;
  file?: string;
}

export interface WebRouteCheckResult {
  exitCode: number;
  findings: WebRouteFinding[];
}

const TEMPLATE_LITERAL_RE = /\btemplate\s*:\s*["']([^"']+)["']/g;
const DESIGNER_BLOCKS_IMPORT_RE = /@clossys\/designer\/blocks(?:\/|$)/;
const DIRECT_BLOCK_JSX_RE = /<(?:Hero|FeatureGrid|Faq|OrderedStepSequence|StatusList|Stat|PageHeader|SectionHeader|MarketingChapter)\b/;

export function evaluateWebRouteManifest(manifest: WebRouteManifest): WebRouteCheckResult {
  const findings: WebRouteFinding[] = [];
  const known = new Set(manifest.registeredTemplates ?? []);

  for (const route of manifest.routes ?? []) {
    const template = route.template?.trim();
    if (!template) {
      findings.push({
        rule: "missing-template",
        routeId: route.id,
        file: route.file,
        message: `Route "${route.id}" does not name a registered web template. Every publishing web route must set SurfaceDocument.template to a name from listWebTemplateNames().`,
      });
      continue;
    }
    if (!known.has(template)) {
      findings.push({
        rule: "unknown-template",
        routeId: route.id,
        file: route.file,
        message: `Route "${route.id}" names template "${template}", which is not in the registered template list: ${[...known].join(", ") || "(none)"}.`,
      });
    }
  }

  return { exitCode: findings.length === 0 ? 0 : 1, findings };
}

export function scanRouteSourceForDirectComposition(source: string, routeId: string, file?: string): WebRouteFinding[] {
  const findings: WebRouteFinding[] = [];
  if (DESIGNER_BLOCKS_IMPORT_RE.test(source) && DIRECT_BLOCK_JSX_RE.test(source)) {
    findings.push({
      rule: "direct-block-composition",
      routeId,
      file,
      message: `Route "${routeId}" composes @clossys/designer blocks directly in a route file. Register defineWebTemplate blocks or name a shipped template instead.`,
    });
  }
  return findings;
}

export function extractTemplateNameFromSource(source: string): string | undefined {
  const match = TEMPLATE_LITERAL_RE.exec(source);
  TEMPLATE_LITERAL_RE.lastIndex = 0;
  return match?.[1];
}

export function evaluateWebRouteManifestWithSources(manifest: WebRouteManifest, sources: Readonly<Record<string, string>>): WebRouteCheckResult {
  const base = evaluateWebRouteManifest(manifest);
  const findings = [...base.findings];

  for (const route of manifest.routes ?? []) {
    if (!route.file) continue;
    const source = sources[route.file];
    if (source === undefined) continue;
    findings.push(...scanRouteSourceForDirectComposition(source, route.id, route.file));
    if (!route.template) {
      const inferred = extractTemplateNameFromSource(source);
      if (inferred) {
        const known = new Set(manifest.registeredTemplates ?? []);
        if (!known.has(inferred)) {
          findings.push({
            rule: "unknown-template",
            routeId: route.id,
            file: route.file,
            message: `Route file "${route.file}" names template "${inferred}", which is not registered.`,
          });
        }
      }
    }
  }

  return { exitCode: findings.length === 0 ? 0 : 1, findings };
}
