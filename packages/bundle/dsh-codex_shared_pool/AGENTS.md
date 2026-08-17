# dsh-codex_shared_pool development instructions

## Instruction scope

This file defines the project-specific rules for the Codex project rooted at `packages/bundle/dsh-codex_shared_pool`. It supplements the repository-root `AGENTS.md`, `packages/AGENTS.md`, and any more specific `AGENTS.md` that applies to a touched internal package. Follow all applicable instructions; the closest file governs only when rules genuinely conflict.

Keep this file named exactly `AGENTS.md`. Do not create `agent.md`, `agents.md`, or a separate copy of the repository-wide instructions. Codex loads the parent instructions automatically, while this file owns only the rules specific to this plugin project.

## One product and one source of truth

`dsh-codex_shared_pool` is the single public project and installation boundary for the DSH Codex integration. Do not create another repository, bundle, public plugin, or copied implementation for the same product.

The implementation may span these internal packages in the same `deepseek-harness` repository:

- `packages/bundle/dsh-codex_shared_pool`: public bundle, Host and browser entries, composition, project documentation, and project-level tests.
- `packages/host/codex-quota`: local official Codex app-server access and credential-safe host behavior.
- `packages/api/remotes`: typed browser Remote fields and transport contract.

These internal packages are parts of one product, not independent Codex plugins. New Codex account-pool capabilities must be installed through this bundle, even when their implementation belongs in one of the internal packages.

## Start every task with evidence

Before editing, inspect the current branch, `git status --short`, the relevant diffs, and `git worktree list`. Read the nearest instructions for every path that the task may touch. Identify the smallest implementation area and focused checks before widening the task.

The parent repository is often dirty. Treat all existing changes as user-owned. Do not assume that an uncommitted file belongs to the current task merely because it is inside this plugin's implementation area.

## Local and worktree policy

After the current baseline commit, every new task for this project starts in a Codex-managed worktree. Do not make product changes directly on `main` or `master`.

Use Local only to validate or hand off work that depends on the user's currently running desktop application, service, credentials, IDE state, or another local environment that cannot safely run twice. If validation reveals that code must change, return the task to its managed worktree before editing. Use Codex Handoff when a task needs to move between its managed worktree and Local.

Use a Codex-managed worktree for an independent task that should run in parallel or remain isolated from foreground work. A worktree checks out the entire `deepseek-harness` repository; the allowed product scope remains the bundle and its internal packages listed above.

Apply these rules to every worktree task:

- One independent task uses one Codex task and one worktree.
- Select the intended starting branch and review the change set that Codex carries into the managed worktree before editing.
- Keep the managed worktree on detached `HEAD` unless a durable branch is actually needed.
- If a branch is needed, use `codex/dsh-codex-<short-task>` unless the user provides a name. Never check out the same branch in two worktrees.
- Hand the task back to Local when validation requires the user's existing app instance, service, credentials, or IDE state.
- Report the worktree path, branch or detached state, remaining changes, and validation result at handoff.

Do not create a manual command-line worktree unless the user explicitly requests it. Unlike a Codex-managed worktree, a manual `git worktree add` starts from a Git commit and does not automatically carry the Local checkout's uncommitted changes. If a manual worktree is authorized, start it from an explicit reviewed ref and move any required uncommitted changes only through a visible, reviewed patch or commit.

Do not remove a worktree, delete a branch, rebase, merge, or force-push as cleanup unless the user explicitly requests that operation. Never delete a worktree that contains uncommitted changes.

## Git and editing safety

Preserve unrelated work. Never use `git stash`, `git reset`, `git clean`, `git checkout --`, `git restore`, or an equivalent command to hide or discard user changes. If a relevant file contains unrelated edits, inspect its diff and apply the narrowest possible patch.

Do not use broad staging such as `git add -A` or `git add .`. Stage only reviewed paths when the user has asked for a commit. Do not commit, push, open a pull request, or change branch history unless the user asks for that action.

Do not add an external production dependency without explaining the current need and obtaining user agreement. Never commit tokens, Codex authentication material, `.env` contents, account data, or machine-specific paths.

## Product invariants

The host is the only owner of Codex credentials and official app-server access. Browser Remotes and UI code may receive typed, minimum-necessary quota or account-pool data, but must never receive raw tokens, authentication files, `CODEX_HOME` contents, or arbitrary filesystem access.

Plugin activation must not remain pending forever while waiting for `remote.codexQuota`. The provider must either become ready within a bounded startup path or expose a stable, actionable unavailable state that lets the rest of the application finish loading.

The browser UI is a read-only view unless a later task explicitly defines and secures a mutation flow. Loading, ready, empty, unavailable, and recoverable-error states must be distinguishable and tested.

Service lifecycle management may be added behind this same plugin boundary. Start, stop, restart, and status must have one owner. A successful stop must disable automatic restart; automatic recovery is permitted only after an unexpected crash, not after an intentional stop.

## Implementation workflow

Keep transport, UI, host process, and bundle composition concerns in their owning internal packages. Change the Remote contract and both producer and consumer together when fields or availability semantics change. Prefer typed discriminated states over implicit `undefined`, indefinite promises, or UI guesses.

Add or update the smallest test that demonstrates changed behavior. Product-visible behavior also follows the repository requirement for a real-composition test. Update affected English and Chinese READMEs, their i18n records, and public JSDoc in the same change.

Run focused checks first from the `deepseek-harness` repository root:

```sh
pnpm exec vitest run packages/bundle/dsh-codex_shared_pool/tests
pnpm exec tsc -b packages/bundle/dsh-codex_shared_pool
pnpm run verify-translation-pairing packages/bundle/dsh-codex_shared_pool/README.md
```

When an internal package changes, also run its focused tests and TypeScript build. Relevant test directories are `packages/host/codex-quota/tests` and `packages/api/remotes/tests`. Do not default to the full repository suite; widen checks only when the changed behavior crosses a broader composition boundary or focused evidence is insufficient.

## Handoff requirements

At the end of each task, report the user-visible result, files changed, checks actually run, failures or unverified risks, and the exact Git/worktree state. Leave unrelated changes untouched. Never describe a task as complete when required behavior is still represented only by a placeholder, an indefinitely pending service, or an untested lifecycle assumption.
