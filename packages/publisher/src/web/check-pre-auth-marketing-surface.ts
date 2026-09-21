/**
 * Pure gate: a pre-auth marketing `SurfaceDocument` must mount `MarketingView`
 * with the fold slots Designer/Writer gates assume — not `SectionedView` or
 * another document assembler.
 */

export interface PreAuthMarketingFinding {
  readonly rule: string;
  readonly message: string;
  readonly path?: string;
}

export interface PreAuthMarketingReport {
  readonly ok: boolean;
  readonly findings: readonly PreAuthMarketingFinding[];
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finding(rule: string, message: string, path?: string): PreAuthMarketingFinding {
  return path === undefined ? { rule, message } : { rule, message, path };
}

function isRepeatingBinding(binding: UnknownRecord): boolean {
  return Array.isArray(binding.items);
}

function slotFilled(binding: UnknownRecord): boolean {
  if (isRepeatingBinding(binding)) return true;
  return binding.copy !== undefined || binding.node !== undefined || binding.assetId !== undefined;
}

function bindingForSlot(bindings: UnknownRecord[], slot: string): UnknownRecord | undefined {
  return bindings.find((b) => b.slot === slot);
}

/**
 * Checks whether `input` is a `SurfaceDocument` shaped for a pre-auth
 * marketing page on `MarketingView`. Does not resolve copy or render HTML.
 */
export function checkPreAuthMarketingSurface(input: unknown): PreAuthMarketingReport {
  if (!record(input)) {
    return { ok: false, findings: [finding("surface-shape", "Input must be a SurfaceDocument object.", "$")] };
  }

  const findings: PreAuthMarketingFinding[] = [];

  if (input.channel !== "web") {
    findings.push(finding("channel-web", 'Pre-auth marketing surfaces must use channel "web".', "channel"));
  }

  const template = input.template;
  if (typeof template !== "string" || template.trim().length === 0) {
    findings.push(finding("template-required", "template must be a non-empty string.", "template"));
  } else if (template === "SectionedView") {
    findings.push(
      finding(
        "sectioned-view-not-pre-auth",
        'SectionedView is a closed five-kind document assembler, not the pre-auth marketing template. Use template "MarketingView" (or compose Designer blocks directly).',
        "template",
      ),
    );
  } else if (template !== "MarketingView") {
    findings.push(
      finding(
        "template-marketing-view",
        'Pre-auth marketing surfaces must use template "MarketingView".',
        "template",
      ),
    );
  }

  const bindings = input.bindings;
  if (!Array.isArray(bindings)) {
    findings.push(finding("bindings-array", "bindings must be an array.", "bindings"));
    return { ok: false, findings };
  }

  const bindingRecords = bindings.filter(record);

  for (const required of ["brand", "heroHeading", "ctaHeading"] as const) {
    const binding = bindingForSlot(bindingRecords, required);
    if (binding === undefined || !slotFilled(binding)) {
      findings.push(
        finding(
          "required-slot-missing",
          `MarketingView requires a filled "${required}" slot for a pre-auth page.`,
          `bindings.${required}`,
        ),
      );
    }
  }

  const heroActions = bindingForSlot(bindingRecords, "heroActions");
  if (heroActions === undefined || !slotFilled(heroActions)) {
    findings.push(
      finding(
        "hero-actions-missing",
        'Pre-auth marketing surfaces must bind "heroActions" so the fold carries a primary CTA (Designer fold-check counts it).',
        "bindings.heroActions",
      ),
    );
  }

  const features = bindingForSlot(bindingRecords, "features");
  if (features === undefined || !isRepeatingBinding(features)) {
    findings.push(
      finding(
        "features-group-missing",
        'MarketingView requires a repeating "features" binding (items may be empty).',
        "bindings.features",
      ),
    );
  }

  return { ok: findings.length === 0, findings };
}
