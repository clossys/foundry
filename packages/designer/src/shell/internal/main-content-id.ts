/**
 * The `id` `Shell.Main` renders and the skip link's `href` targets. Not
 * exported from the package: there is exactly one `Shell.Main` per `Shell`
 * (see this package's README, "Placement rules" — shell provides slots,
 * cardinality one), so nothing outside the shell needs to know or vary it. Kept as a
 * shared constant rather than threaded through props so `ShellRoot` and
 * `ShellMain` — two independent, independently-rendered components in
 * `Shell.tsx` — stay in sync without either needing a reference to the
 * other.
 */
export const MAIN_CONTENT_ID = "ui-shell-main";
