# Agent Note: Single Codex Plugin Boundary

Status: implemented

English | [中文](2026-08-17-single-codex-plugin-boundary.zh.md)

## Problem

Codex model access, account settings, terminal commands, image tools, and sidebar quota information form one user-facing integration. Loading those functions through unrelated public packages or multiple Loader rows makes the Settings inventory describe implementation pieces as separate products and allows their configuration and lifecycle to drift.

Credentials and official app-server access still require Host-only code, while browser presentation requires a Client build. One public plugin cannot erase those runtime and security divisions.

## Decision

`@deepseek-ai/dsh-codex_shared_pool` is the only public installation and Loader boundary for the DSH Codex integration. Its bundle patch contains one `codex-shared-pool` row. The package's Host entry registers the `openai-codex` model and search providers, account service, auth routes, image policy, and TUI adapter; its browser entry registers the OpenAI Codex Settings page, model preferences, tool views, and sidebar quota contribution.

Host-only quota access remains in `@deepseek-ai/dsh-host-codex-quota`, and the browser transport remains in `@deepseek-ai/dsh-api-remotes`. They are internal implementation packages. The root plugin mounts the quota gateway as an optional child when the subprocess service exists, while the bundle's browser entry consumes the typed Remote result. Neither internal package receives a Loader row or an independently installed Codex client plugin.

TUI registration is an installer called by the root Host entry, not a second `dsh-codex-profiles/tui` module. Browser quota presentation lives in the bundle's browser entry, so the arrow and the target `settings.section#openai-codex` are registered by one Client plugin. The [Codex quota view decision](../feature/2026-08-17-codex-quota-sidebar-summary.md) owns the display projection, privacy fields, aggregation, and visual hierarchy.

The browser entry treats authorization-window closure as cancellation. It calls a same-origin Host route, and the Host aborts and awaits the active provider login before republishing durable profile state. Cancellation does not delete stored profiles or leave the Settings action pending.

Static project tests pin the single patch row and reject legacy module names. Real Loader composition tests pin provider registration and disposal, while browser composition tests pin quota slot registration, navigation to the shared Settings page, and withdrawal on unload.

## Alternatives considered

**Keep one Loader row per implementation package.** This exposes Host, Client, Provider, and TUI mechanics as separate installable plugins and permits partial compositions whose Settings and quota navigation targets do not agree.

**Keep a separate TUI plugin.** The TUI adapter consumes the same account service, credentials, preferences, and provider catalog. A separate module adds lifecycle and registration state without owning an independently evolving capability.

**Move credentials or app-server access into the browser package.** This would cross the Host credential boundary and expose filesystem or provider-protocol access to browser code. Internal Host and Remote packages preserve that division behind the single public entry.

**Combine every source file into the bundle package.** The Typert Remote generator and subprocess-owned app-server behavior have repository-wide Host consumers and build ordering. Keeping those internal packages preserves their exact owners without creating another public installation path.

## Consequences

- Plugin inventory and profile configuration show one Codex product name, and one removal or version selection controls all Codex user interfaces and provider behavior.
- Host and Client code still compile in separate TypeScript faces. The public package emits one Host entry and one browser entry, while generated Remote artifacts keep their Host-first build order.
- Optional services can delay only their child contribution. Missing subprocess, Web Server, Settings, tool, attachment, or agent services do not keep the root provider activation pending.
- A closed authorization window has one settlement path across Client and Host: the pending login ends, stored profile state is restored, and another login can start.
- Internal package names can remain visible in source graphs and diagnostics, but they are not supported as separate Codex installations.
- The single public boundary does not merge DSH OAuth profile storage with official Codex-home storage. Their account selections remain explicit and use the same `name`, then `email`, display rule.
