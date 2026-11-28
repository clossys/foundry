/**
 * `clossys review carry <cleared> <new>`: whether a review clearance at one head carries to a newer head of the same
 * unit. Reviewer owns the rule (R-REVIEW-CARRY): a clearance carries only over a mechanical default-branch carry, and
 * any change to the blob of one of the unit's own paths voids it.
 *
 * In order, the new head VOIDs the clearance when:
 *   1. it does not contain the cleared head;
 *   2. a commit between them that the default branch does not hold is not a merge (an own commit after clearance);
 *   3. a path the unit changed (merge base of the cleared head and the default branch, to the cleared head) has a
 *      different blob, or none, at the new head;
 *   4. any other path that changed between the two heads is not, at the new head, the blob the default branch holds
 *      at the newest default-branch commit the new head contains (a merge that resolved or added something by hand).
 * Otherwise it CARRYs.
 */
import { git } from "./exec.js";

export interface CarryResult {
  readonly schema: "clossys.review-carry/1";
  readonly cleared: string;
  readonly head: string;
  readonly onto: string;
  readonly verdict: "CARRY" | "VOID";
  readonly reason: string;
  /** The unit's own paths (changed from the merge base to the cleared head). */
  readonly ownPaths: readonly string[];
  /** Own paths whose blob differs at the new head. */
  readonly ownChanged: readonly string[];
  /** `CARRY <head>: <reason>` or `VOID <head>: <reason>`. */
  readonly line: string;
}

const tryGit = (repo: string, args: readonly string[]): string | null => { try { return git(repo, [...args]); } catch { return null; } };
const blob = (repo: string, commit: string, path: string) => tryGit(repo, ["rev-parse", "--verify", "--quiet", `${commit}:${path}`]) ?? "";
const names = (out: string) => out.split("\0").filter(Boolean);

/** Applies the carry rule to two commits of one repository; `onto` is the default branch ref. */
export function carryClearance(repo: string, cleared: string, next: string, onto: string): CarryResult {
  const resolve = (ref: string) => { const sha = tryGit(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]); if (!sha) throw new Error(`no commit ${ref}`); return sha; };
  const c = resolve(cleared), n = resolve(next), d = resolve(onto);
  const base = git(repo, ["merge-base", c, d]);
  const ownPaths = names(git(repo, ["diff", "--name-only", "-z", "--no-renames", base, c])).sort();
  const result = (verdict: "CARRY" | "VOID", reason: string, ownChanged: readonly string[] = []): CarryResult => ({ schema: "clossys.review-carry/1", cleared: c, head: n, onto: d, verdict, reason, ownPaths, ownChanged, line: `${verdict} ${n}: ${reason}` });
  if (c === n) return result("CARRY", "the new head is the cleared head");
  if (tryGit(repo, ["merge-base", "--is-ancestor", c, n]) === null) return result("VOID", "the new head does not contain the cleared head");
  for (const line of git(repo, ["rev-list", "--parents", `${c}..${n}`, "--not", d]).split("\n").filter(Boolean)) {
    const [commit, ...parents] = line.split(" ");
    if (parents.length < 2) return result("VOID", `own commit ${commit!.slice(0, 12)} after the clearance: only a default-branch merge carries`);
  }
  const ownChanged = ownPaths.filter(path => blob(repo, c, path) !== blob(repo, n, path));
  if (ownChanged.length) return result("VOID", `own-path blob change: ${ownChanged.slice(0, 3).join(", ")}${ownChanged.length > 3 ? ` and ${ownChanged.length - 3} more` : ""}`, ownChanged);
  const merged = git(repo, ["merge-base", n, d]);
  const own = new Set(ownPaths);
  const moved = names(git(repo, ["diff", "--name-only", "-z", "--no-renames", c, n])).filter(path => !own.has(path));
  const hand = moved.filter(path => blob(repo, n, path) !== blob(repo, merged, path));
  if (hand.length) return result("VOID", `not a mechanical carry: ${hand.slice(0, 3).join(", ")} differ${hand.length === 1 ? "s" : ""} from the default branch at ${merged.slice(0, 12)}`);
  return result("CARRY", moved.length ? `default-branch carry of ${moved.length} path(s); no own path changed` : "no path changed");
}
