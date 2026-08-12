/**
 * The home is a ranked list of shelves, not a layout.
 *
 * This is the one decision that keeps the catalog from becoming permanent. If
 * the home were written as *ask, Continue, Your games, then the big grid*, the
 * catalog's prominence would live in the markup — and when generated play grows
 * it would have to be rebuilt, reluctantly, because it works.
 *
 * Instead each shelf says when it applies and how strongly it wants the top,
 * given state. On a first visit the catalog leads because nothing else applies,
 * which is correct and is a *consequence* rather than a decision cast in
 * layout. Later, with games of your own and one being made, it recedes on its
 * own.
 *
 * The ask is deliberately not a shelf. It is the entry to the loop, it belongs
 * everywhere, and it should never compete for position with content.
 */

export type ShelfId = 'making' | 'continue' | 'yours' | 'library';

export interface ShelfState {
  /** A build is in flight. */
  building: number;
  /** Games this device has generated. */
  yours: number;
  /** Games this device has played. */
  played: number;
}

export interface Shelf {
  id: ShelfId;
  /** Rendered at all. Absent shelves take no space and show no empty state. */
  applies(state: ShelfState): boolean;
  /** Higher wants the top. Read the numbers as an argument, not a constant. */
  weight(state: ShelfState): number;
}

export const SHELVES: Shelf[] = [
  {
    // The loop in progress always leads: it is the thing the person just did,
    // and it is how they get pulled back when it is ready.
    id: 'making',
    applies: (state) => state.building > 0,
    weight: () => 100,
  },
  {
    // Resuming beats discovering, which is why ContinueShelf already sits above
    // search. It loses to a game being made because that is more recent still.
    id: 'continue',
    applies: (state) => state.played > 0,
    weight: () => 80,
  },
  {
    // Your own games outrank the catalog as soon as any exist. This is the line
    // that lets the product become generative-first without a redesign.
    id: 'yours',
    applies: (state) => state.yours > 0,
    weight: (state) => 60 + Math.min(state.yours, 5) * 4,
  },
  {
    // Always present, and top on a first visit because nothing else applies.
    // Its position is earned by the state of everything above it.
    id: 'library',
    applies: () => true,
    weight: () => 50,
  },
];

export function orderShelves(state: ShelfState): ShelfId[] {
  return SHELVES.filter((shelf) => shelf.applies(state))
    .sort((a, b) => b.weight(state) - a.weight(state))
    .map((shelf) => shelf.id);
}
