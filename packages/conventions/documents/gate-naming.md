# CI gate naming

Name every required-status-check context a repository publishes with:

```text
<verb>-<noun>[-<noun>]
```

Lowercase kebab case, the verb first and actually a verb, extended past
verb-noun to a third segment only where it disambiguates a specific check
within a broader family. This is not a fixed slot grammar: there is no
maximum segment count, but a segment that only restates one already present
is a mistake, not a shape to imitate — `scan-secrets-leaks` names the same
idea twice, where `verify-review-evidence` narrows what "review" means with
a segment that actually adds something.

Reject: uppercase letters, whitespace, commas, consecutive or
leading/trailing hyphens, and a name whose first segment is not a
recognized action. A gate name identifies one check; it is not read aloud
as prose, and it does not carry the tool that implements it or the noun it
inspects as its first word — `record` is not `check-task-record`, and a
scanning tool's own name is not the gate that runs it.

## No account or repository prefix

A gate context already lives inside exactly one repository, which belongs to
exactly one account. There is no namespace collision left to disambiguate,
so a gate name carries no account or repository prefix — and giving every
account's ruleset a different shape by letting each prepend its own name
would defeat the one thing a shared naming grammar buys: the ability to
compare gate names across repositories at all.

This is deliberately unlike skill naming (see `skill-grammar.md`), where a
prefix is legitimate because every account installs its skills into one
tree the others also read. A gate name has no such shared tree to
disambiguate within, so it borrows nothing from that convention.

## A suggested vocabulary, not a required one

This package ships a suggested canonical gate set as a default, the same way
it ships default prose for its other conventions. Adopting it verbatim and
choosing an entirely different, equally conforming set are both fine, so
long as every name satisfies the grammar above — this document supplies a
starting vocabulary, and never requires its own five names back:

- `scan-secrets`
- `check-task-record`
- `verify-review-evidence`
- `detect-policy-drift`
- `verify-repository`

Each account's own control repository owns the actual selection of gate
names, and the mapping from a gate name to the check that publishes it under
that context. Both are that repository's fact, not this package's.
