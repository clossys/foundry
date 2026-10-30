# Check a consumer library

Use the installed `designer-library` command from the consumer workspace. Read
[the generated code reference](check-codes.md) alongside each actual finding.
The library is the only input to resolution; catalog candidates are not consumer
implementations until explicitly materialized.

## Inputs and commands

Identify the consumer's library directory and requested layer. Run read-only
status first, then check the supported layer:

```sh
designer-library status --root library --json
designer-library check --root library --layer tokens --json
designer-library check --root library --layer assets --json
```

Replace `library` with the consumer's actual directory. Omitting `--layer` checks
both supported layers. Tokens and assets are implemented. Components, sections
and frames are unavailable: requesting those layers exits 2, so report the
missing capability rather than claiming that layer passed. `recommend` also
exits 2 as unavailable until the chooser is implemented.

Token navigation uses the color, type, space, shape, depth, motion and
interaction domains. Scale and role are leaf metadata only; do not invent
scale/role branches, rename permanent leaf IDs or create aliases as repairs.
The displayed tree is a view; only leaves are selectable.

## Explain the result

Record the exact invocation, exit code, `ok` and each finding's `code`, `rule`,
`severity`, `subject` and `message`. Translate the message into a concrete
consumer consequence using the reference; keep the original evidence beside
it. Explain error findings first, then notices and warnings.

- Exit 0 means the requested implemented checks returned no error findings.
  It does not establish owner visual approval, deployed image evidence or
  measurements the environment did not supply.
- Exit 1 means check errors were found. Name the failed contract and affected
  leaf or member.
- Exit 2 means the invocation, library read or capability could not be handled.
  Report that cause and stop; do not call it a clean check.

Read actual severity: C3, C4 and C10 can be notices; asset indeterminate findings
become notices. Missing geometry, browser review or evidence stays unverified.
The CLI does not supply image records or glyph bounds. It therefore cannot
prove deployed image alt text, crop/weight budgets or unmeasured glyph geometry.
The owner remains the visual gate, including light/dark rendering and optical
legibility at the intended size.

## Propose the next action

For every finding, report its cause, evidence still needed, proposed operation
and the human decision required. Use only current ChangeSet operations:
`adopt`, `author`, `derive` and `remove`. There is no compose or metadata-repair
operation in this CLI. Contract, binding and sign-off defects may need a catalog
owner or external evidence rather than a library operation.

Adoption needs an existing candidate and real provenance. Authorship needs
consumer-supplied values and licence facts: the chooser never authors values.
Derivation needs an existing registered rule and explicit inputs. Removal can
leave required coverage missing. Never fabricate values, evidence, pins,
sign-off or hashes; never offer temporary bypasses or auto-fixes.

Prepare a proposed ChangeSet against the current library hash only when its
inputs and rationale are available. Keep the rationale and human overrides
with the review evidence; do not claim the ChangeSet stores fields it does not
support. Chooser proposals go to the Studio basket and are never auto-saved.
Do not run `designer-library apply` without an explicit human instruction in
this session. After the owner applies or saves a change, rerun the same checks
and compare findings. A clean check is evidence for the implemented layer,
not permission to promote status or approve visuals.
