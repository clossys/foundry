/**
 * `@vespeneventures/controller/policy` — the zero-I/O, zero-dependency
 * content-addressed binding primitive this repository's rule-governing
 * package (`@vespeneventures/controller`) is built on.
 *
 * A `PolicyBinding` is a content-addressed commitment to a policy document:
 * a `policyId`, a hash algorithm, and a digest — never the document itself.
 * A digest is safe to commit even when the document it points at is not: it
 * reveals nothing about the input, but lets a later, separately-obtained
 * copy be checked against it byte-for-byte. That is the whole mechanism
 * this subpath provides — compute a digest, validate a binding's shape,
 * verify a binding against materialized content.
 *
 * `Finding` is this subpath's own type, defined in `./types.js` alongside
 * `PolicyBinding` — not borrowed from, or shared with, any sibling subpath.
 *
 * NON-GOAL, deliberately: this subpath does not know what a "denylist" is,
 * does not read any file, does not know about any real filesystem path, and
 * does not decide what should happen when `verifyBinding` reports a
 * mismatch — fail a build, warn, block a release — that decision belongs to
 * whatever calls this, most likely `./gates` higher up this same package.
 * This is a general-purpose content-addressed binding primitive; a
 * denylist is its motivating use case, not something it has special
 * knowledge of.
 */

export type { DigestAlgorithm, Finding, PolicyBinding } from "./types.js";
export { DIGEST_ALGORITHMS } from "./types.js";

export { computeDigest } from "./digest.js";

export { validateBindingShape, verifyBinding } from "./validate.js";

export { OWN_LICENSE_BINDING } from "./self-license.js";
