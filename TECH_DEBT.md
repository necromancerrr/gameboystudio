# TECH_DEBT.md

Known problems that are real, are not any milestone's fault, and are worth
fixing on their own. Each entry says what is broken, what has been ruled out,
and what would count as fixed — so the next person starts from the evidence
rather than from scratch.

---

## TD-001: `verify:browser` kills the browser part-way through

**Status:** open. Surfaced during M5, reproduced on clean `main` during M6.

### What happens

The browser suite reliably kills Chrome at:

```
a run can be lost and restarted with the keyboard
```

The next DevTools call — `Runtime.evaluate`, `Input.dispatchKeyEvent` or
`Page.navigate`, it varies — never answers. The circuit breaker added in M5 then
abandons the run and reports which check lost the browser, so a typical result
is **7 passing and 27 never run**.

The check itself holds the `x` key for four seconds while Drift flies out of the
field, then reads the canvas.

### What has been ruled out

- **Not an M6 regression.** Reproduced on a clean worktree of `main` at
  `d2ae833`, with no SDK extraction present, same check, same death.
- **Not overlapping harness runs.** The debug-port guard refuses a second run,
  and it happens with a single one.
- **Not screenshots.** It happens with `GBS_NO_SHOTS=1`.
- **Not simple memory pressure.** It happened at ~1.2GB free, though it is
  markedly worse when free memory is low.
- **Not the usual CI Chrome flags.** `--disable-dev-shm-usage`,
  `--disable-renderer-backgrounding` and friends were tried and made it
  *dramatically* worse — a run went from four failures to thirty. They were
  reverted, with a comment in the harness so it is not retried.

### What is known to help

- `Page.bringToFront` on navigation. Before it, `document.hidden` was true for
  the whole run and `requestAnimationFrame` was throttled to nothing, which made
  several checks fail for reasons unrelated to the code. This fixed the Drift
  core-collection check that had been written off as flaky.
- `GBS_NO_SHOTS=1`. One full run has completed this way: **39 pass, 1 fail**.

### Worth trying next

- Whether the four-second key hold is the trigger, by shortening it or breaking
  it into taps. It is the longest continuous input in the suite.
- Whether `Target.setAutoAttach` (added in M5 to reach sandboxed frames)
  contributes. It flattens every attached target onto one socket; the pending
  map is keyed by session and id, but the event volume is unmeasured.
- Chrome's own stderr, which the harness currently discards with `stdio: 'ignore'`.

### Fixed when

`npm run verify:browser` completes on this machine, repeatedly, with the only
failure being a real one.

---

## TD-002: `keyboard input changes what a Game Boy game draws` fails

**Status:** open. Present on `main` since before M4.

The keydown reaches the document (verified — the event arrives with the right
`code`), the page is visible and focused, and the emulator *is* drawing: the
adjacent check `a Game Boy game keeps drawing, not just its first frame` passes
immediately before it. The screen still does not change.

Retro input is proven working elsewhere — `verify:catalog` asserts START changes
the screen at the adapter level, and the touch-deck check drives a retro game
through the full input path — so this is narrow rather than "retro input is
broken". It became visible when the browser harness was given macOS Chrome
paths; before that it silently skipped, which read as a pass and was not one.

**Fixed when** the check passes, or is replaced by one that can fail for a
reason we understand.

## TD-003: `verify` failed on its own output, and on committed build output

Status: Fixed 2026-08-12

`npm run verify` starts with `npm run lint`, and lint had no ignore for
`.test-build/` — the harness output an earlier verify run leaves behind. So the
suite passed once on a clean tree and failed on the second run, on files it had
generated itself.

Separately, `packages/sdk/src/index.js` and `protocol.js` were committed in M6:
CommonJS output emitted next to the TypeScript it came from. The package ships
only `dist` (`files`), so they were unused, and their `require()` calls were two
hard lint errors. Together these meant `npm run verify` could not reach its
first check on `main`.

Both are fixed here: `.test-build/` and `.forge/` are ignored by eslint, and the
two stray files are deleted. The lesson is the one D-012 keeps teaching — a
check that cannot run is not a check that passes, and "lint is green" was true
only of a tree nobody had verified in.
