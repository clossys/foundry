# posthog-js browser evidence

This isolated harness measures `posthog-js` **1.438.12** through the built
Observer PostHog adapter in this checkout. It is outside the npm workspace.
The lockfile pins the SDK, Playwright **1.58.2**, esbuild **0.25.12**, and
their resolved dependencies. Results record the exact SDK artifact hashes,
Chromium version, source base, observations, and one measuring test for each
of E1–E17 and the amended `resetCancelsPendingRequests` item from #2181.

Run from the repository root, with a real Chromium installation available:

```sh
npm run agent:cloud:bootstrap
npm run agent:cloud:check
npm run build
npm --prefix evidence/posthog-js ci < /dev/null
npm --prefix evidence/posthog-js test < /dev/null
node evidence/posthog-js/check-results.mjs < /dev/null
npm run check:safety < /dev/null
git diff --name-only origin/main...HEAD < /dev/null
```

The runner uses installed Chromium when available, otherwise Playwright's
installed Chromium. A missing or unusable browser fails the run; there is no
DOM substitute. A selected development probe can be run with, for example,
`npm --prefix evidence/posthog-js test -- --grep 'E15$'`. Selected runs do
not replace the full results file. The full command runs every item and
replaces [results/1.438.12.json](results/1.438.12.json) only after the suite
passes. `check-results.mjs` rejects missing answers, missing measuring tests,
an incorrect version, incomplete capability fields, or missing evidence
metadata. The full test command also proves the guard refuses an empty or
placeholder answer, a missing measuring test or item, and a changed
capability value.

Every HTTP request from the page is fulfilled by a local Playwright stub,
including config, ingestion, flags and recorder loading. The fixture has a
loopback HTTP origin; its server fails requests escaping interception.
WebSockets are closed locally. A dead loopback proxy, including for otherwise
bypassed loopback addresses, prevents a network escape. Recorder responses
come from the pinned SDK's installed files. The project identifier is the
literal `evidence-only-project`; no real project key or shell environment
value is read.

The SDK rejects `HeadlessChrome` and `navigator.webdriver` before its event
hook. The real Chromium fixture therefore uses a standard Chromium user
agent matching its version and disables Blink's `AutomationControlled`
feature. This measures the normal visitor path under automation; it does not
establish behavior for other user agents. DNT is installed before SDK import.

The actual configured `before_send` function retains its identity. A uniquely
identified method in the shipped minified SDK observes its inputs and
outputs; diagnostic queue access observes accepted work and invokes the
SDK's unload flush. The rrweb observer delegates to the real recorder and
captures emitted records and options. These observations depend on the
recorded artifact hashes. A mismatched diagnostic method or queue fails
rather than silently producing evidence.

Recording diagnostics explicitly start the real SDK instance and perform a
real post-start click. The adapter's replay probe stays false throughout;
diagnostic recording is separate from permission to enable replay. Timer
rotation uses Chromium's controlled clock and is not a wall-clock soak.

| Item | Observed answer | Test |
| --- | --- | --- |
| E1 | Four forced configurations initialize; compound selector allows public click/submit and excludes private targets. Public declarations omit `session_recording.recordCanvas` and `session_recording.compressEvents`. | `E1` |
| E2 | Named initialization is separate from the default; reuse returns the existing instance and ignores a replacement hook. Function identity is preserved and the adapter rejects reuse. | `E2` |
| E3 | All five URL fields reach the hook; decoded ingestion contains the adapter's rewritten values. | `E3` |
| E4 | Opt-in emits `$opt_in`; the adapter drops it. | `E4` |
| E5 | Consent reaches localStorage despite `persistence: "memory"`. Phase snapshots and operation logs list every measured store/key, including transient support tests. | `E5` |
| E6 | Opt-out retains an accepted SDK queue entry; an unload flush can deliver it afterward. | `E6` |
| E7 | Explicit start works after recording-disabled init. Stop ends recording and flushes a buffered snapshot through the hook. | `E7` |
| E8 | Real autocapture and snapshot events reach the hook; rebuilt element chains reach ingestion. Snapshot properties lack `$current_url`; the adapter drops them. | `E8` |
| E9 | Four private selectors produce block placeholders. Controlled fetch/console/canvas stimuli produce no corresponding payload records. Address records lose fragments, and some navigation forms produce no address record. | `E9` |
| E10 | Raw rrweb data is structured and measured input/value text is masked. SDK snapshot data can contain string data and `cv: "2024-10"` despite `compressEvents: false`. | `E10` |
| E11 | Inline script text becomes exactly `SCRIPT_PLACEHOLDER`, which fails `MASKED_TEXT_PATTERN`. | `E11` |
| E12 | Reset changes both IDs; capture after the controlled inactivity interval rotates session ID while keeping distinct ID. | `E12` |
| E13 | Pre-import avoids the recorder fetch; lazy loading requests the versioned local recorder URL. Config/other extension scripts still occur. | `E13` |
| E14 | The actual lazy transport makes no provider load or SDK request before first grant. Direct SDK initialization has a different boundary, measured in E1. | `E14` |
| E15 | All assumed members exist. Both disables prevent measured flag requests; enabled requests include person/initial URL/referrer properties. `featureFlags.reset()` rejects stale responses but retains an already cached variant; full SDK reset clears it. | `E15` |
| E16 | DNT suppresses measured events and recording, while config/extension script requests still occur. | `E16` |
| E17 | Capability values derive from the observations, including false text-masking and navigation-address findings. Replay remains off. | `E17` |
| resetCancelsPendingRequests | True for SDK-level evaluation cancellation: after reset, an old response reaches neither the later subscription nor cache; a fresh reply reaches the new subscription. The no-reset control delivers the old variant. HTTP transport abortion is separately false. | `resetCancelsPendingRequests` |

The named cancellation result records the observed sequence and a boolean
answer both as an item and under `resetCancelsPendingRequests` at the result
root. Its meaning is pending SDK evaluation invalidation, rather than
retracting a transmitted request: the old HTTP response completes locally,
but the SDK rejects its old-generation result. `transportCancellationObserved`
records that distinction. This is separate from clearing an existing cache.

Each test is in [evidence.spec.mjs](evidence.spec.mjs); the JSON contains the
question, concrete answer, method, observations and limits. Numbers and IDs
that are incidental to the measurement are normalized; ID-change findings
are computed before normalization. Generated browser bundles and test output
stay under ignored `node_modules/.cache/`.

These are bounded fixture observations for the recorded build. Declaration
membership and retained config values do not establish every option's
behavior. Unexercised extensions, arbitrary host markup, every possible
record kind, cross-origin content, cross-tab behavior, session maximum
lifetime and other SDK builds remain unproven. In particular, request
correlation alone does not meet C-73's separate request-shape and
cache-clearing requirements. Successful measurement does not approve a replay
or flags attestation, publish safety, release qualification, or adoption.
