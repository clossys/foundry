/**
 * @vespeneventures/ui/views — the final rung of this package's component
 * ladder (atoms → blocks → views, with `shell` as the frame `views` fill).
 * A view is a whole PAGE's composition, where a second one on the same
 * page is incoherent — test 3 in this package's README, "Placement rules".
 * Deliberately a short list: two ship, `ErrorView` (a full-page error
 * state) and `AuthView` (a full-page authentication shell), because most
 * page-level composition belongs to the CONSUMER, assembled from blocks —
 * see the README's "Views" section for the full reasoning, including why
 * `ListView`/`FormView`/`DashboardView` are deliberately not here.
 *
 * `views` may import from `atoms` and `blocks` (the same "down only"
 * direction `blocks` importing `atoms` already established) — `ErrorView`
 * composes `blocks/EmptyState`, `AuthView` composes `atoms/Card`. `views`
 * never imports from `shell`: `shell` PROVIDES the slot a view fills, so a
 * view reaching into it would be exactly backwards, the same reason `shell`
 * itself never imports `views`. Nothing may import FROM `views` at all —
 * it is the top of the ladder. `src/ladder.test.ts` enforces every one of
 * these directions structurally.
 */

export { ErrorView } from "./ErrorView.js";
export type { ErrorViewProps } from "./ErrorView.js";

export { AuthView } from "./AuthView.js";
export type { AuthViewProps } from "./AuthView.js";
