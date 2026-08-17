# @deepseek-ai/dsh-host-codex-quota

English | [中文](README.zh.md)

Read-only Host gateway for sidebar-safe Codex quota data. For each configured Codex home it starts the official `codex app-server --stdio`, calls `account/read` and `account/rateLimits/read`, and returns only the account label, primary-window remaining percentage, reset instant, pool size, and mean pool remaining percentage through `codexQuota/read`. For ChatGPT accounts, the Host derives the label from the local OAuth display claim with the same `name`, then `email`, precedence used by Settings; the app-server email remains the fallback. Authentication tokens and Codex-home paths never cross the Remote boundary.

`accountHomes` is ordered and the first entry is the active account. When omitted, `DSH_CODEX_ACCOUNT_HOMES` (platform path-delimited) is used, then `CODEX_HOME`, then `~/.codex`. `refreshIntervalMs` defaults to 60000, `requestTimeoutMs` to 15000, `disposeGraceMs` to 3000, and `codexCommand` to `codex`. The pool count includes configured homes that are temporarily unreadable; the pool percentage averages only successful primary-window reads.

## Model Experience

### Request context and condition

#### What the model sees

No model-visible content; this package serves the `codexQuota/read` user-interface projection and adds no model context.

#### Token effect

Zero direct token effect.

#### KV Cache effect

The package does not alter model requests or reusable prompt prefixes.

## Known Limitations and Deferred Work

- **Primary window only** — the sidebar intentionally summarizes the official primary Codex rate-limit window; secondary windows and credit balances are not displayed.
- **Account source remains explicit** — the Settings-compatible `name`, then `email`, precedence applies to each configured `accountHomes` credential. An independently configured Settings profile can represent a different account and therefore show a different label.
