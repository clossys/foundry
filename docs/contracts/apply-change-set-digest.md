# Change-set and bundle digests

Issue #1178. The one definition of two digests used when an approved plan
is applied:

- `changeSetDigest`, which names exactly what one repository's pull request
  would change (contract [`repository-change-set.json`](repository-change-set.json));
- `bundleDigest`, which names exactly which change sets one application
  attempt holds (contract [`apply-bundle.json`](apply-bundle.json)). A plan's
  approval binds it: the approving decision's `subjectDigest` must equal it.

`@clossys/launcher` implements both, from this page, as `changeSetDigest()`
and `bundleDigest()`, and is tested against the corpus
[`apply-change-set-digest.fixture.json`](apply-change-set-digest.fixture.json),
whose expected values were produced independently of the package (see
[How the corpus was computed](#how-the-corpus-was-computed)).

## The shared step

`canonicalDigest(value)` is the string `sha256:` followed by the 64
lowercase hexadecimal digits of the SHA-256 hash of the UTF-8 bytes of
`canonical(value)`, where `canonical` is the RFC 8785 serialization defined
in [`advisor-plan-digest.md`](advisor-plan-digest.md), item 3, unchanged.
The plan digest is `canonicalDigest` of the plan without `asOf` and
`decisions`, exactly as that page defines it; nothing here changes it.

## `changeSetDigest`

`changeSetDigest(set)` is `canonicalDigest(subject(set))`, where
`subject(set)` is the change set with two changes:

1. **Six top-level members are removed:** `changeSetDigest`, `branch`,
   `bundle`, `pullRequest`, `inverse` and `tooling`. Whether each is present
   or absent makes no difference.
2. **Every file whose `derived` member is `true` is reduced** to its
   `path`, `mode`, `derived`, `item` and `invariants` members. Any other
   member it has, which the contract allows to be only `before` and
   `after`, is removed.

Everything else is kept exactly as it is, including every nested member and
the order of every array.

### What is excluded, and why

Each exclusion removes something that is computed from the digest, from
something the digest already covers, or from the machine rather than the
change. Without it, the digest would have to contain its own result, or two
machines would compute different digests for the same change, and
recomputing any of these would give the set a new digest, and so a new
branch, on every run.

| Excluded | Why |
| --- | --- |
| `changeSetDigest` | It is the digest. |
| `branch` | It is named after the digest: `clossys/apply-` and the digest's first 12 hexadecimal digits. |
| `bundle` | It is the bundle digest, which covers this set's digest. |
| `pullRequest` | Its title ends with the digest's first 12 hexadecimal digits, and its body carries the digest as a marker, so `bodySha256` changes with the digest. Both are rendered from ids and digests only. |
| `inverse` | It is the digest of the change set that reverts this one, which is computed from this one. |
| `tooling` | It records which tool versions regenerated the derived files, for diagnosis. It describes the machine, not the change, and the derived files' invariants, which stay covered, are what the set promises. |
| the ledger file's `before` and `after` | The ledger (`clossys/.state/installed.json`) lists the digest of every change set that wrote it, this one included, so its bytes depend on this digest. Everything else in it follows from the members the digest covers. What stays covered is its invariant: the ledger generation this set writes. |
| the lockfile's `before` and `after` | A lockfile's bytes depend on the package manager's version, not only on what is installed. Two runs with the same inputs could write different bytes for no difference that matters. What stays covered is its invariants: the exact version and integrity each package act resolves to. |

The two file rows are one rule, the derived-file reduction in step 2: a
file is `derived` exactly when its bytes are checked by invariants instead
of byte equality. A file whose bytes this set writes exactly is never
derived, and its `before` and `after` stay covered.

Because a derived file's bytes are outside the digest, the contract lets
only two files be derived (its code rule C7): the ledger, whose only
invariant is its generation, and the repository's own lockfile, whose only
invariants are package versions and integrity values, each equal to the
package item it belongs to (C9). Any other file marked derived, such as
`package.json`, a brief or a skill, is refused, so no file's bytes can leave
the digest by being relabelled.

The contract also fixes the order of every array whose order carries no
meaning (its code rule C8), so one change has one serialization and one
digest; a set written in any other order is refused rather than given a
second digest.

### What stays covered, deliberately

Every other member is covered. These are covered on purpose, because a
change to any of them must be a new change set, with a new branch and a new
approval:

- `repository.baseCommit`: the set was computed against that commit. A moved
  default branch is a new set.
- `producer.version`: a composed skill's bytes depend on the version of the
  package that composed them.
- `repository.visibility`: it decides whether the brief carries the client's
  problem or the public placeholder.
- `repository.nodeId`: a different repository under the same name is a
  different target.
- `ledger.generation`: the set starts from that ledger generation, and
  writes the next one.
- `engine`, `planDigest`, `phase`, `observed`, `items`, `files`, `keys`,
  `refused`, `deferred` and `pathAllowList`: what the set does, where, why
  it does not do something, and on whose authority. A staffing change moves
  `items` and `files`; different package bytes move an item's `integrity`
  and its lockfile invariant.

A change set holds no time, so computing it again from the same inputs
gives the same digest.

### Content digests

A file's `before` and `after` are content digests: `sha256:` and the
lowercase hexadecimal SHA-256 of the file's exact bytes, or `null` when the
file is absent. A composed skill's bytes are the `SKILL.md` text Launcher
composes for that role, as UTF-8.

For `clossys/brief.json` the bytes are the UTF-8 encoding of the
repository's projection of the hub brief, serialized exactly as
ECMAScript's `JSON.stringify(brief, null, 2)` followed by one line feed:

- members in the order the brief contract's PER-REPOSITORY PROJECTION
  states, at every depth, whatever order the hub brief's file used;
- two spaces of indentation per level, a line feed after every `{`, `[` and
  `,`, one space after each `:`, and an empty array or object written `[]`
  or `{}`;
- in strings, only what JSON requires is escaped: `"` as `\"`, `\` as
  `\\`, U+0008, U+0009, U+000A, U+000C and U+000D as `\b`, `\t`, `\n`,
  `\f` and `\r`, and every other code point below U+0020 as `\u00XX` with
  lowercase hexadecimal digits. Everything else, including `/`, U+007F,
  U+2028, U+2029 and all non-ASCII text such as `’`, is written as itself.
  (A lone surrogate would be escaped, but the brief contract refuses one.)
- the only number, `schemaVersion`, is written `1`.

## `bundleDigest`

`bundleDigest(bundle)` is `canonicalDigest(value)`, where `value` is:

```json
{ "planDigest": "sha256:<the plan digest>",
  "repositories": [{ "id": "<repository id>", "changeSetDigest": "sha256:<its change-set digest>" }] }
```

`repositories` holds one entry for each repository that has a change set,
and only those, sorted by `id` comparing UTF-16 code units. A skipped
repository is not in it.

It covers nothing else. The authorization and its expiry, the time the
bundle was computed, the checks and their verdicts are all excluded, so:

- re-approving the same bytes, or a new authorization with a later expiry,
  keeps the same digest;
- the digest can be recomputed from digests alone, without the plan's text,
  for example by a repository that holds only its own change set and its
  sibling's digest.

`planDigest` stays covered, so a plan change is a new bundle even when no
repository's change set moved.

## Why the digests are not circular

Each value is computed only from values computed before it:

1. Each change set without its six excluded members (`changeSetDigest`,
   `branch`, `bundle`, `pullRequest`, `inverse` and `tooling`), and with its derived
   files reduced, gives its `changeSetDigest`.
2. That digest gives the set's `branch` and pull request title.
3. The change-set digests and the plan digest give the `bundleDigest`, which
   is written into each set's `bundle`.
4. Later steps compute the ledger's bytes, the pull request body and the
   inverse set from those digests.

Nothing in steps 2 to 4 is part of step 1, so recomputing any of them
leaves every digest unchanged. The corpus proves it: a set whose excluded
members were all recomputed has the same digest as the original.

## How the corpus was computed

The expected values in
[`apply-change-set-digest.fixture.json`](apply-change-set-digest.fixture.json)
were computed by a stand-alone Python 3 script that uses only the standard
library and reads nothing from this repository's packages. It builds each
change set in the canonical order the contract states, computes its
subject as step 1 and step 2 above describe,
serializes it with
`json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))`,
and hashes the UTF-8 bytes with `hashlib.sha256`. For these values that
serialization is RFC 8785: every key is ASCII, so code-point order equals
UTF-16 code-unit order, and every number is a small integer. The script
asserts both before it serializes anything. It then sets `branch`, the
title and `changeSetDigest` from the digest, computes the bundle digests the
same way, and asserts every `sameDigestAs` and `differsFrom` relation in
the corpus before writing it.

The same script builds each brief case from `hubBrief`, whose members are
deliberately out of order and whose text includes `’`, an emoji, a quotation
mark, a backslash, a tab, U+0007, U+007F and U+2028. It applies the brief
contract's projection in its stated member order and serializes it with
`json.dumps(value, ensure_ascii=False, indent=2)` and one line feed, which
writes the same bytes as `JSON.stringify(value, null, 2)` for these values:
both escape only what JSON requires and write everything else as itself.

## Why these choices

- **One canonical step, reused.** The change-set and bundle digests use the
  plan digest's serialization, so a reader who can check a plan digest can
  check these too.
- **Exclusions are named, not inferred.** Only the members above are left
  out, each for a stated reason. Everything else a change set says is
  covered.
- **Invariants over bytes for derived files.** What matters about a lockfile
  is what it resolves, and that is covered exactly.
