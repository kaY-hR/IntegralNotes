---
name: codebase-review
description: Scan existing source code for bloated design, weak logic, architectural drift, maintainability risks, and high-value refactoring targets. Use when asked to review a codebase or module beyond a normal PR diff, especially for oversized files/components, tangled responsibilities, fragile async/data flow, duplicated logic, unclear boundaries, or concerns that the design or logic feels weak.
---

# Codebase Review

Perform a read-only, findings-first review of existing code. Prefer concrete, actionable findings over broad style advice.

## Scope

- Use the user's requested scope. If unspecified, inspect `src/**` first.
- Read repository guidance before judging design. In IntegralNotes, read `AGENTS.md`, recent history docs under `docs/00_*`, and requirement docs under `docs/10_*` when relevant.
- Do not use unrelated MCPs. In this repository, `integral-analysis` is unrelated.
- Do not edit files unless the user explicitly asks for fixes.

## Workflow

1. Build a lightweight map before reading deeply.
   - Run `rg --files` for the target scope.
   - Check `git status --short` so user changes are not mistaken for baseline.
   - Identify entrypoints, large files, shared services, IPC/API boundaries, tests, and recently changed areas.

2. Sample strategically, then follow evidence.
   - Start with files that coordinate many concerns or are unusually large.
   - Trace key flows across boundaries instead of reading files in isolation.
   - Use `rg` to find duplicate logic, repeated state transitions, event names, schema keys, file paths, and error handling patterns.

3. Judge issues by impact, not taste.
   - Flag only issues with a plausible maintenance, correctness, performance, reliability, or testability consequence.
   - Prefer findings that the code owner could act on this cycle.
   - Separate existing design debt from bugs. Existing debt can be valid, but it needs evidence and a small next step.

4. Challenge design assumptions.
   - Ask whether responsibilities are in the right layer.
   - Look for hidden coupling, lifecycle gaps, race windows, stringly typed contracts, ad hoc schema handling, and state that can diverge.
   - Consider a simpler design, but avoid recommending a rewrite unless the current shape blocks incremental repair.

## Review Axes

Prioritize these signals:

- Oversized modules that mix UI, persistence, domain rules, IPC, and side effects.
- Functions that both decide policy and perform irreversible actions.
- Shared state updated from multiple async paths without ordering, cancellation, or ownership.
- Duplicate implementations that can diverge under future changes.
- String parsing or path manipulation where a structured API or schema already exists.
- Error handling that hides partial failure, cleanup failure, or stale state.
- Data models with unclear source of truth, especially IDs, paths, hashes, and lifecycle states.
- Boundaries that leak implementation details, such as renderer code knowing main-process storage layout.
- Tests that miss the risky part of the behavior rather than merely being absent.

For Electron/React code, also check:

- Main/renderer IPC contract shape, validation, and failure behavior.
- Cleanup of listeners, timers, streams, subscriptions, and editor plugins.
- React components carrying workflow orchestration that belongs in a service or hook.
- UI state that can become inconsistent with persisted note/workspace state.

## Official Baseline

Use the OpenAI Codex review guidance as a baseline principle, not as copied text: findings should be important, discrete, actionable, evidence-backed, and prioritized. For whole-codebase design review, relax the PR-specific "introduced in this commit" rule, but make pre-existing debt explicit.

The OpenAI Codex plugin's adversarial-review framing is also useful: pressure-test tradeoffs, hidden assumptions, failure modes, and whether a simpler approach would be safer.

## Output

Return findings first, ordered by severity.

Match the user's language. Use this shape:

- `High | <category>`: concise title. Evidence: `<file references>`. Impact: `<why it matters>`. Recommendation: `<smallest useful next step>`. Confidence: `<high/medium/low>`.
- `Medium | <category>`: same structure.
- `Low | <category>`: same structure.

After findings, include:

- `Scanned`: the directories/files or flows actually inspected.
- `Hotspots`: large or risky files worth revisiting even if not every concern became a finding.
- `Test gaps`: focused tests or checks that would reduce risk.

If there are no high-signal findings, say so directly and state the scanned scope and remaining uncertainty.
