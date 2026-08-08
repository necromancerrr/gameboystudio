# SKILLS.md

This file describes the thinking and implementation skills Claude should apply while working on GameBoyStudio.

## 1. Product Thinking

Before building a substantial feature, identify:
- User goal
- User-visible behavior
- MVP requirement
- Optional enhancement
- Failure states
- What should explicitly not be built yet

Prefer solving the user experience over maximizing feature count.

## 2. Brainstorming

For non-trivial decisions, generate 2-4 realistic approaches.

Each approach should include:
- What it is
- Why it could work
- Main weakness
- Complexity
- Whether it fits the current MVP

End with a recommendation.

Do not brainstorm ten superficial ideas when three serious choices would be more useful.

## 3. Repository Reconnaissance

Before modifying unfamiliar code:
- Inspect package.json
- Inspect app/router structure
- Inspect existing components
- Inspect styling conventions
- Inspect tsconfig and linting
- Search for existing emulator/gamepad code
- Identify where game data lives
- Run existing tests or builds when practical

Reuse existing patterns instead of creating parallel systems.

## 4. Emulator Integration

When integrating an emulator:
- Verify the library is actually browser-compatible.
- Verify its license.
- Verify how it loads ROM bytes.
- Verify lifecycle methods.
- Verify audio requirements.
- Verify input mapping.
- Wrap imperative emulator APIs away from React rendering logic.
- Destroy emulator instances on unmount.

Keep product UI independent from the emulator core.

## 5. Browser Input Engineering

For keyboard input:
- Prevent default behavior only when gameplay has focus.
- Handle keydown and keyup.
- Prevent stuck-key states when focus changes.

For Gamepad API:
- Detect connection/disconnection.
- Poll with requestAnimationFrame while the game is active.
- Support axes with dead zones.
- Support D-pad buttons.
- Map face buttons to Game Boy A/B by physical position, not by printed label.
- Normalize controller input before handing it to the emulator.
- Stop polling when gameplay is not active.

## 6. Frontend Product Design

Favor:
- Strong game artwork
- Clear hierarchy
- Large playable viewport
- Minimal navigation
- Responsive layout
- Fast transitions
- Simple controls

Avoid:
- Dashboard clutter
- Visual gimmicks that reduce readability
- Too many borders/cards
- Retro styling applied to every element

## 7. Game Catalog Design

Build catalog data so it can eventually support multiple consoles without overengineering.

Useful separations:
- Game metadata
- ROM/source metadata
- Console metadata
- Control profile

Do not put emulator implementation details directly into presentation components.

## 8. Debugging

When a game fails to run, isolate the layer:
1. ROM/file request
2. ROM format
3. Emulator initialization
4. Canvas/rendering
5. Audio permissions
6. Input mapping
7. React lifecycle
8. Browser compatibility

Report the actual failing layer instead of randomly changing code.

## 9. Validation

After meaningful changes:
- Typecheck
- Lint if configured
- Build
- Run relevant tests
- Exercise the main path manually where possible

A visually complete page is not finished if the game cannot actually run.

## 10. Documentation

Document decisions that future work depends on:
- Emulator choice
- ROM loading conventions
- Game schema
- Input normalization
- Console adapter design

Do not document obvious code line-by-line.
