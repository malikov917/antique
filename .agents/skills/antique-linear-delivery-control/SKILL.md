---
name: antique-linear-delivery-control
description: Orchestrate implementation delivery using Linear as source of truth, including issue updates and completion gates.
---

# Antique Linear Delivery Control

## Use When
- A coding task is requested in this repository.
- Progress must be tracked in Linear with visible updates.

## Required Workflow
1. Find or create a Linear issue for the change.
2. Move issue to `In Progress` when coding starts.
3. Post daily progress comments using:
   - `Status:`
   - `What changed today:`
   - `Blockers:`
   - `Next action:`
   - `ETA:`
4. Before moving to `In Review`, run:
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test`
5. Post a final comment with verification summary and changed files.

