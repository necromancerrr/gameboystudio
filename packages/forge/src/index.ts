/**
 * The loop as a library.
 *
 * Deliberately a library with a CLI over it, rather than a CLI with logic
 * inside it: user-facing generation is where this is going, and a future UI
 * should drive these same calls rather than shell out.
 */
export * from './project.js';
export * from './pointer.js';
export * from './view.js';
export * from './spec.js';
export * from './generator.js';
export * from './loop.js';
export { synthesize } from './synthesize.js';
