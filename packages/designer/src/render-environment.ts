/**
 * @clossys/designer/render-environment — a plain, machine-readable
 * declaration of which render environment each of this package's
 * `package.json#exports` subpaths is safe for.
 *
 * This is DATA, not logic. It records `"server-safe"` or `"client-only"`
 * per subpath, decided empirically (see `atoms/server.ts`,
 * `blocks/server.ts`, `shell/server.ts`, `charts/server.ts`, and
 * `theme/server.ts` — each one's own header documents the
 * `node --conditions=react-server` probe that produced its verdict, run
 * against the REAL compiled output, never inferred from a file name or a
 * client-directive grep). It intentionally contains no resolver, no
 * module-graph walk, and no import of its own subject subpaths — a
 * consumer building a real checker (module-graph resolution under a
 * declared export condition, per issue #375's own "verification belongs
 * elsewhere" note) is expected to cross-check this declaration against
 * reality, not trust it blindly; this file is only the claim being
 * checked, kept in one place so a checker has something to check against.
 * Issue #358 places that REAL resolver in `builder`, shared with a second
 * declaration shape (layering-seam conformance) — a consumer of this
 * package gets that verification once `builder` ships it, not from here.
 *
 * WHAT ISSUE #405 CLOSES — NARROWER THAN THE FULL RESOLVER ABOVE: before
 * it, nothing verified even that this record stayed in step with the
 * MANIFEST it describes — a subpath could be added to (or removed from)
 * `package.json#exports` with no matching edit here, or vice versa, and
 * nothing would notice. `environment-conformance.ts`'s own
 * `checkEnvironmentConformance` is that declaration-consistency check —
 * it verifies this record's key set against `package.json#exports`' real
 * subpath set, in both directions, but performs NO module resolution of
 * its own; see that module's own header for exactly what it does and
 * does not verify, its full ternary, and the adversarial proof
 * (`environment-conformance.adversarial.test.ts`) it is built to pass.
 *
 * `"server-safe"` means: importing this subpath's compiled entry under
 * React's `react-server` module-resolution condition does not throw.
 * `"client-only"` means the same probe against that subpath's real
 * compiled entry throws — always because a dependency reads a
 * client-only React API (`useContext`, `useState`, `createContext`, ...)
 * at module scope, never because the file doesn't exist (see each
 * server entry's own header for the "probe a nonexistent path" trap this
 * package's own verification deliberately avoided).
 *
 * COVERAGE IS TOTAL AND EXACT, in both directions:
 * `render-environment.test.ts` asserts every key of
 * `RENDER_ENVIRONMENT` below is a real `package.json#exports` subpath,
 * and that every `package.json#exports` subpath has an entry here — a
 * subpath added to one without the other fails that test.
 */

export type RenderEnvironment = "server-safe" | "client-only";

export const RENDER_ENVIRONMENT: Readonly<Record<string, RenderEnvironment>> = {
  "./tokens": "server-safe",
  "./tokens.css": "server-safe",
  "./theme.css": "server-safe",
  "./compiled.css": "server-safe",
  "./brand-template.css": "server-safe",
  "./atoms": "client-only",
  "./atoms/server": "server-safe",
  "./icons": "server-safe",
  "./charts": "client-only",
  "./charts/server": "server-safe",
  "./blocks": "client-only",
  "./blocks/server": "server-safe",
  "./shell": "client-only",
  "./shell/server": "server-safe",
  "./theme": "client-only",
  "./theme/server": "server-safe",
  "./gate": "server-safe",
  "./render-environment": "server-safe",
};
