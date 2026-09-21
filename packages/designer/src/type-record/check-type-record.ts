/**
 * `checkTypeRecord` — validates an authored type-scale record (schemaVersion 1).
 * The check executes this record as authored; it does not invent fonts or
 * pairings at runtime. Optional `brandDeclarations` cross-check `--font-display` and
 * `--text-display-l` when a consumer supplies parsed brand CSS.
 */

export const TYPE_RECORD_SCHEMA_VERSION = 1;

export const FONT_DISPLAY_PROPERTY = "--font-display";
export const TEXT_DISPLAY_L_PROPERTY = "--text-display-l";

export const MONO_RESERVED_ROLES = ["eyebrow", "data", "code"] as const;
export type MonoReservedRole = (typeof MONO_RESERVED_ROLES)[number];

const MONO_RESERVED_SET = new Set<string>(MONO_RESERVED_ROLES);

export type TypeRecordState = "satisfied" | "violated" | "indeterminate";

export interface TypeRecordFinding {
  readonly rule: string;
  readonly message: string;
  readonly path?: string;
}

export interface TypeRecordCheckResult {
  readonly state: TypeRecordState;
  readonly findings: readonly TypeRecordFinding[];
}

export interface TypeRecord {
  readonly schemaVersion: 1;
  readonly displayFace: string;
  readonly h1MinimumPx: number;
  readonly measureCapCh: number;
  readonly monoReservedFor: readonly MonoReservedRole[];
  readonly wrapRule?: string;
}

export interface TypeRecordCheckOptions {
  /** Parsed custom-property declarations from `readBrandCss`, when supplied. */
  readonly brandDeclarations?: Readonly<Record<string, string>>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finding(rule: string, message: string, path?: string): TypeRecordFinding {
  return path === undefined ? { rule, message } : { rule, message, path };
}

function result(state: TypeRecordState, findings: readonly TypeRecordFinding[]): TypeRecordCheckResult {
  return { state, findings };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function parsePositivePx(value: string): number | null {
  const match = /^([\d.]+)px$/i.exec(value.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function validateRecordShape(record: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; findings: TypeRecordFinding[] } {
  if (!isPlainObject(record)) {
    return { ok: false, findings: [finding("record-shape", "Type record must be a JSON object.", "$")] };
  }
  if (record.schemaVersion !== TYPE_RECORD_SCHEMA_VERSION) {
    return {
      ok: false,
      findings: [finding("schema-version", `schemaVersion must be ${TYPE_RECORD_SCHEMA_VERSION}.`, "schemaVersion")],
    };
  }
  return { ok: true, value: record };
}

function validateRequiredFields(record: Record<string, unknown>): { parsed?: TypeRecord; findings: TypeRecordFinding[] } {
  const findings: TypeRecordFinding[] = [];

  if (!("displayFace" in record)) {
    findings.push(finding("display-face-required", "displayFace is required.", "displayFace"));
  } else if (!nonEmptyString(record.displayFace)) {
    findings.push(finding("display-face-empty", "displayFace must be a non-empty string.", "displayFace"));
  }

  if (!("h1MinimumPx" in record)) {
    findings.push(finding("h1-minimum-required", "h1MinimumPx is required.", "h1MinimumPx"));
  } else if (!positiveNumber(record.h1MinimumPx)) {
    findings.push(finding("h1-minimum-invalid", "h1MinimumPx must be a positive number.", "h1MinimumPx"));
  }

  if (!("measureCapCh" in record)) {
    findings.push(finding("measure-cap-required", "measureCapCh is required.", "measureCapCh"));
  } else if (!positiveNumber(record.measureCapCh)) {
    findings.push(finding("measure-cap-invalid", "measureCapCh must be a positive number.", "measureCapCh"));
  }

  if (!("monoReservedFor" in record)) {
    findings.push(finding("mono-reserved-required", "monoReservedFor is required.", "monoReservedFor"));
  } else if (!Array.isArray(record.monoReservedFor) || record.monoReservedFor.length === 0) {
    findings.push(finding("mono-reserved-empty", "monoReservedFor must be a non-empty array.", "monoReservedFor"));
  } else {
    record.monoReservedFor.forEach((entry, index) => {
      if (typeof entry !== "string" || !MONO_RESERVED_SET.has(entry)) {
        findings.push(
          finding(
            "mono-reserved-invalid",
            `monoReservedFor[${index}] must be one of: ${MONO_RESERVED_ROLES.join(", ")}.`,
            `monoReservedFor[${index}]`,
          ),
        );
      }
    });
  }

  if ("wrapRule" in record && record.wrapRule !== undefined && typeof record.wrapRule !== "string") {
    findings.push(finding("wrap-rule-invalid", "wrapRule must be a string when present.", "wrapRule"));
  }

  if (findings.length > 0) {
    return { findings };
  }

  const parsed: TypeRecord = {
    schemaVersion: 1,
    displayFace: (record.displayFace as string).trim(),
    h1MinimumPx: record.h1MinimumPx as number,
    measureCapCh: record.measureCapCh as number,
    monoReservedFor: record.monoReservedFor as MonoReservedRole[],
    ...(typeof record.wrapRule === "string" ? { wrapRule: record.wrapRule } : {}),
  };
  return { parsed, findings: [] };
}

function checkBrandAlignment(parsed: TypeRecord, declarations: Readonly<Record<string, string>>): TypeRecordFinding[] {
  const findings: TypeRecordFinding[] = [];

  const fontDisplay = declarations[FONT_DISPLAY_PROPERTY];
  if (fontDisplay === undefined) {
    findings.push(
      finding(
        "brand-font-display-missing",
        `Brand CSS must declare ${FONT_DISPLAY_PROPERTY}.`,
        FONT_DISPLAY_PROPERTY,
      ),
    );
  } else if (!fontDisplay.includes(parsed.displayFace)) {
    findings.push(
      finding(
        "brand-font-display-mismatch",
        `${FONT_DISPLAY_PROPERTY} must include the record displayFace "${parsed.displayFace}" as a substring.`,
        FONT_DISPLAY_PROPERTY,
      ),
    );
  }

  const displayL = declarations[TEXT_DISPLAY_L_PROPERTY];
  if (displayL === undefined) {
    findings.push(
      finding(
        "brand-text-display-l-missing",
        `Brand CSS must declare ${TEXT_DISPLAY_L_PROPERTY}.`,
        TEXT_DISPLAY_L_PROPERTY,
      ),
    );
  } else {
    const px = parsePositivePx(displayL);
    if (px === null) {
      findings.push(
        finding(
          "brand-text-display-l-unparseable",
          `${TEXT_DISPLAY_L_PROPERTY} must be a positive px length.`,
          TEXT_DISPLAY_L_PROPERTY,
        ),
      );
    } else if (px < parsed.h1MinimumPx) {
      findings.push(
        finding(
          "brand-text-display-l-below-minimum",
          `${TEXT_DISPLAY_L_PROPERTY} (${px}px) is below the record h1MinimumPx (${parsed.h1MinimumPx}px).`,
          TEXT_DISPLAY_L_PROPERTY,
        ),
      );
    }
  }

  return findings;
}

/**
 * Validates an authored type-scale record. Invalid or unrecognized JSON shape is
 * indeterminate; a schemaVersion 1 object with missing or invalid required
 * fields is violated.
 */
export function checkTypeRecord(record: unknown, options: TypeRecordCheckOptions = {}): TypeRecordCheckResult {
  const shape = validateRecordShape(record);
  if (!shape.ok) {
    return result("indeterminate", shape.findings);
  }

  const { parsed, findings: fieldFindings } = validateRequiredFields(shape.value);
  if (!parsed) {
    return result("violated", fieldFindings);
  }

  const findings: TypeRecordFinding[] = [...fieldFindings];
  if (options.brandDeclarations) {
    findings.push(...checkBrandAlignment(parsed, options.brandDeclarations));
  }

  return findings.length === 0 ? result("satisfied", []) : result("violated", findings);
}
