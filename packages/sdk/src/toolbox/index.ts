/**
 * The GameBoyStudio toolbox.
 *
 * Primitives a game may call. Not a format, not an engine, not a framework —
 * D-023 draws that line and makes it a gate rather than a guideline: **nothing
 * belongs here that has not already been written twice in a shipped game.**
 *
 * Everything below earned its place by having been reimplemented, slightly
 * differently each time, in Drift, Ring Out and Sequence:
 *
 *   phase machine with a timer      3 / 3 games
 *   elapsed time accumulated from dt 3 / 3
 *   text and rectangle drawing      3 / 3
 *   versioned save of a best score  3 / 3
 *   randomness                      3 / 3
 *
 * That list is the whole justification. Anticipating what a generator "will
 * probably want" is how a toolbox quietly becomes an engine, so a new primitive
 * needs a game that already needed it.
 *
 * Note what is absent: nothing here says what a game *is*. There are no
 * entities, scenes, collisions or rules. That absence is deliberate — it is the
 * difference between this and the declarative format D-018 is still waiting on
 * evidence for.
 */

export * from './phases.js';
export * from './draw.js';
export * from './save.js';
export * from './random.js';
