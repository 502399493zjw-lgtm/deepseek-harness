# @deepseek-ai/dsh-client-ui-codex-quota

English | [中文](README.zh.md)

Browser quota summary that polls `codexQuota/read` without receiving Codex credentials or raw app-server payloads. The expanded sidebar uses the active-account line as its primary 14px/22px row and places the icon-only arrow action on that same row. The account-pool summary sits 2px below at 12px/18px in the subdued caption color. Only the active account's remaining percentage uses the blue business color; the pool percentage inherits its summary color. The Host-supplied account label follows the Settings page's `name`, then `email`, display precedence. The arrow asks the Settings shell to select `settings.section#openai-codex`, the full account page owned by the OpenAI Codex plugin. This package does not register a competing quota-only Settings page. The footer contribution is hidden in the collapsed 56px sidebar rail.

## Model Experience

### Request context and condition

#### What the model sees

No model-visible content; this browser-only package polls `codexQuota/read` and contributes sidebar chrome.

#### Token effect

Zero direct token effect.

#### KV Cache effect

The package does not alter model requests or reusable prompt prefixes.

## Known Limitations and Deferred Work

- **No compact rail badge** — the text block is hidden while the sidebar is collapsed because the two-line account summary does not fit the narrow rail.
- **The full account page has its own owner** — the arrow action opens the page registered by the OpenAI Codex plugin at `settings.section#openai-codex`; this quota package deliberately does not duplicate account management.
