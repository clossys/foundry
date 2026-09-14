// gh-api — the one `gh api` wrapper this repository's scripts share.
//
// Previously defined twice: once in `check-gate-efficacy.mjs` (as
// `ghFetchJson`) and once in `.github/scripts/collect-credential-
// evidence.mjs` (as `ghApi`), identical apart from `maxBuffer`. Neither
// script depends on the other's package graph, so this lives in
// `scripts/lib/` — a plain, dependency-free module (node builtins only,
// matching every other file here that `check:gates` runs) rather than
// having one script import the other and drag in packages it does not
// need (`check-gate-efficacy.mjs` imports `@clossys/observer`, which
// `collect-credential-evidence.mjs` has no reason to require just to make
// one API call).

import { execFileSync } from "node:child_process";

/** `gh api` as a synchronous JSON fetcher: it already holds the credential and the host. */
export function ghFetchJson(path) {
  const out = execFileSync("gh", ["api", "-H", "Accept: application/vnd.github+json", path], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}
