// Workspace packages renamed after they were published. Each row is one
// package under two spellings: the workspace directory and name it has now,
// and the directory and name its dated records (release catalog,
// qualification policy, publication records, changesets, changelogs, npm
// tarballs) were written under. Those records are history and are never
// edited; checks that join a record to a workspace package translate through
// this table instead. The npm-side move of a renamed package is an owner
// decision: until it lands, the published identity keeps its old spelling
// and the publish path, which reads the catalog, fails closed on it.
//
// This file is the one live source that spells a retired identity, so
// check:no-strategist excludes it by name.

export const PACKAGE_RENAMES = Object.freeze([
  Object.freeze({ directory: "director", publishedDirectory: "strategist" }),
]);

const BY_DIRECTORY = new Map(PACKAGE_RENAMES.map((row) => [row.directory, row]));
const BY_PUBLISHED = new Map(PACKAGE_RENAMES.map((row) => [row.publishedDirectory, row]));

const splitName = (name) => {
  const slash = String(name).lastIndexOf("/");
  return slash === -1 ? ["", String(name)] : [String(name).slice(0, slash + 1), String(name).slice(slash + 1)];
};

/** `director` -> `strategist`: the directory a workspace package's dated records use. Unrenamed packages map to themselves. */
export function publishedDirectory(directory) {
  return BY_DIRECTORY.get(directory)?.publishedDirectory ?? directory;
}

/** `strategist` -> `director`: the workspace directory a dated record's directory now lives in. */
export function workspaceDirectory(directory) {
  return BY_PUBLISHED.get(directory)?.directory ?? directory;
}

/** `@clossys/director` -> `@clossys/strategist`, in any scope. */
export function publishedName(name) {
  const [scope, short] = splitName(name);
  return `${scope}${publishedDirectory(short)}`;
}

/** `@clossys/strategist` -> `@clossys/director`, in any scope. */
export function workspaceName(name) {
  const [scope, short] = splitName(name);
  return `${scope}${workspaceDirectory(short)}`;
}

/** Two spellings name one package when they agree after translation to the workspace spelling. */
export function samePackage(left, right) {
  return workspaceName(left) === workspaceName(right);
}
