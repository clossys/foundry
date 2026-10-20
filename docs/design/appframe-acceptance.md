# AppFrame acceptance

The suite drives the real AppFrame with Designer package exports and host-supplied
routes, account actions and content. It uses JSDOM, user-event and a platform
`matchMedia` fixture. Results cover DOM interactions and focus; they do not measure
browser painting, pointer geometry or device layout.

## Feature matrix

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

## Mutation proof

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

## Command results

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
