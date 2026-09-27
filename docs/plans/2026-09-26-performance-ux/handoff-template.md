# Task handoff template

Create a task-specific handoff under `docs/plans/2026-09-26-performance-ux/handoffs/<TASK-ID>.md` during authorized execution. The coordinator updates the central tracker. Do not create a handoff that claims implementation during the planning phase.

## Identity

- Task ID/title:
- Owner and checkout/branch (if any):
- Baseline revision and relevant existing changes:
- Dependencies integrated:
- Status: in progress / review / blocked / done candidate

## Scope and result

- User-visible outcome:
- Files changed:
- Exact coordinator/other-owner wiring requested, if any:
- Contract changes requested (none by default):

## Verification

- Regression test and evidence of its initial failure:
- Exact commands and final results:
- Runtime fixture, observed behavior, and screenshots/traces when relevant:
- Performance samples and environment when required:
- Untested behavior/platforms:

## Review

- Acceptance checklist: each item passed or explicitly outstanding:
- Spec review result:
- Code-quality/regression review result:
- Follow-up work or blocker, with precise owner/action:
- Shared dependency/build/native-module state left for the next task:

Commits are authorized for assigned work. Do not push to origin/main, release, or externally publish without user permission. A service without required UI/IPC wiring, or a test that has not actually run, is not done.
