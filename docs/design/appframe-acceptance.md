# AppFrame acceptance

The suite drives the real AppFrame with Designer package exports and host-supplied
routes, account actions and content. It uses JSDOM, user-event and a platform
`matchMedia` fixture. Results cover DOM interactions and focus; they do not measure
browser painting, pointer geometry or device layout.

## Historical feature matrix (#2301)

Each row names an `it` in `AppFrame.acceptance.test.tsx`. Base means unchanged
producers at base `5077a8815685772234a5b68627fc6b4125e19e99`. The initial theme fixture queried a Panel as an
implicit region; supplying its explicit host `role` corrected that fixture before
the measured base run. No producer defect was demonstrated in this acceptance matrix. All seven measured
base feature tests passed; the producer files remain unchanged.

| Named test | Base | Final | Evidence exercised |
| --- | --- | --- | --- |
| navigation: drives two levels by pointer and Arrow/Home/End/Enter with current state and collapse focus | PASS | PASS | Active child `aria-current`; pointer and Enter disclosure; Home, End and arrows; disclosure and rail toggle retain focus. |
| commands: opens by shortcut and trigger, filters, selects a host href and restores focus on Escape | PASS | PASS | Platform Mod+K; filter; Arrow selects; Enter follows supplied anchor hash; trigger reopening and Escape focus return. |
| account: lists host items, dismisses with Escape and requires the supplied destructive confirmation | PASS | PASS | Link and destructive items; Escape focus return; host Dialog callback; cancel does not delete, explicit confirmation executes once. |
| theme: the header slot updates a child Block through the native provider without remount | PASS | PASS | Supplied ThemeToggle in header slot; native provider updates Panel child and document; child DOM identity, state and mount count persist. |
| mobile: the breakpoint creates a navigation sheet with focus containment and Escape/navigation dismissal | PASS | PASS | Live transition below 768px; navigation moves into sheet; repeated Tab and Shift+Tab remain inside; Escape and host route change close with focus return. |
| panels: defaults to no right panel, bounds keyboard resizing and restores focus after the modal Drawer closes | PASS | PASS | Absent default panel; late supplied panel; Arrow, Home/End and bounds; narrow Drawer contains focus, Escape and close button restore opener. |
| landmarks: exposes one main and nav and the skip link focuses the sole main | PASS | PASS | Exactly one main and navigation; skip href identifies main and activation focuses it. |

The theme test moves from explicit light to dark, then system resolved as light by
the platform fixture. The mobile test follows the existing host contract: the host
reports updated `activeId` and `navigationKey` after link activation. Destructive
confirmation composes the existing account action and Dialog without a new API.

## Historical mutation proof (#2301)

Each temporary mutation changes the real AppFrame composition. Each named test runs
against that mutation, then reruns after restoring producer bytes exactly. No
mutated producer is committed. Each pair filters to its named feature test (the
other six tests are not selected); the intact final suite runs all seven.

| Class | Temporary mutation | Assertion killed | RED exit | Restored exit |
| --- | --- | --- | --- | --- |
| Navigation | Supply empty navigation tree | Active Tasks destination missing | 1 | 0 |
| Commands | Disable composed opening shortcut | Shortcut does not open combobox | 1 | 0 |
| Account | Omit navigation footer | Account trigger missing | 1 | 0 |
| Theme | Omit theme control slot | Host theme toggle missing | 1 | 0 |
| Mobile | Hold navigation drawer closed | Navigation sheet does not open | 1 | 0 |
| Panels | Omit desktop resizable pane | Resize separator missing | 1 | 0 |
| Landmarks | Omit skip link | Skip link missing | 1 | 0 |

## Historical command results (#2301)

- `npm run agent:cloud:bootstrap < /dev/null`: exit 0.
- `npm run agent:cloud:check < /dev/null`: exit 0.
- `npm run build < /dev/null`: exit 0.
- `npx vitest run packages/publisher/src/web/frame/AppFrame.acceptance.test.tsx < /dev/null`:
  unchanged-base measured run and final restored run both exit 0, seven tests passed
  in each. The final run includes additional Left/Right navigation assertions.
- `npx vitest run packages/publisher/src/web/frame packages/designer/src/blocks/AppNavigation.test.tsx packages/designer/src/blocks/CommandMenu.test.tsx packages/designer/src/blocks/AccountMenu.test.tsx < /dev/null`:
  exit 1, 460 passed and 95 failed. Root does not load Designer's package JSDOM/setup
  configuration; its three files fail with `document is not defined`. This is an
  execution mismatch, not a feature failure. The authorized substitution runs the
  same regression coverage in two serial commands with native package setup:
- `npm run test --workspace=packages/publisher -- src/web/frame < /dev/null`:
  exit 0, 14 files and 459 tests passed.
- `npm run test --workspace=packages/designer -- src/blocks/AppNavigation.test.tsx src/blocks/CommandMenu.test.tsx src/blocks/AccountMenu.test.tsx < /dev/null`:
  exit 0, three files and 96 tests passed.
- `npm run typecheck < /dev/null`: exit 0 after the root build.
- Mutation pairs use `npx vitest run packages/publisher/src/web/frame/AppFrame.acceptance.test.tsx -t "CLASS:" < /dev/null`,
  with CLASS equal to navigation, commands, account, theme, mobile, panels or landmarks.
  Each RED exits 1 at the listed DOM assertion; each exact restoration exits 0.

Local checks do not provide FULL public-safety clearance. Hosted exact-head
verification remains required before reporting completion.


## Floating stage and navigation contract (#2319)

The updated layout keeps the real Designer navigation, command, account, theme,
Drawer and resizable-panel implementations. The earlier matrix above records the
original assembly; its header-theme and rail descriptions are historical. The
current theme control belongs in the navigation footer, and closing navigation
removes the full panel instead of leaving an icon rail. Existing nested-dialog
focus-handoff regressions remain in the frame suite.

The new acceptance cases run through AppFrame itself. JSDOM covers semantics,
interaction, responsive policy and focus. A separate real Chromium fixture loads
tokens, the canonical preview stylesheet and theme keys in that order to measure
rectangles and real pointer hit targets. Browser observations are kept separately
from structural assertions. The final local package commands and 18 named
mutation pairs pass; hosted verification at the eventual draft head remains
required before review.

| Class | Named coverage | Initial evidence | Final |
| --- | --- | --- | --- |
| a | Logical corner controls, conditional right control, expanded state, focus return and coincident modal close | RED on the old composition; the real browser also demonstrated the original hidden modal opener | PASS (local) |
| b | Reserved docked widths, centered stage and overlay rules in LTR and RTL | RED on the old composition | PASS (local) |
| c | Page width default, in-memory override and controlled value | RED on the old composition | PASS (local) |
| d | Sticky stage-width glass bar, scroll clearance and opaque fallback | RED on the old composition | PASS (local) |
| e | Home mark, root breadcrumb, final h1, ancestor siblings and workspace switcher | RED on the old composition; collapsed sibling omission also demonstrated before correction | PASS (local) |
| f | Optional anchored information, Escape/outside dismissal and explicit/inherited direction | RED on the old composition and on missing portaled direction | PASS (local) |
| g | At most one primary action, narrow secondary overflow and trailing width divider | RED on the old composition; first-primary behavior has a separate multiple-request regression | PASS (local) |
| h | Search first, full-close navigation, footer account/theme and closed-navigation shortcut | RED before host slots were implemented | PASS (local) |

The two additive overlay hooks retain the existing interaction owners:
`Drawer.closeButtonStyle` positions its existing close control from the actual
opener rectangle and direction, while `Popover.anchorRef` selects the bar as its
positioning anchor. Omitted Drawer layout is compared byte-for-byte with explicit
undefined; omitted Popover anchoring retains the real trigger and existing focus,
Escape and outside-dismissal behavior. No second overlay or keyboard lifecycle
is implemented.

The measured Chromium geometry matrix covers light and dark, LTR and RTL,
viewport widths 375, 899, 1000, 1280 and 1920, and a separately embedded frame at
899. All 24 corrected-source cases pass stage centering within the remaining
area, horizontal containment, information-overlay width and direction, and the
44px coincident corner controls. Real pointer clicks at the opener coordinates
close both narrow sheets and restore focus to their openers.

The embedded RTL cases first demonstrated a 15px mismatch after the modal scroll
lock. The targeted observation found a zero-origin fixed containing box ending
at 884px while `documentElement.clientWidth` reported 899px. The existing
scroll-gutter owner reserves the difference. RTL placement now uses CSS
`calc(100% - measured-right-edge)` so the containing box resolves its own width.
JSDOM asserts this expression; the Chromium matrix proves its geometry. Original
failing measurements and corrected observations are retained as session evidence.

Six conditions in the original eight-case fallback probe pass: normal,
reduced transparency and forced colors in both themes. The bar stays at 12px
while the stage scrolls, information does not move the route body, and width
toggling measures 1364px full and 1152px
contained in the 1920px fixture. Portaled text contrast measures 17.40:1 in light,
14.24:1 in dark and 21:1 under forced colors. The two unsupported-blur conditions
did not verify their feature stub, so that original eight-case run exited 1.
Their bounded two-case replacement waits for a
fresh document and unique marker, records both producer feature checks returning
false, and passes the unchanged assertions in light and dark with no blur.

### Local proof commands (#2319)

- Native Publisher frame tests: exit 0, 14 files and 512 tests.
- Native Designer AppNavigation tests: exit 0, two files and 28 tests.
- Designer AppNavigation, Drawer and Popover owning tests: exit 0, four files and
  65 tests, including omitted-default and focus/dismissal controls.
- Root typecheck, Designer and Publisher contamination checks, Publisher shipped
  copy lint, both README parity checks and public safety: exit 0 each.
- Canonical Designer compiled/utilities and Publisher preview generation and
  freshness: exit 0 each. Token parity and compiled coverage: exit 0, 20 tests.
- Package dry runs, scoped packed-content readiness against unchanged base
  `d2ddf2289823646bdb54d5690276306e628b39e6`, and changeset validation: exit 0.
  Readiness compares the repository's packed source proxy; the built candidate
  dry runs include its current declarations. Package versions remain unchanged.
- The original bare `publisher` workspace command exited 1 because that alias
  does not exist; the admitted native forms use `packages/publisher` and
  `packages/designer`. The unchanged-base native comparison passed after the
  repository build supplied the package declarations.

All 18 named mutants reach an assertion failure with exit 1 and pass after exact
producer restoration with exit 0: expanded state, minimum stage, width memory,
sticky bar, collapsed siblings, optional information, primary cap, search first,
accent default, image opt-out, Drawer layout hook, Popover anchor hook, tooltip
label-switch cancellation, reopened tooltip copy, CSS containing-box conversion,
search clearance, portaled direction and portaled ink. The restoration manifest
confirms byte equality; no mutated producer is committed.
