# Agent Note: Codex shared pool development and delivery flow

Status: implemented

English | [中文](2026-08-18-codex-shared-pool-development-flow.zh.md)

## Problem

The project originally combined isolation mechanics with delivery policy: every task started in a managed worktree, preferred detached `HEAD`, and withheld commits, pushes, and pull requests unless each action was separately requested. A completed implementation could remain as uncommitted files in an anonymous worktree without a stable review unit or remote verification.

The replacement workflow stopped at pull-request merge and called later activity deployment. That still hid several independent outcomes. A merge updates Git history but does not rebuild a source checkout, replace a running DSH process, update an installed profile dependency, produce verified tarballs, or publish npm packages. It also described validation against a live desktop application even though this bundle runs inside DSH; Codex Desktop is not its application host.

## Decision

### One durable development unit

A named task branch and its pull request are the durable unit of development. Worktrees provide conditional isolation when the current checkout belongs to other work, contains obstructing unrelated changes, must support parallel execution, or the user requests isolation. Detached `HEAD` is not a durable development or handoff state.

An implementation request authorizes scoped edits, branch creation, reviewed commits, pushes, pull-request creation or updates, and CI investigation. Focused local evidence is reported separately from CI for the exact pushed head. Pull-request CI owns exhaustive checks and platform coverage; full local suites are reserved for explicit requests, unavailable or insufficient CI, failure reproduction, and irreducibly repository-wide changes.

### Five delivery states

Every handoff records each applicable state:

| State | Required evidence |
|---|---|
| Code complete | The scoped change and focused local checks exist on a named task branch. |
| GitHub integrated | The reviewed pull request is merged into its explicitly named target repository and base. |
| Locally applied | The intended DSH installation or source-linked profile runs rebuilt merged artifacts after restart, and the affected flow was validated. |
| Artifacts ready | One matching DSH release-family tarball set was built and passed the packed-install verification. |
| Published | The tagged release family was uploaded by the protected workflow, registry state was verified, and consumers can upgrade. |

These are independent evidence fields, not one automatic ladder. Pull-request CI may verify artifacts before merge, and a published version can remain unapplied on a particular machine. Merging into a personal fork does not merge upstream. Merging into any repository does not apply the result locally or publish it.

### Local application

A locally running DSH instance is updated only under an explicit local-application request. Development-time tests or a branch preview remain evidence for code completion and do not claim that the stable local instance was updated. For a source-linked profile, the operator updates the linked checkout to the intended merged commit, installs dependencies when manifests or the lockfile changed, runs `pnpm run build`, restarts DSH, refreshes the browser, and validates the affected behavior. The source launcher deliberately does not rebuild, and stale Host, Client, or frontend artifacts can continue to run; this follows [source run without a managed installer](../simplification/2026-08-10-source-run-without-managed-installer.md) and the [CLI source-execution reference](../../../../apps/cli/reference/README.md#source-execution).

For an npm- or tarball-installed profile, the operator updates the profile dependency through `dsh plugin`, or installs the approved tarball, then restarts DSH and validates. A successful Git operation is never evidence that either runtime path changed.

### Distribution

Git-hosted installation is not a supported distribution route for this bundle. A git dependency receives source and needs a self-contained `prepare` script, while this package has no such script and depends on sibling monorepo packages.

An internally shared release candidate is the complete matching DSH release-family tarball set, not an isolated bundle tarball. The repository builds the family, packs it with `pnpm run release:pack --family dsh`, and verifies installation of the resulting set. This preserves the single shared version and workspace dependency ranges.

Public publication follows [private npm publication as three independent sequences](2026-08-10-npm-release-sequences.md). The release owner aligns the release branch with its required upstream baseline, advances the shared DSH family version, lands the reviewed release change, creates `dsh-v<version>`, and manually dispatches `Release (dsh)` with publication enabled from that tag. The protected `npm-publish` environment and `NPM_TOKEN` authorize the upload. The workflow publishes the already verified artifact bytes; registry verification follows, then consumers update the matching package family and restart DSH.

### Authority checkpoints

Merge, destructive history changes, branch or worktree deletion, local application, release-version changes, tag creation, and publication are separate authorized operations. Green checks do not authorize any of them. In particular, merging cannot silently trigger a restart or registry write.

## Alternatives considered

**Use a managed worktree for every task.** Uniform isolation adds machinery when a clean task branch is sufficient and does not itself produce a reviewable result.

**Treat pull-request merge as completion for every request.** This is correct only when the requested outcome is source integration. It loses the required rebuild, restart, artifact, and registry evidence for local-update or release requests.

**Automatically update the local instance or publish after merge.** This makes a GitHub decision mutate a running service or shared registry without a distinct scope and recovery checkpoint.

**Distribute the GitHub repository directly.** The monorepo package cannot build as a self-contained git dependency, and profile installation would receive missing workspace artifacts.

**Share only the bundle tarball.** The DSH packages are one release family with matching versions and internal dependency ranges; one unchecked tarball does not prove that consumers can resolve and run the set.

**Run the full repository suite before every push.** This duplicates CI, delays feedback, and obscures focused evidence for the changed behavior.

## Consequences

Implementation tasks normally end with a reviewed pull request and known CI state, awaiting explicit merge confirmation. A requested local rollout continues through rebuild, restart, and behavior validation. A requested release continues through verified family artifacts or protected publication, depending on scope.

Handoffs can no longer say only “complete” or “merged.” They identify the repository and base, each applicable delivery state, exact checks or artifact verification, and remaining operations. Codex Desktop is excluded from the development loop unless a future product requirement explicitly introduces an integration with it.
