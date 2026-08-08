# WORKFLOW.md

## Default Development Workflow

For any meaningful feature, Claude should follow this order.

### 1. Understand

Read the request and inspect relevant repository code.

Determine:
- What the user wants to experience
- What code currently exists
- What constraints already exist

### 2. Brainstorm

Before coding, consider 2-4 realistic approaches when there is an architectural or product choice.

Do not brainstorm for tiny fixes.

### 3. Decide

Choose the smallest approach that:
- produces the intended experience
- is technically sound
- does not block obvious future needs

Explain the tradeoff briefly.

### 4. Plan

Create a short implementation sequence with concrete files/components when known.

### 5. Implement

Make focused changes.

Avoid unrelated refactors.

### 6. Validate

Run relevant checks.

At minimum for significant frontend work:
- typecheck
- build
- lint if available

For emulator/input work, also validate the actual browser interaction as far as the environment allows.

### 7. Report

Summarize:
- what changed
- important technical decision
- anything that remains unverified
- next useful step

## Feature Gate

Do not build a second-order feature while the core game-play loop is broken.

Priority order:
1. Game loads
2. Game runs correctly
3. Keyboard works
4. Controller works
5. Fullscreen/reset/audio work
6. Library feels polished
7. Secondary product features
