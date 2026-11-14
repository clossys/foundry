/**
 * The re-pin probe of check-compile-pure (R12.2 decisions): which candidate a Writer pin is moved
 * to, and what the probe concludes. A re-pin only proves the wiring when the new candidate's bytes
 * differ from the pinned one; byte-identical candidates (strings.actions studio-v1.md and
 * studio-v2.md) render identically by construction, so such a slot is skipped, never a finding.
 */
import { createHash } from 'node:crypto';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * The `.md` candidate to re-pin to: the last by name whose bytes differ from the pinned
 * candidate's. `{ other }` when one exists, `{ skip: 'no-distinct-candidate' }` when every other
 * candidate is byte-identical, `{ none: true }` when there is no other candidate at all.
 */
export function pickRepin(names, pinned, readBytes) {
  const others = names.filter(name => name !== pinned && name.endsWith('.md')).sort();
  if (!others.length) return { none: true };
  const pinnedSha = sha256(readBytes(pinned));
  const distinct = others.filter(name => sha256(readBytes(name)) !== pinnedSha);
  return distinct.length ? { other: distinct.at(-1) } : { skip: 'no-distinct-candidate' };
}

/** The finding for a distinct re-pin that changed `changed` output files (undefined when it changed some). */
export function repinFinding(repinned, changed) {
  return changed > 0 ? undefined : `re-pinning ${repinned} did not change the rendered output`;
}
