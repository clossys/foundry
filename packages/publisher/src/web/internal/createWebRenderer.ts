/**
 * `createWebRenderer` — the factory that returns an ISOLATED template
 * registry plus the renderer bound to it. Read this file's own doc
 * comment on `createWebRenderer` itself before reaching for a module-level
 * `Map` a consumer could mutate; the two approaches are not equivalent.
 */

import { renderWebDocumentAgainst } from "../renderWebDocument.js";
import { BUILTIN_WEB_TEMPLATES, buildTemplateMap } from "./webTemplates.js";
import type { CreateWebRendererOptions, WebRenderer } from "../types.js";

/**
 * WHY INSTANCE-SCOPED, NOT A GLOBAL MUTABLE REGISTRY
 * -------------------------------------------------------
 * The tempting alternative is a single module-level `Map` this file
 * exports alongside a `registerWebTemplate(t)` that pushes into it —
 * `getWebTemplate`/`listWebTemplateNames` already read one such `Map`
 * today (`webTemplates.ts`'s own `WEB_TEMPLATES`, holding exactly the
 * three built-ins). Extending that SAME map with a public mutator would
 * be the smaller diff. It is also a strictly worse design, for two
 * concrete reasons, not a stylistic preference:
 *
 *   1. ORDER DEPENDENCE. Whether `getWebTemplate("Hero")` resolves would
 *      depend on whether some other module's registration code happened
 *      to run before the caller's own import — an import-order accident,
 *      never a declared dependency. A test file that imports this
 *      package before a consumer's own template-registration module
 *      executes would see an incomplete registry through no fault of its
 *      own, and the failure would look like a flaky test, not a design
 *      defect, until someone traced it back to import order.
 *   2. CROSS-CONSUMER / CROSS-REQUEST COLLISION. A Node module's
 *      top-level state is a process singleton. Two independent consumers
 *      of this package loaded into the SAME process (a monorepo host
 *      bundling two apps, a test runner batching suites from different
 *      packages) would silently share one mutable template namespace — a
 *      name collision in one consumer's template set becomes a runtime
 *      bug in the OTHER's, with no import boundary between them to catch
 *      it. A long-lived server process registering templates per request
 *      would additionally risk one request's registration being visible
 *      to a concurrent one before its own template set finished building.
 *
 * `createWebRenderer(options)` sidesteps both: every template map it
 * builds lives in a closure captured by the one call that created it,
 * never on this module's own top level, and this file exports no
 * function that could reach into another instance's map at all — there
 * is no `registerWebTemplate` anywhere in this package for a consumer to
 * import and call. That is what makes the global-mutation option
 * STRUCTURALLY unavailable rather than merely discouraged by a comment: a
 * consumer who wants to register a template has exactly one path
 * (`defineWebTemplate` + `createWebRenderer({ templates: [...] })`), and
 * that path can never, by construction, touch a map any other
 * `createWebRenderer` call — or the module-level built-in registry
 * `renderWebDocument`/`listWebTemplateNames`/`getWebTemplate` use — also
 * reads from. This is the identical "factory returns an isolated policy
 * object closed over its own state" shape `@example/auth`'s
 * `createAllowedOriginPolicy` already uses in this codebase
 * (`packages/auth/src/redirect.ts`) — not a new pattern introduced here,
 * this package's first use of one it already has precedent for elsewhere
 * in the repository.
 *
 * WHAT THIS DOES NOT DO
 * --------------------------
 * `createWebRenderer` does not select a template from an intent, a brief,
 * or any run-time signal — `SurfaceDocument.template` remains a plain
 * string the CALLER names explicitly on every document, exactly as it
 * does for the built-in templates today. Extensibility here is about WHO
 * MAY ADD a template (now: any caller, via `defineWebTemplate`, not just
 * this package's own three), never about who PICKS one at render time.
 * This package still renders and validates; it does not compose — see the
 * README, "Scope: this package renders and validates. It does not
 * compose."
 *
 * BUILT-INS ARE OPT-IN, NOT GONE
 * -----------------------------------
 * `createWebRenderer()` with no arguments at all returns a renderer that
 * knows ZERO templates — not the three built-ins. `AuthView`/`ErrorView`/
 * `MarketingView` remain exported, unchanged, from this subpath; the
 * module-level `renderWebDocument`/`listWebTemplateNames`/`getWebTemplate`
 * functions (this package's ONLY entry point before this file existed)
 * keep rendering them exactly as they always have — under the hood, that
 * call path is `renderWebDocumentAgainst(defaultWebTemplateMap(), ...)`
 * (see `../renderWebDocument.ts`), a compatibility alias, not a new
 * default a caller has to opt into. Passing `includeBuiltins: true` here
 * additionally registers them on a NEW instance alongside a consumer's own
 * templates — useful for a consumer who wants both in one renderer — but
 * nobody currently calling the module-level `renderWebDocument` observes
 * any change from this file existing at all.
 */
export function createWebRenderer(options: CreateWebRendererOptions = {}): WebRenderer {
  const templates = [...(options.includeBuiltins === true ? BUILTIN_WEB_TEMPLATES : []), ...(options.templates ?? [])];
  const templateMap = buildTemplateMap(templates);

  return {
    renderWebDocument: (doc, renderOptions) => renderWebDocumentAgainst(templateMap, doc, renderOptions),
    listWebTemplateNames: () => [...templateMap.keys()],
    getWebTemplate: (name) => templateMap.get(name),
  };
}
