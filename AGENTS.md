# Antique Agent Operating System

## Mission
Build and ship a fast, agent-driven mobile marketplace for antique video reels on iOS and Android.

## Non-Negotiable Workflow
1. Linear is the source of truth for product work.
2. Every implementation change maps to a Linear issue before code starts.
3. Branch format is `codex/<issue-key>-<short-slug>`.
4. Every PR must reference its Linear issue and include the acceptance checklist.
5. Move issue state to `In Review` after local validation passes.
6. When ticket is relatively simple move ticket into `Merge&Ship` after finished.

## Required Validation Before `In Review`
Run from repository root:
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

Attach output summary in the Linear issue comment.

## Failure Evidence Requirement
- For e2e/mobile verification failures or stalls, always capture and inspect screenshots (and related debug artifacts/logs) before reporting status.
- Include the observed on-screen error state in the issue update so blockers are diagnosis-backed, not assumption-backed.

## E2E Reliability Notes
- Always target devices explicitly in Maestro runs (`--device`) when both iOS and Android emulators may be online.
- In Expo Go flows, dismiss the tools/tutorial panel first (top-right close control) before asserting app UI elements.
- Android scripts must resolve `adb`/`emulator` via `ANDROID_SDK_ROOT` fallback, not PATH-only assumptions.
- During fix iteration, run `SKIP_CHECK=1` e2e loops after a full gate pass; keep final reporting based on a full validation run.

## Local App Run Reliability
- For iOS manual testing, boot simulator first (`xcrun simctl boot "<device>"` + `xcrun simctl bootstatus -b`) and then launch Simulator.
- Start backend and mobile dev servers in separate long-lived terminals so API and Expo logs stay visible during manual testing.
- If upload endpoints return `503` locally, verify Mux credentials are loaded from `apps/api/.env` or repository root `.env` before retrying.

## Continuous Improvement Rule
- After each finished task/job/automation, keep only 1-3 durable lessons in this file (remove stale/redundant ones).
- Prefer workflow-level learnings (tooling, validation, reproducibility) over one-off incident details.

## Skill-First Policy
- Prefer existing skills before inventing ad-hoc workflows.
- Add a new project skill only when the same workflow repeats two or more times.
- Use local skills in `.agents/skills` for:
  - delivery orchestration with Linear updates
  - reels performance and animation quality checks
  - Mux upload/webhook state transitions
  - release build and store submission gating

## Linear Update Cadence
- Update active issues at least once per working day.
- Use this comment template:
  - `Status:`
  - `What changed today:`
  - `Blockers:`
  - `Next action:`
  - `ETA:`

## Engineering Defaults
- Keep API backward-compatible for `/v1/*` unless issue explicitly allows breaking changes.
- Prefer typed interfaces in `packages/types`.
- Track performance-sensitive work with the `perf` label.
