

// ---------------------------------------------------------------------------
// ComposeDocument — the whole document
// ---------------------------------------------------------------------------

/**
 * *This template, these slots filled from these copy ids, targeting this
 * channel, with this metadata.* The one document this whole package
 * exists to type and validate.
 */
// ---------------------------------------------------------------------------
// ComposeFinding — what validateComposeDocument reports
// ---------------------------------------------------------------------------

/**
 * One thing `validate.ts`'s shape validation found wrong with a candidate
 * `ComposeDocument`. Deliberately the same shape as
 * `@clossys/writer`'s `CopyFinding` (itself mirroring
 * `@clossys/writer/voice`'s `VoiceFinding` and `@example/policy`'s
 * `Finding`) — `rule` / `severity` / `message` / optional `path` — so a
 * caller already handling one kind of finding in this ecosystem does not
 * need a second mental model for this package's. Always `"error"` in
 * practice: a malformed `ComposeDocument` is never merely a warning, the
 * same discipline every sibling package in this repository holds to for
 * its own shape-validation findings.
 */
export interface ComposeFinding {
  rule: string;
  severity: "error" | "warning";
  message: string;
  path?: string;
}
