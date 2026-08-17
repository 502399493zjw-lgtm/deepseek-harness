# Agent Note: Codex Quota Views in the Web UI

Status: implemented

English | [中文](2026-08-17-codex-quota-sidebar-summary.zh.md)

## Problem

DeepSeek Harness can delegate work to Codex, but the Web shell gives no glanceable account-capacity signal. A user cannot see which Codex account is active, when its primary allowance resets, or whether the configured account pool has useful capacity without leaving the Harness and inspecting each Codex home separately.

Codex authentication files are private credential storage. Browser code must not parse those files or receive tokens, raw account records, or provider protocol payloads across the Harness Remote boundary.

## Decision

The `dsh-codex_shared_pool` plugin mounts its internal `dsh-host-codex-quota` capability, which starts the installed `codex app-server --stdio` for each configured Codex home and reads the official `account/read` and `account/rateLimits/read` operations. `accountHomes` is the explicit configuration; `DSH_CODEX_ACCOUNT_HOMES`, then `CODEX_HOME`, then the default Codex home provide the fallback chain. The first home is the active account.

The Host projects each response into display-only data: account name, primary-window remaining percentage, reset epoch, configured pool size, and the equal-weight mean remaining percentage among homes whose primary window was read successfully. For a ChatGPT account, it reads a bounded local `auth.json` and decodes only the OAuth profile's `name`, then `email`, display claim, matching the OpenAI Codex Settings page; the app-server email remains the fallback. The pool count retains every configured home even when one read fails, so the two numbers do not pretend an unreachable account disappeared. Independent failures degrade the affected fields, and a sixty-second cache bounds process churn. Tokens, login material, raw account objects, and raw rate-limit buckets never enter the Remote contract.

The `dsh-codex_shared_pool` browser entry registers one `sidebar.footer.action` contribution before the bottom navigation actions and hides it in the collapsed rail. Its 14px/22px primary row shows the active account, remaining percentage, and reset time, with the icon-only arrow action on that row. A 12px/18px pool summary sits 2px below in the subdued caption colour. Only the active account's remaining percentage uses the business-primary blue token; the pool percentage inherits the summary colour. Both rows align with the sidebar's leading content edge.

The `dsh-client-ui-settings` base owns a latest-wins `ctx.settingsNavigation` viewing-state service. The arrow action requests `settings.section#openai-codex`, and the settings shell selects it immediately or when its registration appears. The same `dsh-codex_shared_pool` browser entry owns that page together with account selection, login, removal, and detailed quota presentation. The quota contribution registers no competing Settings section and gains no mutation or credential access. The [single Codex plugin boundary](../architecture/2026-08-17-single-codex-plugin-boundary.md) owns the installation and package-topology decision.

A failed or unavailable Remote read renders a neutral lighter-colour status instead of leaking an exception. Refreshing is presentation polling only: no quota state enters a Session log or a model request.

## Alternatives considered

**Send Codex authentication files to the browser.** This would expand the credential boundary and let browser code depend on private on-disk data. The Host instead decodes one bounded display claim and sends only the resulting label.

**Use only the app-server email.** The official account response has no human name, so this would make the sidebar disagree with the Settings page whenever the OAuth profile has a name.

**Send the complete app-server response to the browser.** The UI needs five display fields, while raw account and rate-limit objects expand the privacy surface and bind the browser contract to provider additions it does not use.

**Show only the active account.** That answers the immediate-account question but leaves the configured pool opaque, which is the capacity users need when accounts are rotated.

**Register a quota-only Settings section.** This creates a second Codex destination with a different account model and splits account-page ownership. The summary instead targets the same plugin's existing `openai-codex` section.

**Colour both percentages blue.** The pool percentage is supporting context rather than the active decision signal. Keeping only the current-account percentage blue establishes one primary row and leaves the pool summary visually subordinate.

## Consequences

- Installing `dsh-codex_shared_pool` over the Web bundle adds one Host service, one typed Remote read, and one sidebar view; no Codex quota information becomes model-visible or durable Session data.
- Quota availability depends on an installed compatible Codex binary and its current account state. Missing binaries, signed-out homes, and protocol failures degrade to unavailable UI instead of blocking Web startup.
- A pool percentage is an equal-weight mean of readable primary-window percentages because the official operation exposes percentages rather than a shared token denominator. It is not a token-weighted sum.
- Multiple accounts require distinct Codex homes in configuration or `DSH_CODEX_ACCOUNT_HOMES`; the Harness does not discover credential directories by scanning the filesystem.
- Deterministic protocol and component tests pin display-name precedence, projection, aggregation, failure isolation, two-line copy, state recovery, primary-row action ownership, active-quota blue emphasis, and the `openai-codex` navigation request. An assembled local browser composition against a local app-server subprocess verifies the 14px primary row, 12px caption-colour pool row, 2px gap, and placement above Settings. The same browser plugin supplies the target account page.
