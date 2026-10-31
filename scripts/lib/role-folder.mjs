// The consumer-repository folder each role package writes into and feeds from.
// Every role uses `clossys/<role>/` except the roles listed here, whose folder
// moved under `clossys/agents/`. Checks import this instead of rebuilding the
// prefix so a layout move is one edit, not one per check.
const MOVED_ROLE_FOLDERS = Object.freeze({
  strategist: "clossys/agents/strategist/",
});

/** `@clossys/strategist` -> `clossys/agents/strategist/`; `@clossys/writer` -> `clossys/writer/`. */
export function roleFolder(role) {
  const short = String(role).split("/").pop();
  return Object.hasOwn(MOVED_ROLE_FOLDERS, short) ? MOVED_ROLE_FOLDERS[short] : `clossys/${short}/`;
}
