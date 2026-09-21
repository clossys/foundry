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

## Metric definition

```text
customer keep rate
= independently observed first-person keeps
  / all candidates independently inhabited before seal or land
```

The unit is a ratio and the desired direction is up.
