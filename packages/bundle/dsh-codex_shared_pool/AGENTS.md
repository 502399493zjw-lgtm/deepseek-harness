# dsh-codex_shared_pool development instructions

## Scope and ownership

This file supplements the root, package, and any closer `AGENTS.md`. Keep only project-specific rules here; do not copy inherited rules or create another instruction file.

`dsh-codex_shared_pool` is the DSH Codex integration's single public installation boundary. Its implementation has three owners:

- `packages/bundle/dsh-codex_shared_pool`: bundle composition, Host and browser entries, project documentation, and project-level tests.
- `packages/host/codex-quota`: official Codex app-server access and credential-safe Host behavior.
- `packages/api/remotes`: typed browser Remote fields and transport behavior.

Do not create a second repository, bundle, public plugin, or copied implementation. Install new account-pool capabilities through this bundle even when an internal package owns the code.

## Development flow

Follow the [recorded workflow decision](../../../.agents/notes/implemented/process/2026-08-18-codex-shared-pool-development-flow.md).

1. Inspect the branch, `git status --short`, relevant diffs, current pull request, intended base, and `git worktree list`. Read the nearest instructions and identify the smallest owning package and focused evidence.
2. Continue the current named task branch when it belongs to the request and has no conflicting work. Create a named task branch and isolated Codex-managed worktree when the checkout belongs to another pull request, unrelated changes obstruct the task, parallel work requires it, or the user requests isolation. Do not use detached `HEAD` as a durable development or handoff state.
3. Implement the smallest coherent change. Keep UI, transport, Host process, and composition behavior with their owners. Change Remote types, producer, and consumer together. Add the smallest tests and documentation required by inherited repository policy.
4. Run focused checks while developing. Before push, inspect the complete diff and use `dsh-pre-push-checks` to select relevant evidence.
5. Commit the reviewed task paths, push the named branch, create or update its pull request, and inspect CI for the pushed head. Report local checks separately from remote CI.
6. Present the reviewed pull request and obtain explicit user confirmation before merge.

An implementation request authorizes scoped edits, a task branch, commits, pushes, pull-request creation or updates, and CI investigation. It does not authorize merging, destructive history changes, deleting branches or worktrees, or deploying. Preserve unrelated work.

## Product invariants

- The Host alone owns Codex credentials and official app-server access. Browser code receives only typed, minimum-necessary account and quota data, never tokens, authentication files, `CODEX_HOME` contents, or arbitrary filesystem access.
- Plugin activation completes through a bounded ready or actionable unavailable state; it never waits indefinitely for `remote.codexQuota`.
- The browser UI remains read-only unless a task explicitly defines and secures a mutation flow. Loading, ready, empty, unavailable, and recoverable-error states remain distinguishable and tested.
- Prefer typed discriminated states over implicit `undefined`, unresolved promises, or UI inference.

## Verification and handoff

Run relevant focused checks from the repository root; common bundle checks are:

```sh
pnpm exec vitest run packages/bundle/dsh-codex_shared_pool/tests
pnpm exec tsc -b packages/bundle/dsh-codex_shared_pool
pnpm run verify-translation-pairing packages/bundle/dsh-codex_shared_pool/README.md
```

Also run focused tests and builds for each changed internal package. Pull-request CI is the authority for exhaustive repository checks and the platform matrix. Run a full local suite only when the user requests it, CI is unavailable, reproducing a CI failure requires it, the affected behavior lacks CI coverage, or the change is irreducibly repository-wide.

Use Local validation only when the user's running desktop application, credentials, service, or IDE state is required. Commit the candidate on its named task branch before handoff; return discovered fixes to that same branch.

End an implementation task with the user-visible result, changed files, local checks, CI status for the exact head, pull-request/base details, residual risks, and Git/worktree state. A local-only patch is complete only when the user explicitly requested one.
