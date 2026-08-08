/**
 * This file is NOT a public entry point — `package.json` deliberately
 * declares no `"."` export. Import from `@vespeneventures/render/web`
 * instead (and, when they exist, `/email`, `/print`, `/slides`, `/image`)
 * — see the README for why every import names its channel explicitly, the
 * same convention `@vespeneventures/ui` already set for its own subpaths.
 * This barrel exists only so the same names are reachable from one place
 * for internal tooling (see `scripts/check-readme-parity.mjs` in the
 * repository root, which reads `src/index.ts` as every package's canonical
 * export list); it re-exports exactly what `./web/index.js` exports,
 * nothing more. A future channel subpath's own exports get added here too,
 * the same way `ui`'s root barrel grew one `export ... from` block per
 * layer as `atoms`/`blocks`/`views`/`shell`/`charts`/`icons` shipped.
 */
export {
  renderWebDocument,
  buildWebHeadMetadata,
  listWebTemplateNames,
  RenderError,
} from "./web/index.js";
export type {
  RenderErrorReason,
  CopyResolver,
  RenderWebOptions,
  RenderWebResult,
  WebHeadMetadata,
  WebOpenGraphMetadata,
  WebTwitterMetadata,
} from "./web/index.js";
