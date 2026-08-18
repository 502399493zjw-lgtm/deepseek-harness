# dsh-codex_shared_pool development instructions

## Scope and ownership

This file supplements the root, package, and any closer `AGENTS.md`. Keep only project-specific rules here; do not copy inherited rules or create another instruction file.

`dsh-codex_shared_pool` is the DSH Codex integration's single public installation boundary. Its implementation has three owners:

- `packages/bundle/dsh-codex_shared_pool`: bundle composition, Host and browser entries, project documentation, and project-level tests.
- `packages/host/codex-quota`: official Codex app-server access and credential-safe Host behavior.
- `packages/api/remotes`: typed browser Remote fields and transport behavior.

Do not create a second repository, bundle, public plugin, or copied implementation. Install new account-pool capabilities through this bundle even when an internal package owns the code.

## Delivery states

Follow the [recorded workflow decision](../../../.agents/notes/implemented/process/2026-08-18-codex-shared-pool-development-flow.md). Keep these evidence fields distinct and report every applicable one:

1. **Code complete** — scoped implementation and focused local evidence exist on a named task branch.
2. **GitHub integrated** — the reviewed pull request is merged into its stated target repository and base. A fork merge is not an upstream merge.
3. **Locally applied** — the intended DSH installation or source-linked profile runs the merged artifacts and has been restarted and validated.
4. **Artifacts ready** — the matching DSH release-family tarballs were built and verified from one release candidate.
5. **Published** — the protected release workflow uploaded the tagged DSH family, registry state was verified, and consumers can upgrade.

The fields are not one automatic ladder: branch artifacts may be tested before merge, and a published version may remain unapplied on a particular machine. A merge changes Git history only. It does not rebuild or restart a running DSH process, update a profile dependency, create a release artifact, or publish npm packages.

## Development and GitHub operations

1. Inspect the branch, `git status --short`, relevant diffs, current pull request, intended repository and base, and `git worktree list`. Read the nearest instructions and identify the smallest owning package and focused evidence.
2. Continue the current named task branch when it belongs to the request and has no conflicting work. Use a named branch in an isolated Codex-managed worktree when another task owns the checkout, unrelated changes obstruct work, parallel execution requires it, or the user requests isolation. Detached `HEAD` is not a durable development or handoff state.
3. Implement the smallest coherent change. Keep UI, transport, Host process, and composition behavior with their owners. Change Remote types, producer, and consumer together. Add the smallest tests and documentation required by inherited repository policy.
4. Run focused checks while developing. Before push, inspect the complete diff and use `dsh-pre-push-checks` to select relevant evidence.
5. Commit only reviewed task paths, push the named branch, create or update its pull request, and inspect CI for the exact pushed head. Present the reviewed pull request and obtain explicit user confirmation before merge.

An implementation request authorizes scoped edits, a task branch, commits, pushes, pull-request creation or updates, and CI investigation. It does not authorize merge, destructive history changes, branch or worktree deletion, local application, tagging, or publication.

## Local application

Apply a merged change only when the user requests updating the local DSH instance. Development-time tests or a branch preview remain code-complete evidence; they do not mean the stable local instance was updated. For a source-linked profile, update the linked source checkout to the intended merged commit, run `pnpm install` when manifests or the lockfile changed, run `pnpm run build`, restart DSH, refresh the browser, and validate the affected flow. The production Web runner can serve stale built Host, Client, or frontend artifacts; a source link alone is not evidence that new code is running.

For an npm- or tarball-installed profile, update the profile dependency with `dsh plugin --profile <name> update <package>` or install the approved tarball, then restart DSH and validate. Do not describe Codex Desktop as this project's runtime or validation target.

## Distribution and release

Do not present a GitHub source install as a supported distribution path for this monorepo bundle: it has no standalone `prepare` build and depends on sibling workspace packages. Internal tarball sharing uses one matching DSH release-family artifact set, produced with the repository release scripts and verified as an installed set; do not hand out an unverified bundle tarball in isolation.

Public publication follows the repository's DSH release sequence: align the intended release branch with its required upstream baseline, advance the shared DSH family version, review and merge that release change, create the matching `dsh-v<version>` tag, and manually dispatch `Release (dsh)` with publication enabled. Publication requires the protected `npm-publish` environment and `NPM_TOKEN`. Verify npm after upload; consumers then update the matching package family and restart DSH. Tag creation and publication require explicit user authorization.

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

Also run focused tests and builds for each changed internal package. Pull-request CI owns exhaustive repository checks and the platform matrix; widen local checks only when requested, CI is unavailable or insufficient, reproducing a failure requires it, or the change is irreducibly repository-wide.

End each task with the applicable delivery states, user-visible result, changed files, local checks, CI for the exact head, repository/base or release artifact details, residual risks, and exact Git/worktree state. Leave unrelated work untouched.
