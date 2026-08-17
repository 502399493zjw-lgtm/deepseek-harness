# `@deepseek-ai/dsh-codex_shared_pool`

English | [中文](README.zh.md)

The single public project and installation boundary for the DSH Codex quota integration. [`cordis.patch.yml`](cordis.patch.yml) mounts the read-only Codex account-pool gateway and its browser sidebar summary over the generic Web bundle. The primary row uses the same `name`, then `email`, account-label precedence as the OpenAI Codex Settings page, while the subordinate pool row stays a quiet capacity summary. The summary's **Open** action selects `settings.section#openai-codex`, the full account page owned by the OpenAI Codex plugin, instead of registering a second Settings page. The Host implementation lives in [`packages/host/codex-quota`](../../host/codex-quota/README.md), the browser Remote interface remains in [`packages/api/remotes`](../../api/remotes/README.md), and the UI implementation lives in [`packages/client/ui-codex-quota`](../../client/ui-codex-quota/README.md). They are internal parts of this project and are not installed as separate quota products.

## Model Experience

### Request context and condition

#### What the model sees

No model-visible content; this bundle composes the read-only `codexQuota/read` account projection and browser chrome.

#### Token effect

Zero direct token effect.

#### KV Cache effect

The bundle does not alter model requests or reusable prompt prefixes.

## Known Limitations and Deferred Work

- **Web and OpenAI Codex plugins required** — this patch contributes the Codex-specific sidebar summary and expects the generic Web transport, layout, Settings shell, and Remote bridge below it; the full OpenAI Codex plugin owns the `openai-codex` account page selected by Open.
- **Service supervision is deferred** — start, stop, restart, and status remain outside this first project boundary; when added, a successful stop must disable automatic restart.
