# `@deepseek-ai/dsh-codex_shared_pool`

English | [中文](README.zh.md)

The single public plugin and installation entry for DeepSeek Harness Codex integration. One Loader row installs the ChatGPT OAuth model provider, Codex web search, Web settings, sidebar quota summary, TUI commands, image tools, and the read-only quota Host capability. Internal Host and Remote packages support this plugin but are not separate Codex products or Loader entries.

The provider supports multiple user-authorized ChatGPT accounts. Their stored order is the global quota priority: before each Codex model request, the provider checks profiles from first to last and uses the first profile whose relevant quota is not explicitly exhausted. Reordering the profiles therefore applies to the next request in both new and existing conversations; a request already in progress keeps its current credential.

## Composition

[`cordis.patch.yml`](cordis.patch.yml) contributes only `codex-shared-pool` with module name `@deepseek-ai/dsh-codex_shared_pool`. It selects `openai-codex` / `gpt-5.6-sol` for new agents and selects the Codex search provider; a saved model selection still takes precedence.

- The Host entry owns OAuth profiles, model and search adapters, image-tool policy, browser auth routes, TUI commands, and the optional quota child capability.
- The browser entry owns the `openai-codex` Settings section, model preferences, image-tool rendering, and the three-line account and quota block above the sidebar's bottom actions. The arrow action opens that same Settings section.
- [`packages/host/codex-quota`](../../host/codex-quota/README.md) reads official Codex homes through `codex app-server --stdio`, and [`packages/api/remotes`](../../api/remotes/README.md) carries its display-safe `codexQuota/read` result. Neither package receives an independent Loader row.

The `dsh-openai-codex` executable provides `login`, `status`, and `logout` for terminal or headless installations. The TUI contribution exposes the same provider and `/codex status|login|logout|usage|config` command family without a second `/tui` plugin registration.

## Configuration

Configure the single Loader entry:

```yaml
- id: codex-shared-pool
  name: '@deepseek-ai/dsh-codex_shared_pool'
  config:
    searchMode: live
    searchContextSize: medium
    quota:
      accountHomes:
        - ~/.codex
```

| Field | Default | Meaning |
|---|---:|---|
| `searchModel` | `gpt-5.6-sol` | Model used by standalone Codex search. |
| `searchMode` | `cached` | `cached`, `indexed`, or `live` search access. |
| `searchContextSize` | `medium` | `low`, `medium`, or `high` search context. |
| `searchMaxOutputTokens` | `10000` | Positive output budget for standalone search. |
| `modifyReadImage` | `true` | Adds bounded HTTP(S) input to the existing `read_image` tool. |
| `shareImagegenWithOtherModels` | `true` | Allows other vision-capable providers to call `imagegen`. |
| `useFastMode` | `false` | Requests the Codex priority service tier for supporting models. |
| `useWebSocketContextReuse` | `false` | Reuses an exact-extension Codex context over WebSocket. |
| `useNativeCompaction` | `false` | Uses Codex V2 Responses compaction with Harness fallback. |
| `quota` | `{}` | Configures the read-only official app-server quota projection below. |

| `quota` field | Default | Meaning |
|---|---:|---|
| `accountHomes` | environment fallback | Ordered Codex homes; the first is the sidebar's current account. |
| `refreshIntervalMs` | `60000` | Cache duration for a successful or unavailable snapshot. |
| `requestTimeoutMs` | `15000` | Deadline for one account's app-server requests. |
| `disposeGraceMs` | `3000` | Child-process termination grace. |
| `codexCommand` | `codex` | Executable name or absolute path. |

When `quota.accountHomes` is empty, the Host reads `DSH_CODEX_ACCOUNT_HOMES` using the platform path delimiter, then `CODEX_HOME`, then `~/.codex`. The pool count includes configured homes that are temporarily unreadable; the pool percentage is the equal-weight mean of successful primary-window reads.

## Account and quota behavior

Open **Settings → OpenAI Codex** to add, inspect, or remove DSH-owned ChatGPT OAuth profiles and view each profile's live Codex limits. The left column is the quota priority order. Selecting a profile card changes only the detail view; choose **Use first** to confirm that profile as the global priority. The Host moves it to the front atomically, and the **Priority** marker moves only after a refreshed profile read confirms the new order. The same action remains available for the current priority, so repeating it is harmless. A failed update retains the previous marker and leaves the action available for retry.

Before every Codex model request, allocation starts again at the front of that order. The provider skips a profile only when the selected model's quota bucket or its individual workspace limit is explicitly at `0%`; missing or unreadable quota metadata keeps the higher-priority profile eligible. `gpt-5.3-codex-spark` uses the `codex_spark` bucket, while other Codex models use `codex`. If every profile is proven exhausted, an existing conversation keeps its current profile and an unbound conversation uses the first profile. A confirmed reorder affects all conversations on their next request, but never interrupts or replays a request already in progress.

Closing the authorization window cancels only the pending login, keeps stored profiles unchanged, and makes **Add account** available again. Account labels use the OAuth profile `name`, then `email`. DSH credentials live in the Harness home and are independent from Codex CLI/Desktop credentials.

The sidebar's first line identifies the current official Codex-home account as `Codex account: <label>`. Its second line shows the remaining primary-window percentage and reset instant in the browser's local time zone using the fixed `M月D HH:mm` format, for example `8月17 15:54`. Month and day are unpadded; hour and minute use two digits. Its third, lighter line shows the configured account count and mean remaining percentage. Only the current-account percentage is blue. The block is hidden in the collapsed rail and its arrow opens **OpenAI Codex** without covering sidebar content.

## Security and failure behavior

- OAuth tokens stay in owner-only Host storage. Browser routes return secret-free profile, preference, and quota data; the quota Remote never returns account-home paths, auth files, raw app-server accounts, or rate-limit buckets.
- The optional quota child waits for the shared subprocess service without keeping the root plugin activation pending. Missing Codex binaries, signed-out homes, timeouts, and protocol failures render a neutral unavailable state and do not block the Web application.
- Local image paths keep the active Harness filesystem and sandbox behavior. Remote image reads bound redirects and bytes and reject embedded URL credentials.

## Model Experience

### Request context and condition

#### What the model sees

Selecting `openai-codex` routes the normal Harness conversation, tools, reasoning settings, and attachments through the Codex Responses adapter. When enabled for the selected model, `imagegen` is an additional tool and `read_image` accepts a bounded `url` input. Standalone Codex search returns ordinary Harness text and HTTP(S) citations. Quota summaries and account-management UI are never model-visible.

#### Token effect

The provider sends the Harness request context required for each Codex turn. Enabling `imagegen` or the URL extension adds their tool-schema tokens, and tool results enter ordinary conversation history. Native compaction can replace older history with a Codex encrypted compaction item; failed native compaction falls back to the Harness text summary.

#### KV Cache effect

Stable prompts and tool schemas retain their ordinary reusable prefix. WebSocket context reuse may send only an exact-extension delta using `previous_response_id`; history edits, compaction, Fork, connection loss, or process restart send the full context. When quota allocation changes a conversation's account between requests, the plugin closes that Session's provider-owned continuation state so the next request sends full context under the newly selected credential.

## Known Limitations and Deferred Work

- **Two credential stores** — DSH model profiles and official Codex homes use the same `name`, then `email`, display rule but remain independent credential stores. Reordering DSH model profiles does not reorder `quota.accountHomes`; configure the same first account in both places when the sidebar and model-request priority must match.
- **Primary quota window only** — the sidebar summarizes the official primary rate-limit window. Detailed per-profile limits remain in Settings; secondary windows and credit balances are not aggregated into the sidebar pool percentage.
- **Pre-request allocation only** — allocation uses the quota metadata available before a model request. It does not retry a request that already failed, rotate on authentication or provider errors, or predict whether a positive remaining percentage can finish the request. Missing quota data deliberately keeps the higher-priority account eligible.
- **Process-local conversation binding** — the profile used by each conversation is retained only for the running process. After restart, the next request resolves again from the persisted global profile order.
- **Service supervision is deferred** — start, stop, restart, and status for a long-running Codex service are not exposed. A future successful stop must disable automatic restart.
