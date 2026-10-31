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
