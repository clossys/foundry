# Canonical plan digest

Issue #1475. The one definition of the digest of a plan record
(`clossys/advisor/plan.json`, contract [`advisor-plan.json`](advisor-plan.json)).
An approval binds this value, so it names exactly which plan was approved.
`@clossys/advisor` and `@clossys/launcher` each implement it once, from this
page, as `planDigest()`. Both test their implementation against the shared
corpus [`advisor-plan-digest.fixture.json`](advisor-plan-digest.fixture.json),
whose expected values were produced independently of either package, so the
two packages compute identical digests.

## Definition

`planDigest(plan)` is the string `sha256:` followed by the 64 lowercase
hexadecimal digits of the SHA-256 hash of the UTF-8 bytes of
`canonical(subject(plan))`, where:

1. **Only a valid plan has a digest.** The plan must first validate against
   `advisor-plan.json`. An implementation refuses (throws) rather than digest
   a plan that does not.
2. **`subject(plan)` is the plan without its top-level `asOf` and `decisions`
   members.** Every other member is kept exactly as it is, including every
   nested member: no trimming, no Unicode normalization, and array order
   preserved.
   - `decisions` is excluded because an approval is itself recorded there. A
     digest that covered it would change the moment the approval it binds
     was written.
   - `asOf` is excluded because it records when the file was written, not
     what was planned. Re-writing the same plan later keeps the same digest.
   - Nothing about the authorization that permits applying the plan (its
     grant time, its expiry) is part of the plan, so none of it is part of
     the digest. An expired grant is refused when it is checked, and
     re-approving the same plan keeps the same digest.
3. **`canonical(value)` is the JSON Canonicalization Scheme of RFC 8785:**
   - **No whitespace** anywhere outside strings.
   - **Objects:** `{`, then each member as `key:value` separated by `,`, then
     `}`. Members are sorted by key, comparing keys as sequences of UTF-16
     code units (not code points, and not locale order). Keys are written as
     strings, below.
   - **Arrays:** `[`, the items in their original order separated by `,`,
     then `]`.
   - **Strings:** a double-quoted JSON string. `"` is written `\"`, `\` is
     written `\\`, and the control characters U+0008, U+0009, U+000A, U+000C
     and U+000D are written `\b`, `\t`, `\n`, `\f` and `\r`. Every other
     code point below U+0020 is written `\u00XX` with lowercase hexadecimal
     digits. Every other character, including `/`, U+007F, U+2028, U+2029
     and all non-ASCII text, is written as itself. A string (or key) that
     contains a lone surrogate is not well-formed Unicode, and an
     implementation refuses it rather than digest it.
   - **Numbers:** ECMAScript `Number.prototype.toString`, with `-0` written
     `0`. A non-finite number is refused. (A valid plan's only number is
     `schemaVersion`, which is `1`.)
   - **Literals:** `true`, `false` and `null`.

## Why these choices

- **RFC 8785 rather than a local rule.** It is a published definition that
  any language can implement, and for the values a plan can hold it agrees
  byte for byte with sorting keys and calling ECMAScript `JSON.stringify`
  with no indentation. Anyone can recompute a digest without either
  package.
- **Exclusions are named, not inferred.** Only the two members above are
  left out. Everything else a plan says is covered, so any other change,
  even to a status line, needs a fresh approval.
- **Refusal over repair.** An invalid plan, a lone surrogate, or a
  non-finite number has no digest. There is no fallback that could make two
  different plans hash the same.
