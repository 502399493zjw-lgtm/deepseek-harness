# @deepseek-ai/dsh-client-ui-duty

English | [中文](README.zh.md)

The Duty surface: a live run board docked above the composer when the current Session belongs to a major-trigger run, plus the duty list, run history, and human-decision inbox panel at the sidebar foot.

The run dock renders only from the `duty` session projection (declared by `@deepseek-ai/dsh-duty-runner`, folded from the run's `duty/*` session events); the panel's reads and mutations ride the generated `duties` Host Remote. The plugin owns no store and no refresh chain beyond its own component-local state.

## Model Experience

### Duty surface

#### What the model sees

Nothing. This plugin registers no tool, prompt section, or session event; every fact it renders (the `duty` projection's run machine state, the `ctx.remote.duties` list, human answers) is either a session projection the Host already computed or a Remote read of the durable Duty domain.

#### Token effect

Zero. No UI state enters a model request.

#### KV Cache effect

Independent. Remote reads do not touch a model request prefix; the only Host mutation this surface performs is `duties.start`, which wakes a run in its own Session.

## Known Limitations and Deferred Work

- **No live run board for non-current Sessions** — the dock projects only the Session being viewed; a background run's progress is visible through its run record and history, not live frames.
- **Answer forms accept free text only** — the offered-options vocabulary renders as a plain input; option buttons are deferred.
- **Panel mutations are per-row** — no bulk lifecycle operations.
