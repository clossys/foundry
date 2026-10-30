# Director brief to Designer cells

For a consumer using the `clossys` CLI and native cells, run:

```text
clossys design --brief --root <consumer> --json
clossys design --check --root <consumer> --json
```

`--brief` reads active Director cells and lists existing Designer leaves. Its
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
Use the existing native catalog and consumer library APIs for fills and their
provenance. Missing installed capability is a named limit, not permission to
fabricate package evidence or bypass native library checks.

Write proposals only as **draft** native Designer cell versions under
`clossys/agents/designer/cells/<existing-slot>/v<N>.md`. Preserve active sources,
versions and tree pointers. For a currently active slot, use
`designer-library cells propose <slot> --root <designer-cell-root>` to allocate
the next version; never overwrite an earlier version. An unchanged proposal
should reuse the existing draft rather than allocate a duplicate. The shared
propose command requires an active version; missing roots and new slot creation
need the native library migration/initialisation capability first. Do not silently
invent a new tree or composite metadata. If it is unavailable, report that limit.

Use the closed Designer frontmatter, canonical links such as
`director:identity.brand.personality@1`, `originKinds`, `sources`, and the native
`## Rationale` bullets followed by exactly one `## Fill` JSON block. Validate
every draft with the installed `parseLibraryCell(source, cellPath)` API before
handoff. Every proposed cell must link the actual Director ids **and versions**
that informed it. Preserve the actual identity brief fingerprint in native
selection strategy where supported; never manufacture one.

The brief supplies per-Direction-bullet `result.traits[].id` markers, for example
`director:identity.brand.personality@1#direction-L18`. Declare each realised
trait in a rationale bullet using the exact marker supplied by this brief:

```text
- Realises <trait.id>: <the concrete visual decision and why it expresses this input>
```

Also put the marker's canonical `trait.ref` in frontmatter `links`. Markers belong
in rationale, not links: the canonical link grammar has no fragment. Map each
resolved brand trait, visual direction and voice rule to at least one downstream
cell. One Director bullet may contain several traits; explain how the decision
addresses the entire bullet. Audience and position are contextual inputs, not
arbitrarily expanded into trait obligations. Unresolved owner inputs are retained
as limits. Matching this declaration proves traceability, not visual taste.

Run `clossys design --check` before and after activation and report actual findings.
The check measures **active** downstream cells: an unactivated draft cannot make
the active result clean. Preserve expected findings until the requested native
activation occurs. Use `designer-library cells activate <slot@version...>
--confirm <valid-confirmation-ref> --root <designer-cell-root>` only within the
session's activation authority. Then `clossys design --root <consumer>` compiles
the active cells into the native `compiled` projection; it neither generates
creative proposals nor activates them. Do not edit that projection by hand.

The check includes native value-contract and token-contrast findings, reports
missing contrast bindings, and names runtime WCAG and visual review limits.
Run `clossys write --check` for prohibited copy and locale coverage. Review the
actual consumer specimens in Studio; the planner judges the resulting visuals
against the Director brief. A clean traceability check does not replace that
judgment.
