# Agent Note: Codex shared pool development flow

Status: implemented

English | [中文](2026-08-18-codex-shared-pool-development-flow.zh.md)

## Problem

The project required every task to begin in a managed worktree, preferred detached `HEAD`, and withheld commits, pushes, and pull requests unless each action was separately requested. That combined isolation mechanics with delivery policy. A completed implementation could therefore remain as uncommitted files in an anonymous worktree, leaving no stable review unit, remote verification, or clear path to merge.

## Decision

A named task branch and its pull request are the durable unit of development. Worktrees provide conditional isolation when the current checkout belongs to other work, contains obstructing unrelated changes, must support parallel execution, or the user requests isolation. Detached `HEAD` is not a durable development or handoff state.

An implementation request authorizes the agent to make scoped edits, create the task branch, commit reviewed paths, push, create or update the pull request, and investigate or retry CI. The agent reports focused local evidence separately from remote CI for the exact pushed head. Pull-request CI owns exhaustive checks and platform coverage; full local suites are reserved for explicit requests, unavailable or insufficient CI, failure reproduction, and irreducibly repository-wide changes.

Merge remains a distinct user-confirmed action. Destructive history changes, branch or worktree deletion, and deployment also require separate authority. Validation that depends on the user's live desktop state occurs only after the candidate is committed and returns fixes to the same task branch.

## Alternatives considered

**Use a managed worktree for every task.** Uniform isolation is simple, but it adds machinery when a clean task branch is sufficient and does not itself produce a reviewable result.

**Keep detached worktrees until the user asks for delivery.** This avoids unsolicited remote changes, but routinely strands completed work without a stable name, commit, or CI result.

**Run the full repository suite before every push.** This duplicates CI, delays feedback, and obscures the focused evidence that corresponds to the changed behavior.

**Allow automatic merge after green CI.** A green head proves checks, not user acceptance of scope, trade-offs, or timing.

## Consequences

Implementation tasks normally finish as a reviewed commit on a named branch with a pushed pull request and known CI state, awaiting explicit merge confirmation. Worktree use becomes evidence-driven rather than ceremonial. The agent gains authority to complete the review loop, while merge and destructive operations retain a clear human checkpoint.
