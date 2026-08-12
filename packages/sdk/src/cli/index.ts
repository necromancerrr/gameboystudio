/**
 * The pieces of the toolchain a program can call.
 *
 * `gbs` is a command for people; this is the same work exposed for something
 * that drives it. Forge builds and checks generated projects through here
 * rather than shelling out or reaching into a project's node_modules, which
 * keeps the dependency honest and, incidentally, statically analysable.
 */
export { buildProject, frameHtml, type BuildResult } from './build.js';
export { readProject, manifestEntry, type GameProject } from './project.js';
export { check, runCheck, type CheckVerdict } from './check.js';
export { validateEntry, type ManifestEntryShape } from './manifestRules.js';
