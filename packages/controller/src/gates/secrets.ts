/**
 * Public entry point for the source-aware, `typescript`-dependent secret
 * gates — split out of `./gates` (this PR; CI failure on #419, closing the
 * consequence of #411). `secret-gates.ts`'s own header has the full
 * history; the short version: `secret-gates.ts` imports `typescript`
 * unconditionally at module scope, and it used to be re-exported straight
 * out of `gates/index.ts`, so ANY consumer of the public `./gates` subpath
 * — including ones that only ever wanted `runFoundationCheck` or
 * `createGateReasons`, never a secret gate — transitively pulled in a full
 * TypeScript compiler. `installed-bin.test.ts` caught the sharpest form of
 * that: an offline install of the published tarball failed outright once
 * `typescript` became a required peer, because npm had to resolve it and a
 * clean install has no cache.
 *
 * This package already had a working answer to "how do we keep one
 * TypeScript-dependent gate from forcing a compiler on everyone" —
 * `index.ts` and `governance.ts` deliberately import `./gates/build-order.js`
 * and `./gates/foundation.js` directly rather than through the `./gates`
 * barrel, precisely to keep `typescript` out of the root's import graph
 * (see `governance.ts`'s own header). This file extends that same
 * technique one level down: `./gates` itself now stays clean, and this
 * subpath — `./gates/secrets` — is the one place a consumer opts into the
 * compiler, by importing this file and nothing else.
 *
 * `typescript` is an OPTIONAL peer again (package.json's
 * `peerDependenciesMeta`) — restored, not merely left alone: it was
 * removed by #411's fix, but #411's actual defect (an unconditional
 * import inside a barrel a consumer might not want) is what this file's
 * split fixes at the source. With the barrel clean, "optional" is honest
 * again for `./gates`; it stays honest for THIS subpath too, in the sense
 * that npm will still let a consumer install this package without
 * `typescript` — the failure just moves from install time to whenever
 * they actually `import` from here, exactly like it always has for this
 * one file. See `secret-gates.ts`'s own header for the version guard that
 * turns an absent-or-incompatible peer into a named, actionable error
 * rather than an opaque crash deep inside the compiler API.
 *
 * BREAKING CHANGE: a consumer who imported any of these names from
 * `@clossys/controller/gates` must now import them from
 * `@clossys/controller/gates/secrets` instead. `./gates` no longer
 * re-exports them at all.
 */
export {
  checkCredentialInventory,
  checkCredentialSurfaceDrift,
  checkLocalSecretFiles,
  checkProviderResourceNames,
  checkSecretName,
  checkSecretReadiness,
  checkValueFreeSecretCatalog,
  detectRawSecretReads,
} from "./secret-gates.js";
export type {
  CredentialInventory,
  CredentialInventoryEntry,
  CredentialSurfaceObservation,
  LocalFileObservation,
  LocalSecretFileOptions,
  ProviderResourceNamingRule,
  ProviderResourceObservation,
  RawSecretReadOptions,
  SecretCatalogGateDocument,
  SecretCatalogGateEntry,
  SecretGateFinding,
  SecretReadinessObservation,
} from "./secret-types.js";
