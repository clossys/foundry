# Canonical plan digest

Issue #1475. The one definition of the digest of a plan record
(`clossys/advisor/plan.json`, contract [`advisor-plan.json`](advisor-plan.json)).
It names exactly which plan is meant: the Advisor skill records it as the
assessment basis's `planDigest`, which an execution authorization must
equal. How a recorded approval binds bytes is
set out under [Approval binding](#approval-binding) below.
`@clossys/advisor` and `@clossys/launcher` each implement it once, from this
page, as `planDigest()`. Both test their implementation against the shared
corpus [`advisor-plan-digest.fixture.json`](advisor-plan-digest.fixture.json),
whose expected values were produced independently of either package, so the
two packages compute identical digests.

## Definition

`planDigest(plan)` is the string `sha256:` followed by the 64 lowercase
hexadecimal digits of the SHA-256 hash of the UTF-8 bytes of
`canonical(subject(plan))`, where:

1. **Only a valid plan, read strictly, has a digest.** The digest is defined
   only over a plan read from its file with invalid UTF-8 and repeated object
   keys refused, because RFC 8785 requires I-JSON input, which forbids both;
   `JSON.parse` alone would keep the last of two repeated keys, so the value
   digested could differ from the one a reader of the file sees. The plan
   must then validate against `advisor-plan.json`, which also refuses a lone
   surrogate in any string, so every valid plan has a digest. Validating
   includes the code rules R1 to R8 that the contract's description defines
   (issue #1178). Each of them relates fields a plan without `kits`,
   `staffing`, `packages` or `resolution` does not have, so they refuse no
   such plan, and every plan that had a digest before they were added has
   the same digest now. An implementation refuses (throws) rather than
   digest a plan that does not validate.
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

## Approval binding

This section closes the two questions this page used to leave open for the
approval binding (issue #1178). The definition above does not change.

- **An approval binds bytes only through `subjectDigest`.** A decision that
  has chosen `approved` may carry `subjectDigest`: the digest of the exact
  change the approver was shown. The approval binds that value and nothing
  else. A reader that applies the plan must recompute the digest of the
  change it holds, and refuse unless the two are equal. An approval without
  a `subjectDigest` binds nothing. No reader in this repository applies a
  bound approval yet. Launcher's brief-only path (`launcher-apply-plan
  --plan --brief --repo`) predates the binding and checks none: it still
  accepts any approving decision, and it is kept as it is, not extended. `@clossys/launcher` reads it with
  `approvedSubject()`. That function returns the `subjectDigest` of the
  latest decision, by `at`, when that decision has chosen `approved`, and
  otherwise returns null. It keeps the fail-closed rules for ties and
  unreadable times: when any decision time does not parse, it returns null.
  When several decisions share the latest instant, it returns their subject
  only when every one of them has chosen `approved` with the same
  `subjectDigest`.
- **Earlier decisions.** `decisions` is still excluded from the digest, so
  an earlier entry can be rewritten without changing it. That approves
  nothing new, because only the latest decision is read, and it names the
  bytes it approves. Whether the latest entry is itself genuine depends on
  where the plan file is committed and who could commit it. Nothing inside
  the file can show that.
- **Freeze after approval.** From an approving decision until every
  repository it covers has been applied, or a new plan replaces it,
  Advisor changes no field the digest covers. Recording the approval
  appends a decision and may update `asOf`, and the digest excludes both,
  so the digest at approval equals the digest at apply. Progress in
  between is reported elsewhere. It is not written into `whereWeAre`,
  `recommendedNext` or `blockers`, because each of those is covered. The
  rule is stated in the contract's description and in the Advisor skill.

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
