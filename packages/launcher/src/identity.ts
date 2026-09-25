// The one rule for "is this the same GitHub repository" and "is this the
// same GitHub account" in Launcher (#1179). Every such decision -- the
// inventory's duplicate rule, a --repositories choice against the stored
// inventory, the appoint --inventory merge, the hub excluding itself from
// its own roster, matching a sibling checkout's origin, whether an id
// belongs to the hub's account, CLOSSYS_OWNER against the origin, and the
// drift report -- goes through the functions below and nothing else.
//
// GitHub compares owner and repository names without regard to letter case,
// and a bare inventory id names a repository of the hub's own owner, as
// Launcher's sibling resolution reads it. A folder path is never used as a
// repository's identity: on a case-insensitive file system two spellings of
// a path name the same folder, so a path comparison can disagree with the
// repository it holds.

/** An owner or repository name as GitHub compares it. */
function nameKey(name: string): string {
  return name.toLowerCase();
}

/**
 * The identity of a repository id: a bare id is qualified with the hub's
 * owner when that owner is known, and the result is compared as GitHub
 * compares names. Without an owner, a bare id stays bare.
 */
export function inventoryKey(id: string, hubOwner?: string): string {
  return nameKey(hubOwner !== undefined && !id.includes("/") ? `${hubOwner}/${id}` : id);
}

/** Whether two repository ids name the same repository. */
export function sameRepository(left: string, right: string, hubOwner?: string): boolean {
  return inventoryKey(left, hubOwner) === inventoryKey(right, hubOwner);
}

/** Whether two owner names name the same GitHub account. */
export function sameOwner(left: string, right: string): boolean {
  return nameKey(left) === nameKey(right);
}

/** Whether a repository id names a repository of `hubOwner`'s account (a bare id always does). */
export function belongsToOwner(id: string, hubOwner: string): boolean {
  const slash = id.indexOf("/");
  return slash === -1 || sameOwner(id.slice(0, slash), hubOwner);
}

/** The first spelling of each distinct owner, in order: case variants of one account are one owner. */
export function distinctOwners(owners: Iterable<string>): string[] {
  const kept: string[] = [];
  for (const owner of owners) if (!kept.some((existing) => sameOwner(existing, owner))) kept.push(owner);
  return kept;
}
