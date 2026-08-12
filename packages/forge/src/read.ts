/**
 * The read-only half of forge.
 *
 * Deliberately separate from the loop. Reading a project touches nothing but
 * the filesystem, while *running* one needs esbuild, npm and a browser — so an
 * app that only wants to know how a game is doing should not have to carry a
 * bundler into its own build. Generation is a job and runs as a process; this
 * is what the app imports.
 */
export * from './project.js';
export * from './pointer.js';
export * from './view.js';
