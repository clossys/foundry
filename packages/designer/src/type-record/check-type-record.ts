/**
 * Pure brand-type record gate — parse + check, no I/O. A consumer-authored
 * JSON record names the type scale a mid-tier walk must execute instead of
 * inventing pairing ad hoc.
 */

export const TYPE_RECORD_SCHEMA_VERSION = 1 as const;

export const MONO_RESERVED_ROLES = ["eyebrow", "data", "code"] as const;
export type MonoReservedRole = (typeof MONO_RESERVED_ROLES)[number];

export const ORPHAN_WORD_POLICIES = ["forbid-single", "allow"] as const;
export type OrphanWordPolicy = (typeof ORPHAN_WORD_POLICIES)[number];

/** Sentinel every bindable string in `brand-type.template.json` starts from. */
export const TEMPLATE_PLACEHOLDER = "REPLACE_ME";

const KNOWN_TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "displayFace",
  "h1Minimum",
  "measureCap",
  "monoReservedFor",
  "wrap",
]);

export interface TypeRecordWrap {
  orphanWords: OrphanWordPolicy;
}

export interface TypeRecord {
  schemaVersion: number;
  displayFace: string;
  h1Minimum: string;
  measureCap: string;
  monoReservedFor: MonoReservedRole[];
  wrap: TypeRecordWrap;
}

export interface TypeRecordFinding {
  rule: string;
  message: string;
}

export type TypeRecordParseFailure =
  | { kind: "invalid-root"; detail: string }
  | { kind: "invalid-type"; field: string; detail: string };

export type TypeRecordParseResult =
  | { ok: true; raw: Record<string, unknown> }
  | { ok: false; failure: TypeRecordParseFailure };

function isMonoReservedRole(value: string): value is MonoReservedRole {
  return (MONO_RESERVED_ROLES as readonly string[]).includes(value);
}

function isOrphanWordPolicy(value: string): value is OrphanWordPolicy {
  return (ORPHAN_WORD_POLICIES as readonly string[]).includes(value);
}

export function isPlaceholderAuthoredValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  return trimmed === TEMPLATE_PLACEHOLDER;
}

function requireFieldType(
  obj: Record<string, unknown>,
  field: string,
  expected: "string" | "number" | "array" | "object",
): TypeRecordParseFailure | null {
  if (!(field in obj)) return null;
  const value = obj[field];
  switch (expected) {
    case "string":
      if (typeof value !== "string") return { kind: "invalid-type", field, detail: "must be a string" };
      return null;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { kind: "invalid-type", field, detail: "must be a finite number" };
      }
      return null;
    case "array":
      if (!Array.isArray(value)) return { kind: "invalid-type", field, detail: "must be an array" };
      return null;
    case "object":
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return { kind: "invalid-type", field, detail: "must be an object" };
      }
      return null;
  }
}

export function parseTypeRecord(raw: unknown): TypeRecordParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, failure: { kind: "invalid-root", detail: "must be a JSON object" } };
  }
  const obj = raw as Record<string, unknown>;

  for (const [field, expected] of [
    ["schemaVersion", "number"],
    ["displayFace", "string"],
    ["h1Minimum", "string"],
    ["measureCap", "string"],
    ["monoReservedFor", "array"],
    ["wrap", "object"],
  ] as const) {
    const failure = requireFieldType(obj, field, expected);
    if (failure) return { ok: false, failure };
  }

  if ("wrap" in obj && obj.wrap !== null && typeof obj.wrap === "object" && !Array.isArray(obj.wrap)) {
    const wrap = obj.wrap as Record<string, unknown>;
    if ("orphanWords" in wrap && typeof wrap.orphanWords !== "string") {
      return { ok: false, failure: { kind: "invalid-type", field: "wrap.orphanWords", detail: "must be a string" } };
    }
  }

  if ("monoReservedFor" in obj && Array.isArray(obj.monoReservedFor)) {
    for (let i = 0; i < obj.monoReservedFor.length; i++) {
      if (typeof obj.monoReservedFor[i] !== "string") {
        return {
          ok: false,
          failure: { kind: "invalid-type", field: `monoReservedFor[${i}]`, detail: "every entry must be a string" },
        };
      }
    }
  }

  return { ok: true, raw: obj };
}

function pushMissingString(findings: TypeRecordFinding[], field: string, value: unknown): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    findings.push({
      rule: "type:missing-field",
      message: `Required field "${field}" is missing or empty.`,
    });
    return;
  }
  if (isPlaceholderAuthoredValue(value)) {
    findings.push({
      rule: "type:placeholder-value",
      message: `Field "${field}" still carries the template placeholder — fill in a real value before treating this record as authored.`,
    });
  }
}

export function checkTypeRecord(raw: Record<string, unknown>): TypeRecordFinding[] {
  const findings: TypeRecordFinding[] = [];

  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      findings.push({
        rule: "unknown-slot",
        message: `Unknown top-level field "${key}" — only documented brand-type slots are allowed.`,
      });
    }
  }

  if (!("schemaVersion" in raw)) {
    findings.push({
      rule: "type:missing-field",
      message: 'Required field "schemaVersion" is missing or empty.',
    });
  } else if (raw.schemaVersion !== TYPE_RECORD_SCHEMA_VERSION) {
    findings.push({
      rule: "type:schema-version",
      message: `schemaVersion must be ${TYPE_RECORD_SCHEMA_VERSION}; got ${String(raw.schemaVersion)}.`,
    });
  }

  pushMissingString(findings, "displayFace", raw.displayFace);
  pushMissingString(findings, "h1Minimum", raw.h1Minimum);
  pushMissingString(findings, "measureCap", raw.measureCap);

  if (!("monoReservedFor" in raw) || !Array.isArray(raw.monoReservedFor)) {
    findings.push({
      rule: "type:missing-field",
      message: 'Required field "monoReservedFor" is missing or empty.',
    });
  } else if (raw.monoReservedFor.length === 0) {
    findings.push({
      rule: "type:mono-reserved-empty",
      message: "monoReservedFor must name at least one role monospace is reserved for.",
    });
  } else {
    const seen = new Set<string>();
    for (const entry of raw.monoReservedFor) {
      if (typeof entry !== "string") continue;
      if (!isMonoReservedRole(entry)) {
        findings.push({
          rule: "type:mono-reserved-invalid",
          message: `monoReservedFor entry "${entry}" is not one of: ${MONO_RESERVED_ROLES.join(", ")}.`,
        });
        continue;
      }
      if (seen.has(entry)) {
        findings.push({
          rule: "type:mono-reserved-duplicate",
          message: `monoReservedFor lists "${entry}" more than once.`,
        });
      }
      seen.add(entry);
    }
  }

  if (!("wrap" in raw) || raw.wrap === null || typeof raw.wrap !== "object" || Array.isArray(raw.wrap)) {
    findings.push({
      rule: "type:missing-field",
      message: 'Required field "wrap" is missing or empty.',
    });
  } else {
    const wrap = raw.wrap as Record<string, unknown>;
    if (!("orphanWords" in wrap) || typeof wrap.orphanWords !== "string") {
      findings.push({
        rule: "type:missing-field",
        message: 'Required field "wrap.orphanWords" is missing or empty.',
      });
    } else if (!isOrphanWordPolicy(wrap.orphanWords)) {
      findings.push({
        rule: "type:orphan-words-invalid",
        message: `wrap.orphanWords must be one of: ${ORPHAN_WORD_POLICIES.join(", ")}.`,
      });
    }
  }

  return findings;
}

/** Overlay presence check — run only after `parseTypeRecord` succeeds. */
export function checkTypeRecordOverlay(declarations: Record<string, string>): TypeRecordFinding[] {
  const value = declarations["--font-display"];
  if (value === undefined || value.trim().length === 0) {
    return [
      {
        rule: "type:overlay-missing-font-display",
        message:
          "The overlay brand CSS must declare a non-empty --font-display value so display typography is bound before a type record counts as executed.",
      },
    ];
  }
  return [];
}

export function formatParseFailure(failure: TypeRecordParseFailure): string {
  switch (failure.kind) {
    case "invalid-root":
      return failure.detail;
    case "invalid-type":
      return `Field "${failure.field}" ${failure.detail}.`;
  }
}
