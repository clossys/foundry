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

/** The one count unit every Studio surface uses: a leaf is one L3 page in the Studio map. */
export const LEAF_UNIT = ['leaf', 'leaves'] as const;
export const leafCountLabel = (count: number) => `${count} ${count === 1 ? LEAF_UNIT[0] : LEAF_UNIT[1]}`;

/**
 * The specimen description for a leaf, following its status: a pending leaf has no pin, so its
 * preview shows the newest recorded option; every other leaf previews its pinned version.
 */
export function specimenDescription(status: LeafStatus): string {
  if (status === 'pending') return 'This leaf is not pinned yet. The preview shows the newest option, installed and bound the way the site renders it.';
  if (status === 'missing') return 'This leaf has no recorded version yet, so there is nothing to preview.';
  return 'The pinned version, installed and bound the way the site renders it.';
}
