# Director brief to Designer slots

For a consumer using the `clossys` CLI and the flat slot store, run:

```text
clossys design --brief --root <consumer> --json
clossys design --check --root <consumer> --json
```

`--brief` reads the pinned Director slots and lists the existing Designer slots. Its
`result.inputs` preserves the source Direction, Watch, citations, ids and versions
for essence, personality, visual direction, imagery, voice, audience and position.
`result.wontClaim` carries actual `Never` and `Never-claim` bullets; it invents no
claims namespace. Missing inputs and `TODO-OWNER` text remain named limits.
Do not turn an unresolved fact into a brand decision. The `shadcn@aria` component
preference is an explicit planner default, not a fact derived from the brand.

Read the complete brief and the installed library companions before choosing.
The agent makes the creative decisions in the consumer session: translate the
actual essence and personality into colour roles, type faces and scale, space,
radius and motion; select available components and Section/Frame emphasis to
serve the stated audience and position. Explain the choice and its tradeoff.
Do not substitute generic starter values for the brand, invent unsupported
inputs, add new permanent leaf ids, or claim that a CLI made these decisions.
Missing installed capability is a named limit, not permission to fabricate
package evidence or bypass the slot checks.

The store is flat: one folder per slot, `clossys/agents/designer/<slot-id>/`
holding `slot.json`, `candidates/` and `pin.json`. Grouping lives only in
`clossys/agents/designer/ia.json`; never invent folders. Write proposals only as
unpinned candidate files in the existing slot folder,
`clossys/agents/designer/<slot-id>/candidates/<element>-v<N>.json`, through the
installed Producer API (it numbers the candidate and refuses an invalid one).
Never change a pinned candidate, a `pin.json` or another slot's files; a revision
is a new candidate file. An unchanged proposal reuses the existing candidate
rather than adding a duplicate. A new slot needs the library capability
first; if it is unavailable, report that limit.

A candidate is a shadcn registry item (`name`, `type`, `files[]` with full
content) with `meta.slot`, `meta.source` (the reference it starts from, see the
Designer skill) and `meta.element` (`id`, `layer`, `kind`, `creator`, `reason`,
`reads`). Trace the Director the slot model's way: the slot's `slot.json`
`inputs` lists every Director slot id the element derives from (for example
`identity.brand.personality`), and the pinned Director candidates are the
versions read. `clossys design --check` fails on a declared Director input with
no pinned candidate, and names pinned slots that declare none.

The brief supplies per-Direction-bullet `result.traits[].id` markers, for example
`director:identity.brand.personality@1#direction-L18`. Declare each realised
trait in the candidate's `meta.element.reason`, using the exact marker:

```text
Realises <trait.id>: <the concrete visual decision and why it expresses this input>
```

and list the trait's slot (`trait.ref` without the version) in `slot.json`
`inputs`. Map each resolved brand trait, visual direction and voice rule to at
least one downstream slot. One Director bullet may contain several traits;
explain how the decision addresses the entire bullet. Audience and position are
contextual inputs, not arbitrarily expanded into trait obligations. Unresolved
owner inputs are retained as limits. Matching this declaration proves
traceability, not visual taste.

Run `clossys design --check` before and after pinning and report actual findings.
The check measures **pinned** candidates: an unpinned candidate cannot make the
pinned result clean. Preserve expected findings until the requested pin occurs.
Pin only within the session's decision authority, with
`clossys pin designer/<slot> <candidate-id> --by <who> --basis <picked|bulk|planner>`.
Then `clossys design --root <consumer>` prints the pinned set (written only to
`--out`); it neither generates creative proposals nor pins them. Never hand-edit
a `pin.json` or a generated projection.

The check includes native value-contract and token-contrast findings, reports
missing contrast bindings, and names runtime WCAG and visual review limits.
Run `clossys write --check` for prohibited copy and locale coverage. Review the
actual consumer specimens in Studio; the planner judges the resulting visuals
against the Director brief. A clean traceability check does not replace that
judgment.
