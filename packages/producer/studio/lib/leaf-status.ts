import { studioCopy } from './studio-copy';
/**
 * The one leaf status vocabulary every Studio gallery and detail renders: each record status
 * maps to one label and one Badge tone here, so an agent adapter never carries its own copy.
 * `pending` (nothing pinned, options recorded) is neutral; only `missing` (nothing exists) and
 * `failing` read as errors.
 */
export type LeafStatus = 'pinned' | 'pending' | 'missing' | 'failing' | 'stale' | 'unreleased' | 'active' | 'draft' | 'retired';
export type LeafTone = 'secondary' | 'outline' | 'destructive';

export const LEAF_STATUS_LABEL: Record<LeafStatus, string> = {
  pinned: studioCopy("studio.pinned"), pending: studioCopy("studio.pending-approval"), missing: studioCopy("studio.missing"), failing: studioCopy("studio.failing"), stale: studioCopy("studio.stale"), unreleased: studioCopy("studio.unreleased"),
  active: studioCopy("studio.active"), draft: studioCopy("studio.draft"), retired: studioCopy("studio.retired"),
};

export const LEAF_STATUS_TONE: Record<LeafStatus, LeafTone> = {
  pinned: 'secondary', active: 'secondary',
  pending: 'outline', unreleased: 'outline', stale: 'outline', draft: 'outline',
  missing: 'destructive', failing: 'destructive', retired: 'destructive',
};

/** The one count unit every Studio surface uses: a leaf is one L3 page in the Studio map. */
export const LEAF_UNIT = [studioCopy("studio.leaf-unit"), studioCopy("studio.leaves-unit")] as const;
export const leafCountLabel = (count: number) => studioCopy("studio.leaf-count", { count });

/**
 * The specimen description for a leaf, following its status: a pending leaf has no pin, so its
 * preview shows the newest recorded option; every other leaf previews its pinned version.
 */
export function specimenDescription(status: LeafStatus): string {
  if (status === 'pending') return studioCopy("studio.this-leaf-is-not-pinned-yet-the");
  if (status === 'missing') return studioCopy("studio.this-leaf-has-no-recorded-version-yet");
  return studioCopy("studio.the-pinned-version-installed-and-bound-the");
}
