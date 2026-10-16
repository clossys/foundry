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
