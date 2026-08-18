# Codex Global Account Priority Implementation Plan

English | [中文](2026-08-18-codex-global-account-priority.zh.md)

> **For agentic workers:** Execute this plan inline in the detached `4f40` worktree. Use failing focused tests before implementation and leave Git history unchanged unless the user separately authorizes a commit.

**Goal:** Let a user confirm one ChatGPT account as the global first choice for Codex quota consumption while automatic allocation falls back to other accounts whose selected-model quota is not proven exhausted.

**Architecture:** The Host-owned profile document stores one ordered profile list; its first profile is the global allocation priority, so no separate active/default selector can disagree with automatic allocation. Confirmation moves the selected profile to the front through a same-origin mutation and refreshes the browser only after the Host reports the new order. Before every Codex request, the allocator scans that global order and binds or replaces the Session with the first profile whose relevant quota is not explicitly zero. A replacement closes the Session's cached provider continuation before credential resolution, so the next request sends full Harness context under one account identity. In-flight requests are never interrupted or replayed.

**Tech Stack:** TypeScript, React 18, Cordis services, pi-ai OAuth credentials, Vitest, Testing Library, Playwright assembled Web snapshots.

## Global Constraints

- Keep OAuth credentials and provider quota reads on the Host; browser responses carry only opaque profile ids and secret-free usage summaries.
- Use stored profile order as the only allocation-priority source. The first profile receives the priority marker and the first quota probe for every Session.
- Apply a changed priority at the next request boundary, including existing conversations; do not interrupt or replay an in-flight provider request.
- Switch accounts only after pre-request allocation. Close provider continuation state before the replacement credential is resolved so no continuation id crosses account identities.
- Treat only an explicit zero in the selected model's rate-limit bucket or workspace member limit as exhaustion. Missing or unreadable quota does not justify skipping an account.
- Publish the new priority in the browser only after both the mutation and refreshed ready response succeed. Failure keeps the prior order and leaves the action retryable.
- Preserve unrelated work, do not edit the independent `dsh-codex-auto-allocation` worktree, and do not commit, push, merge, rebase, or rewrite history.
- Update English and Chinese UI copy, README references, pair records, and the owning Agent Note in the same change.

---

### Task 1: Pin the global priority and allocator behavior

**Files:**

- Create: `packages/bundle/dsh-codex_shared_pool/tests/account-allocation.spec.ts`
- Modify: `packages/bundle/dsh-codex_shared_pool/tests/store.spec.ts`

- [x] **Step 1: Add failing storage tests**

Prove that the first stored profile is the priority, confirming another profile atomically moves it to the front, duplicate account protection remains intact, removal preserves the remaining order, and secret-free summaries preserve that order without a second active field.

- [x] **Step 2: Add failing allocator tests**

Cover first-eligible selection, selected-model quota buckets, zero individual limits, unreadable quota, all-exhausted fallback, existing-Session replacement with the global first eligible profile, changed-priority application to an existing Session's next request, and concurrent compare-and-replace ownership.

- [x] **Step 3: Confirm the failures**

Run the two focused files. They must fail because the store still owns a separate `activeProfileId`, and the adapter does not perform pre-request quota allocation.

### Task 2: Implement one Host-owned allocation order

**Files:**

- Create: `packages/bundle/dsh-codex_shared_pool/src/account-allocation.ts`
- Modify: `packages/bundle/dsh-codex_shared_pool/src/store.ts`
- Modify: `packages/bundle/dsh-codex_shared_pool/src/usage.ts`
- Modify: `packages/bundle/dsh-codex_shared_pool/src/adapter.ts`
- Modify: `packages/bundle/dsh-codex_shared_pool/src/responses.ts`
- Modify: `packages/bundle/dsh-codex_shared_pool/tests/response-runtime.spec.ts`
- Modify: `packages/bundle/dsh-codex_shared_pool/tests/codex-compaction.spec.ts`

- [x] **Step 1: Replace active-profile storage with ordered priority**

Advance the pre-release document format, remove `activeProfileId`, expose `prioritizeProfile(profileId)`, and let the store own process-local Session bindings plus compare-and-replace. The credential facade resolves only the allocator's binding; adding the first profile establishes the initial priority without creating a second selector.

- [x] **Step 2: Allocate before every provider request**

Scan profiles in stored order for the request model. Keep the existing binding only when it is already the first eligible profile or every profile is proven exhausted. Commit a different winner atomically and notify the response runtime only for the committed replacement.

- [x] **Step 3: Reset provider continuation on replacement**

Close the Session WebSocket and clear its continuation state before resolving the new credential. Preserve compaction ownership and prove that no prior `previous_response_id` reaches the replacement account.

- [x] **Step 4: Run focused Host tests**

Run allocation, store, response-runtime, compaction, and adapter-focused tests before changing the browser.

### Task 3: Add the explicit global-priority mutation

**Files:**

- Modify: `packages/bundle/dsh-codex_shared_pool/src/auth-routes.ts`
- Modify: `packages/bundle/dsh-codex_shared_pool/tests/auth-routes.spec.ts`
- Create: `packages/bundle/dsh-codex_shared_pool/tests/settings-profile-priority.client.spec.tsx`
- Modify: `packages/bundle/dsh-codex_shared_pool/src/client/OpenAICodexSettings.tsx`
- Modify: `packages/bundle/dsh-codex_shared_pool/src/client/locales.ts`

- [x] **Step 1: Add failing route and component tests**

Reconfirm the current priority twice and prove both mutations remain harmless. Select a non-priority account and assert that inspection alone sends no mutation. Confirm **Use first**, assert the opaque profile id reaches the priority endpoint, and move the marker and list order only after a refreshed ready response. Cover a failed mutation and successful retry while the previous marker remains visible.

- [x] **Step 2: Implement the route and confirmation action**

Expose a Host mutation named for priority rather than activation. Render the same compact outline **Use first** action for every selected profile, including the current priority, and label only the first profile **Priority** in the list. Keep the detailed allocation rules in the README instead of repeating them beside the action.

- [x] **Step 3: Run focused browser and route tests**

Run the priority component test, auth-route tests, and existing login-cancellation coverage.

### Task 4: Pin assembled UI and document the decision

**Files:**

- Modify: `apps/web/tests/codex-account-auth.e2e.ts`
- Generate: `apps/web/tests/snapshots/codex-account-auth/global-priority.expected.md`
- Modify: `packages/bundle/dsh-codex_shared_pool/README.md`
- Modify: `packages/bundle/dsh-codex_shared_pool/README.zh.md`
- Create: `.agents/notes/implemented/feature/2026-08-18-codex-global-account-priority.md`
- Create: `.agents/notes/implemented/feature/2026-08-18-codex-global-account-priority.zh.md`
- Generate: translation-pair records for every changed documentation pair

- [x] **Step 1: Record the assembled Settings flow**

Use the real Web composition to capture repeated confirmation of the current priority, account inspection without mutation, explicit confirmation of another account, and the moved priority marker. Treat the snapshot as derivative of the scenario.

- [x] **Step 2: Update current product documentation**

Document ordered global priority, next-request application to existing conversations, model-specific explicit-zero fallback, unreadable-quota behavior, provider continuation reset, and the independent Codex-home sidebar credential store. Replace the superseded activation-only Agent Note with one implemented decision record and audit related active notes for overlap.

- [x] **Step 3: Run scoped documentation and product checks**

Re-record the confirmed English/Chinese pairs, run translation pairing, Agent Note format, documentation sync, lint, `git diff --check`, bundle-focused Vitest, the bundle TypeScript build, and the assembled Web scenario. Report only commands actually run and any unrelated repository failures separately.
