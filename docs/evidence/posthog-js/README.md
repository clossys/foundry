# Recorded browser evidence

These are recorded observations of the vendor analytics SDK **1.438.12** in
real **Chromium 151.0.7922.173**, from the run completed on
**2026-10-16 at 19:35:10.798 UTC**. The `measured_at` timestamp comes from the
original result file's modification time; the individual observations occurred
during the preceding run. This document records measurements, not permission
to enable an attestation.

[The recorded JSON](1.438.12.json) preserves all 18 original items, their
observations, answers, methods, limits and measuring-test identifiers. It also
includes the SDK artifact hashes, browser setup, adapter base, original result
hash and an index of the six observations below. The identifiers refer to the
retained session harness; executable tooling and dependency manifests are not
part of this record.

| Observation | Measured result | Evidence |
| --- | --- | --- |
| `clearsFlagCache` | **false** | `featureFlags.reset()` leaves the cached `warm-response` variant present. A full SDK reset clears it to null. E15 records both operations separately. |
| `requestCarriesNoPersonData` | **false** | Enabled evaluation requests carry `groups` and `person_properties`, including initial URL, host, path and referrer properties. E15 records the payloads and fields. |
| `resetCancelsPendingRequests` | **true for SDK response invalidation** | A held old response, released after reset and a later subscription, reaches neither that subscription nor the cache. A fresh response reaches it. Without reset, the old variant reaches the later subscription. The HTTP response completes: transport cancellation is **false**. The named item records this sequence. |
| `masksAllText` | **false** | The exact recorded inline-script text is `SCRIPT_PLACEHOLDER`, which fails the masking pattern. E10/E11 and E17 retain the text observations and capability result. |
| `recordsNavigationAddress` | **false** | Only two of six tested navigation changes retain the exact address. Fragments are stripped in some cases; hashchange and back produce no address record in the measured sequence. E9 retains each navigation and its records. |
| localStorage consent write | **observed** | Despite memory persistence, opt-in writes `__ph_opt_in_out_evidence-only-project` with value `"1"`; SDK opt-out changes it to `"0"`. SDK reset removes it. E5 retains snapshots and operations across all lifecycle stages, including adapter withdrawal and reset. The suffix is a synthetic fixture identifier. |

The method used a headless Chromium driver with the real SDK and recorder.
Every page HTTP request was fulfilled locally, WebSockets were closed locally,
and a dead loopback proxy prevented requests from escaping interception. The
fixture used a synthetic project identifier and no real project credentials.
The browser used a standard Chromium user agent matching its version and
disabled its automation-control marker to exercise the SDK's normal visitor
path. This does not establish behavior for other browser identities.

The configured before-send hook retained its identity. Observers around the
real SDK capture boundary, queue and recorder collected inputs, outputs,
records and storage operations; they did not substitute a simulated DOM or
fabricated SDK replies for the measured behavior. Flag replies were controlled
local fixtures so the old and fresh responses could be released in order.
Recording diagnostics explicitly started the real recorder and performed a
post-start click, while the adapter's replay probe remained false. Session
rotation used the browser's controlled clock.

All 18 measuring tests passed in the original run. This revision relocates the
recorded data without rerunning or changing those measurements. Incidental
identifiers and ports were already normalized in the original artifact;
ID-change findings were computed before normalization. The additional metadata
and six-observation index do not replace the original item observations.

These are bounded fixture results for one build. Other SDK versions, arbitrary
host markup, unexercised record kinds, cross-origin or cross-tab behavior and
maximum session lifetime remain unproven. Response invalidation does not
establish cache clearing or a targeting-free request shape. The false replay
capabilities keep replay off; this record grants no flags or replay attestation,
publication clearance or release qualification.

## Follow-up flag measurements

[The follow-up record](flags-followup-1.438.12.json) adds E18–E20 for the same
SDK version. It includes every candidate tried, decoded request bodies and key
lists, declaration and readable built-source locations, controls, limits and
the exact measuring-test names. The original record above stays unchanged.

E18 establishes **no person-free enabled request** among the measured concrete
configurations. The matrix tries every keyword-matched top-level configuration
key through both direct SDK init with the adapter's forced configuration and
`set_config`, plus alternative person-profile modes and a combined privacy
case. Examples include `save_referrer`, `save_campaign_params`, `person_profiles`,
`property_denylist`, `sanitize_properties` and their recorded values. Empty or
disabled requests do not qualify. These are bounded values and combinations;
the inventory also identifies nested, read-only and private members without
inferring an unmeasured success. The integration configuration uses a local
synthetic user object, with no external integration SDK or service.
Function-valued options use recorded harness descriptors for a URL identity
callback, an empty-URL callback, an empty-properties callback and that local
integration object; the SDK receives the resolved functions and object.

E19 establishes a cache drop without session or distinct-ID rotation for these
exact calls:

- `updateFlags({}, {}, {merge:false})`
- `featureFlags.updateFlags({}, {}, {merge:false})`
- `featureFlags.receivedFeatureFlags({featureFlags:{}, featureFlagPayloads:{}, flags:{}})`

The probe fetches a warm variant first, disables both flag-request switches,
then checks ordinary, result, detailed and aggregate getters and a newly
registered callback. `featureFlags.reset()` retains the warm cache in its
positive control. Removing only `$enabled_feature_flags` leaves the old variant
in detailed getters, so that candidate fails the complete cache-drop criterion.
The response-ingestion call exercises the shipped SDK method directly; its
empty input is recorded explicitly.

E20 measures each successful E19 call separately. Method-only withdrawal keeps
both IDs and introduces no additional measured physical store keys. The
synthetic consent key remains in localStorage; SDK opt-out writes `"0"`, SDK
reset removes it, and adapter re-grant writes `"1"`. Flags-only adapter withdrawal
leaves `"0"`; original E5 enables autocapture/replay and ends with that key
removed. This fixture difference is recorded separately from the candidate's
before/after storage result, which remains unchanged. It does not establish a
causal effect of the cache-drop call on withdrawal storage. Full SDK reset still
rotates both IDs, and controlled idle
capture rotates only the session ID. The actual lazy transport makes no
provider load or SDK request before first grant, and both request disables
prevent measured flag requests. Those methods are applied after provider
initialization in the lazy-transport probe.

Each successful call also has a separate matched E5 control: the original
autocapture/replay configuration and all original lifecycle phases are repeated,
with the cache-drop call inserted after a warm flag evaluation. Every retained
physical-store snapshot matches the original E5 record, and storage is unchanged
across the inserted call. This keeps the flags-only withdrawal difference
separate from the measured effect of the candidate.

The held-response controls begin with a warm cache. Each cache-drop call alone
allows an old reply through the later subscription. Calling
`featureFlags.reset()` before the cache-drop call rejects that reply while a
fresh reply reaches the later subscription, with both IDs unchanged. The old
HTTP response completes. Request invalidation and transport abortion therefore
remain separate observations.

The retained session harness reruns E1–E17 and the named cancellation item.
The follow-up JSON records each original answer, actual rerun answer and match
or mismatch; mismatches remain findings. Its commit-less identity lists the
file names and SHA-256 digests of all 14 harness files, including the completed
result artifact. The validator reconstructs that artifact from the recorded
items and checks its digest. SDK artifact digests and the baseline record's
digest are checked too. Source locations use the unscoped package basename as
`packageRole` and a path within that installed package.

Run the dependency-free record checks from the repository root:

```sh
node docs/evidence/posthog-js/check-results.mjs
node docs/evidence/posthog-js/check-results.mjs --self-test
```

All executable browser tooling and dependencies remain in the session. The
flags-only extension fixtures omit recorder pre-import; original browser
stimuli and assertions are retained. Longer session-test budgets accommodate
declaration compilation and the context matrix. The record lists development
failures and final command outcomes. The failed request-shape finding keeps
flags at control; adapter, specification and package behavior remain unchanged.
