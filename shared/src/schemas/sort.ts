/**
 * Sorting directions, shared by every list route.
 *
 * The sort *fields* differ per resource, the direction never does — and the
 * cursor of a paged list carries both, so one definition keeps encoder and
 * decoder from drifting apart.
 */

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];
