# Agent Note: Global Codex account quota priority

Status: implemented

English | [中文](2026-08-18-codex-global-account-priority.zh.md)

## Problem

The OpenAI Codex settings page let users inspect one account while a separate default-profile control governed only later Sessions. This split made the selected account look effective when it was not, and a default limited to new conversations could not express the requested account-pool policy: prefer one account's quota globally, then fall back only after its relevant allowance is exhausted.

A model request may also carry provider-owned continuation state from an earlier request. Changing credentials without discarding that state could send a continuation identifier created under one account with another account's credential.

## Decision

The Host-owned profile document stores one ordered profile list and no separate active-profile id. The first profile is the global quota priority. Selecting a card changes only the browser detail view; confirming **Use first** moves that profile to the front through a same-origin Host mutation. The same light action remains available for the current priority, making repeated confirmation idempotent. The browser refreshes the complete ready state before moving the **Priority** marker. A mutation or refresh failure preserves the prior marker and leaves the action available for retry.

Before every Codex model request, the Host scans profiles from first to last. It skips a profile only when the requested model's quota bucket or the profile's individual workspace limit is explicitly at zero percent. `gpt-5.3-codex-spark` uses the `codex_spark` bucket; other Codex models use `codex`. Missing buckets and unreadable usage keep the higher-priority profile eligible because absence does not prove exhaustion. If every profile is proven exhausted, an existing Session retains its current profile and an unbound Session uses the first profile.

Session bindings remain process-local but may change at each request boundary. A compare-and-replace operation ensures that concurrent requests cannot overwrite a binding changed after quota inspection. The request that commits a different profile closes the Session's provider-owned WebSocket continuation state before credential resolution, so the next provider call sends full Harness context under one account. A reorder affects new and existing conversations on their next request; it never interrupts or replays an in-flight request.

## Alternatives considered

**Keep a separate active-profile id.** Two persisted authorities can disagree: the active id names a preferred account while the ordered allocator names its own first candidate. One ordered list expresses both UI priority and allocation without reconciliation.

**Apply the mutation when a card is selected.** Account cards also control quota inspection. Making an inspection click change global request credentials would hide a consequential action and make accidental changes difficult to distinguish from browsing.

**Keep existing Sessions pinned indefinitely.** Permanent pinning makes a confirmed global priority ineffective in ongoing conversations and prevents quota fallback at the point where users need it. Request-boundary reassignment changes no in-flight call and explicitly resets provider continuation state.

**Treat missing or unreadable quota as exhausted.** A transient usage endpoint failure would silently route paid work to a lower-priority account. Only an explicit zero is sufficient evidence to skip a profile.

**Retry or replay an in-flight provider failure with another account.** Cross-account replay can duplicate side effects and cannot prove that the first provider attempt did no work. Allocation therefore happens only before a request.

## Consequences

- One confirmed order applies to all Codex conversations at the next request boundary, and automatic fallback follows the same order.
- Every allocation may perform bounded quota reads before the model request. An unreadable read fails open to the higher-priority profile and can delay the request until its read deadline.
- The sidebar's official Codex-home account pool remains an independent read-only credential store; changing DSH model-profile priority does not reorder `quota.accountHomes`.
- The profile document format advances to version 2 and rejects the superseded active-profile field under the repository's pre-release compatibility policy.
- Focused store, allocator, route, component, response-runtime, and assembled Web tests pin ordered priority, model-specific explicit-zero fallback, existing-Session reassignment, continuation reset, idempotent explicit confirmation, recoverable failure, and the lightweight Settings action.
