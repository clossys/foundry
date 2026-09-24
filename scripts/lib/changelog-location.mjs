// changelog-location — the one place that says where a package's changelog
// lives.
//
// A package's release notes are NOT part of its tarball. They live in this
// public repository at docs/changelogs/<dir>.md, where <dir> is the
// package's own packages/<dir> directory name, and each package README links
// to that file by its absolute public URL. The reason is correction cost: a
// file inside the tarball can never be corrected after publish, every edit to
// it is a packed-content change that release readiness demands a changeset
// for, and every edit moves the packages/<dir> git tree hash a qualification
// record binds to. A changelog kept outside packages/<dir> is an ordinary
// docs file: fixing a wrong sentence in it costs a docs edit, not a release.
//
// Every script that reads or writes a changelog (the release PR producer,
// the release PR shape gates, the contamination gate, the changelog
// location gate) derives the path from here rather than spelling it itself,
// so the location cannot drift between the tool that writes an entry and the
// gate that checks it.
import { basename, join, resolve } from "node:path";

export const CHANGELOGS_DIR = "docs/changelogs";

// docs/changelogs/README.md explains the directory; it is not a changelog.
export const CHANGELOGS_README = "README.md";

// A repository-relative changelog path: docs/changelogs/<dir>.md, where
// <dir> is one path segment and is not the directory's own README.
export const CHANGELOG_REL_PATH_RE = /^docs\/changelogs\/(?!README\.md$)([^/]+)\.md$/;

// "docs/changelogs/<dir>.md", repository-relative, "/"-separated.
export function changelogRelPath(dir) {
  return `${CHANGELOGS_DIR}/${dir}.md`;
}

// The absolute path of <dir>'s changelog under repository root `root`.
export function changelogPath(root, dir) {
  return join(resolve(root), CHANGELOGS_DIR, `${dir}.md`);
}

// The changelog for a packages/<dir> directory, given that directory's own
// path (absolute or relative). The repository root is two levels above it,
// the same layout every caller already assumes for packages/<dir>.
export function changelogPathForPackageDir(pkgDir) {
  const abs = resolve(pkgDir);
  return join(abs, "..", "..", CHANGELOGS_DIR, `${basename(abs)}.md`);
}

// The absolute public URL a package README links to, derived from that
// package's own manifest `repository` field rather than written down a
// second time here: "git+https://github.com/<owner>/<repo>.git" becomes
// "https://github.com/<owner>/<repo>/blob/main/docs/changelogs/<dir>.md".
// Returns null for a `repository` this cannot read as a GitHub HTTPS URL, so
// a caller reports that instead of guessing.
export function changelogPublicUrl(repository, dir) {
  const raw = typeof repository === "string" ? repository : repository?.url;
  if (typeof raw !== "string") return null;
  const m = /^(?:git\+)?https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(raw.trim());
  if (!m) return null;
  return `https://github.com/${m[1]}/${m[2]}/blob/main/${changelogRelPath(dir)}`;
}
