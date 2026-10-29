# Shared control and state foundations

The curated registry contains 217 properties: the existing 188 plus 29 control,
focus, motion, loading, layering and table roles. The 31 source families retain
their identity. Each property has application guidance and a preview; display
navigation is separate from source-family membership. The generated reference
is [TOKENS.md](../../packages/designer/TOKENS.md).

The 18 prescribed names outside the legacy family prefixes have explicit,
property-specific semantic family assignments. This does not admit arbitrary
new names. Color aliases follow the existing brand and light/dark cascade.
`--ui-radius-overlay` aliases `--radius-control`. Popovers retain the modal layer;
there is no separate popover or consent stacking token in this foundation.

## CSS contracts

Import the normal token and compiled stylesheet paths. These CSS-only utilities
are emitted before their adoption by individual components:

- `tap-target` expands a logical pseudo-element hit region to at least 44px.
  `control-h-sm` retains its 32px visual height with that expanded target;
  `control-h-md` follows the 44px tap target and `control-h-lg` uses 52px.
- `control-row` uses 36px normally and 44px for coarse pointers. `control-text`
  uses body text normally and the larger body size for coarse pointers.
  Mark geometry becomes 20px and the switch track becomes 44 by 24px on coarse
  pointers; the thumb's existing geometry remains separate.
- `focus-ring`, `focus-ring-inset` and `focus-ring-inverse` provide a 2px outline,
  a 2px outside or negative inset offset, keyboard-visible color and forced-colors
  `Highlight`. Existing composite ring bindings remain available internally.
- `table-row-density` defaults to comfortable 48px rows. Compact 36px rows require
  `data-density="compact"` and a fine pointer.
- `ui-loading-delayed` reveals after the loading-delay token. `ui-pending-label`
  hides only by opacity after the same delay, retaining its layout space.
  `ui-skeleton` supplies a dashed `GrayText` hairline in forced colors.
- `ui-progress-slide` binds an indeterminate fill with `inline-size: 40%` to the flash duration and
  default easing, with mirrored motion in RTL. `ui-nav-trickle` grows monotonically
  from zero to 0.9 over the long-loading interval, anchored at inline-start.
  Reduced motion stops both animations and shows a static full-width fill at
  scale one. The reveal delay remains because waiting is not motion.

The `overlay-fade`, `overlay-pop`, `overlay-zoom` and `sheet-slide` keyframes are
available for the owning overlay components to adopt with duration and easing
tokens. Reduced-motion overrides retain opacity without translation or scaling.
No existing Atom adopts a new recipe in this unit. TextField and Textarea retain
their current implementation because the conditional migration premise was absent.

The disabled-reason hook is internal wiring only: it creates a stable reason id,
merges and deduplicates existing `aria-describedby` ids, and supplies no copy or
rendering. A later component must render the host-provided reason using that id.
No component consumes the helper yet and no public barrel export was added.

## Contrast boundary

The focus and selected-indicator pairs are checked on their actual adjacent
grounds in both themes at 3:1, with no exceptions or reduced thresholds. The
outside ring of an accent-filled control is checked against its offset gap's
surface, rather than the nonadjacent fill.

Control-edge migration remains deferred: line-base on raised is about 1.45:1 in
light and 1.14:1 in dark; line-strong on raised is about 2.03:1 and 1.69:1.
The existing policy classifies these as decorative dividers, while TextField,
Checkbox, RadioGroup and Switch also use them as control edges. This unit does
not change those Atom paints or claim that their boundary contrast passes.
A darker edge role requires a separate color decision.

## Agent-run browser sweep

Run the dependency-free script against an explicit local fixture URL:

```sh
node scripts/state-sweep.mjs --url http://127.0.0.1:4173/fixture
```

It uses `CHROME_PATH` when explicitly supplied, then established browser paths.
It installs nothing and is not registered as a package script or CI gate. Missing
Chromium produces a clear `SKIPPED` message, a JSON report and exit 0. A skip is
not a passing browser observation. Browser/transport failures exit 1.

The four viewport widths are 320, 390, 640 and 768px. The 640px case represents
the available viewport width in the calculation `1280px / 2 = 640px`; it does not claim
that native browser zoom was changed. Dark preference, forced colors and reduced
motion are emulated. The report records overflow, measured hit regions including
pseudo-elements and corner hit testing, keyboard focus outline, running infinite
animations, and pending layout shift. An opted-in `data-state-sweep-pending`
fixture control is clicked for the pending measurement. Missing pending probes,
focus targets or measurements are `unverified`, not invented passes. Findings
and incomplete runtime verification exit 1; complete passing measurements exit 0.

Node tests exercise arguments and report shape without requiring a browser.
The fixture must supply its own interaction states; this foundation does not
assert every existing Atom's behavior merely because shared CSS exists.

## Regeneration and proof

```sh
npm run generate:compiled-css --workspace=packages/designer
npm run generate:preview-css --workspace=packages/publisher
node packages/designer/scripts/generate-token-docs.mjs
```

These existing generators own compiled.css, utilities.css, Publisher preview.css,
TOKENS.md and the token-selection section of the Designer skill. The stylesheet
scanner and generators are unchanged. Named source mutations are tested against
actual generated CSS and restored byte-for-byte; freshness checks retain their
existing enforcement. Package versions and public export boundaries are unchanged.
