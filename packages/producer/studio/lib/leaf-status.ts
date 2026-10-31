/**
 * The one leaf status vocabulary every Studio gallery and detail renders: each record status
 * maps to one label and one Badge tone here, so an agent adapter never carries its own copy.
 * `pending` (nothing pinned, options recorded) is neutral; only `missing` (nothing exists) and
 * `failing` read as errors.
 */
export type LeafStatus = 'pinned' | 'pending' | 'missing' | 'failing' | 'stale' | 'unreleased' | 'active' | 'draft' | 'retired';
export type LeafTone = 'secondary' | 'outline' | 'destructive';

export const LEAF_STATUS_LABEL: Record<LeafStatus, string> = {
  pinned: 'Pinned', pending: 'Pending approval', missing: 'Missing', failing: 'Failing', stale: 'Stale', unreleased: 'Unreleased',
  active: 'Active', draft: 'Draft', retired: 'Retired',
};

export const LEAF_STATUS_TONE: Record<LeafStatus, LeafTone> = {
  pinned: 'secondary', active: 'secondary',
  pending: 'outline', unreleased: 'outline', stale: 'outline', draft: 'outline',
  missing: 'destructive', failing: 'destructive', retired: 'destructive',
};

/** Badge text for options waiting on the owner's approval. */
export const pendingOptionsBadge = (count: number) => count === 1 ? '1 option pending' : `${count} options pending`;

/**
 * The specimen description for a leaf, following its status: a pending leaf has no pin, so its
 * preview shows the newest recorded option; every other leaf previews its pinned version.
 */
export function specimenDescription(status: LeafStatus): string {
  if (status === 'pending') return 'This leaf is not pinned yet. The preview shows the newest option, installed and bound the way the site renders it.';
  if (status === 'missing') return 'This leaf has no recorded version yet, so there is nothing to preview.';
  return 'The pinned version, installed and bound the way the site renders it.';
}
