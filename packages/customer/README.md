# `@clossys/customer`

First-person synthetic inhabit of the named Strategist audience — the person
this was made for, on speed dial. Not a hired QA reviewer, auditor,
contractor scorecard, or third-person market-research memo.

```bash
npm install @clossys/customer
```

This package is published to the public npm registry, `https://registry.npmjs.org`.
Installing it needs no authentication: no npm token, no `.npmrc` registry
override, and no GitHub credential of any kind.

## Job question

> If I am the person this was made for, do I keep this?

The package name `customer` means the person the product is for — not a
paying-buyer-only legal status and not Bouncer's authenticated user. This
package is **not** a reviewer.

That job is the seal gate. The same inhabit also answers on-demand as that
person: a synthetic power user you can ask about any topic, comparison from
their actual consideration set, what it would take to start or to refer,
whether it is worth what it costs them, and what would make them leave.

## Session intents

`customer-check` validates inhabit form for every session. Only `keep`
counts toward the charter metric.

| `intent` | What the person speaks | Charter metric |
| --- | --- | --- |
| `keep` | Fresh or returning look; visual and verbal; one keep/fail | yes |
| `feedback` | Lived functional stumbles, experience, missed expectations — any topic | no |
| `compare` | Alternatives I actually use, a peer uses, or I considered, from my day | no |
| `refer` | Whether I would tell a peer, the words I would use, what it would take | no |
| `churn` | The warning, the moment I would leave, where I would go, what would keep me | no |
| `adopt` | Whether I would start, what stops me, the first real job I would give it | no |
| `worth` | Whether this is worth my time, money, or attention, and the threshold | no |

Every session binds `speaker: "customer"`, `inhabitedAs: "target-audience"`,
and the named Audience. Missing `intent` is treated as `keep`. Unknown
intent cannot run. Speed-dial testimony is the same person, not a second
role: not QA, not Strategist intel, not Influencer yield.

Feedback may be purely functional, purely experiential, or both. At least
one lived channel (`functional`, `experience`, or `expectations`) is
required. Compare with an empty consideration set is a finding.

## Customer keep rate

Independent consumer evidence shows the position's owned metric meets its
setpoint over the declared review cadence. The owned metric is
`customer keep rate`, computed by `assessCustomerKeepRate()`. An empty
evaluated set is `indeterminate`, never a rate of 1. Feedback, compare,
refer, churn, adopt, and worth testimony never enter this rate.
`customer-check` proves the session was conducted as the customer; it never
certifies a five-star quality score. This package does not measure consumer
evidence and does not close the loop. A green run of this package's tests
is not a close.

```ts
import {
  assessCustomerKeepRate,
  checkInhabitForm,
  checkKeepForm,
  parseAudience,
  parseInhabitRecord,
  parseKeepRecord,
} from "@clossys/customer";

const report = assessCustomerKeepRate(input);
```

```bash
customer-rate-check assessment.json
```

The command prints JSON and exits `0` for satisfied, `1` for violated, and
`2` for indeterminate, unreadable, or invalid input.

This package declares that command as its first-day assessment surface in
its own manifest:

```json
"foundry": { "assessment": { "bin": "customer-rate-check", "invocation": "single-json-input" } }
```

Onboarding discovers that declaration from the installed manifest and never
infers a surface. `customer-check` remains the two-argument CLI and is not
the assessment surface.

The same `foundry` block also declares, for discovery and never for
inference:

- `outputs` — the files this role owns in a consumer repository, one per
  session intent: `clossys/customer/keep.json`, `feedback.json`,
  `compare.json`, `refer.json`, `churn.json`, `adopt.json`, and
  `worth.json`. `customer-check` reads one such record at a time; nothing
  in this package writes them.
- `feeds` — the one artifact another role consumes: the `keep-verdict` at
  `clossys/customer/keep.json`, which Publisher waits for before it seals.
- `fit` — `fit-signals.json`, shipped in this package: the evidence that
  makes this role applicable at all (a named audience to speak as, and an
  audience-facing candidate to keep or fail).

## Inhabit form gate

```bash
customer-check record.json audience.json
```

Exit codes: `0` clean form, `1` inhabit or consistency findings, `2` could not
run (including unreadable files, unknown intent, or indeterminate shape).

Audience is a JSON seam `{ id, name, description, painPoints? }` with no
runtime dependency on Strategist. `parseAudience`, `parseKeepRecord`,
`parseInhabitRecord`, `checkKeepForm`, and `checkInhabitForm` are the
inhabit-form surface (`checkKeepForm` is an alias of `checkInhabitForm`).
Exported session types are `KeepRecord`, `FeedbackRecord`, `CompareRecord`,
`ReferRecord`, `ChurnRecord`, `AdoptRecord`, and `WorthRecord`. A `keep`
verdict with any impression answered `no` is a finding. Compare with an
empty consideration set is a finding. Speaker `designer`, `qa`, or
`reviewer` is a finding.

## Exported types

Session records:

| Type | What it is |
| --- | --- |
| `Audience` | The JSON seam `{ id, name, description, painPoints? }` a session binds to. |
| `InhabitEnvelope` | Fields every session shares: `speaker: "customer"`, `inhabitedAs: "target-audience"`, `audienceId`, `persona.name`, `stance`, `topic`, `familiarity`, and `intent`. |
| `InhabitRecord` | The union of every parsed session: `KeepRecord`, `FeedbackRecord`, `CompareRecord`, `ReferRecord`, `ChurnRecord`, `AdoptRecord`, or `WorthRecord`. |
| `InhabitIntent` | `"keep"`, `"feedback"`, `"compare"`, `"refer"`, `"churn"`, `"adopt"`, or `"worth"`. |
| `Familiarity` | `"fresh"` or `"returning"`. Required for every intent except `keep`, where it defaults to `"fresh"`. |
| `YesNo` | `"yes"` or `"no"`, the only accepted answer to every yes/no field. |
| `KeepVerdict` | `"keep"` or `"fail"`, the one verdict a `KeepRecord` carries. |
| `KeepImpressions` | A keep's `firstSeconds` sentence plus its four `YesNo` answers: `isThisForMe`, `doIBelieve`, `wouldIStay`, and `wouldITellAPeer`. |
| `KeepChannelImpression` | `{ impression }`, the shape of a keep's `visual` and `verbal` channels. |
| `LivedFunctional` | One feedback item: what `happened` and what I `expected`. |
| `LivedExpectation` | One feedback item: what I `assumed` and what `actually` happened. |
| `KnownAlternative` | One entry in a compare's consideration set: `name`, `relationship`, and `whyItMatters`. |
| `AlternativeRelationship` | `"i-use-this"`, `"a-peer-uses-this"`, or `"i-considered-this"`. |

Inhabit-form results, from `checkInhabitForm` and `checkKeepForm`:

| Type | What it is |
| --- | --- |
| `KeepFormReport` | `{ state, findings }`. |
| `KeepFormState` | `"satisfied"`, `"violated"`, or `"indeterminate"`, matching `customer-check` exit codes `0`, `1`, and `2`. |
| `KeepFormFinding` | `{ rule, severity: "error", message, path? }`. |

Keep-rate results, from `assessCustomerKeepRate`:

| Type | What it is |
| --- | --- |
| `CustomerKeepRateAssessment` | `{ metric: "customer keep rate", state, rate, evaluatedCandidates, keptCandidates, findings, proposedPositions }`. `rate` is `null` whenever no declared candidate has a counting independent observation, and the state is then `indeterminate`. |
| `CustomerKeepRateState` | `"satisfied"`, `"violated"`, or `"indeterminate"`, matching `customer-rate-check` exit codes `0`, `1`, and `2`. |
| `CustomerKeepRateFinding` | `{ rule, severity: "error", message, path? }`. |

## Metric definition

```text
customer keep rate
= independently observed first-person keeps
  / all candidates independently inhabited before seal or land
```

The unit is a ratio and the desired direction is up.
