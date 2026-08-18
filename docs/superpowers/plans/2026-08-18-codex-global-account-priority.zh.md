# Codex 全局账号优先级实施计划

[English](2026-08-18-codex-global-account-priority.md) | 中文

> **供 agentic workers 使用：**在 detached `4f40` worktree 中直接执行本计划。先编写失败的聚焦测试再实现；除非用户另行授权提交，否则保持 Git 历史不变。

**目标：**允许用户确认一个 ChatGPT 账号作为 Codex 额度消耗的全局首选，同时由自动分配在该账号所选模型的额度未被确定耗尽时优先使用它，并在耗尽后使用其他账号。

**架构：**Host 持有的 profile 文档只存储一个有序 profile 列表；首个 profile 就是全局分配优先级，因此不会再有与自动分配冲突的 active/default 选择。确认操作通过同源修改接口把所选 profile 移到最前，浏览器只在 Host 返回新顺序后刷新展示。每次 Codex 请求前，分配器都按这份全局顺序扫描，并把 Session 绑定或切换到相关额度未明确为零的第一个 profile。切换时先关闭 Session 缓存的提供方续传状态，再解析新凭据，因此下一次请求会在同一账号身份下发送完整 Harness 上下文。正在进行的请求不会被中断或重放。

**技术栈：**TypeScript、React 18、Cordis 服务、pi-ai OAuth 凭据、Vitest、Testing Library、Playwright 组装 Web 快照。

## 全局约束

- OAuth 凭据和提供方额度读取只留在 Host；浏览器响应只能包含不透明 profile id 和不含秘密的用量摘要。
- 只使用存储的 profile 顺序表达分配优先级。首个 profile 显示优先标记，并成为每个 Session 第一个检查额度的账号。
- 优先级变化在下一次请求边界生效，包括已有对话；不得中断或重放正在进行的提供方请求。
- 只能在请求前分配时切换账号。解析替换凭据前关闭提供方续传状态，避免续传 id 跨账号身份使用。
- 只有所选模型的速率限制额度桶或工作区成员限额明确为零时，才把账号视为已耗尽。额度缺失或无法读取不能作为跳过账号的依据。
- 只有修改和随后的 ready 状态刷新都成功后，浏览器才展示新的优先级。失败时保留原顺序，并允许重试。
- 保留无关改动，不编辑独立的 `dsh-codex-auto-allocation` worktree，也不提交、推送、合并、rebase 或改写历史。
- 同一改动必须同步更新中英文 UI 文案、README、配对记录和负责该决策的 Agent Note。

---

### 任务 1：固定全局优先级和分配器行为

**文件：**

- 新建：`packages/bundle/dsh-codex_shared_pool/tests/account-allocation.spec.ts`
- 修改：`packages/bundle/dsh-codex_shared_pool/tests/store.spec.ts`

- [x] **步骤 1：添加失败的存储测试**

证明第一个已存 profile 就是优先账号；确认另一个 profile 会原子地将其移到最前；重复账号保护继续生效；移除账号后保留剩余顺序；不含秘密的摘要会保留该顺序，而不再携带第二个 active 字段。

- [x] **步骤 2：添加失败的分配器测试**

覆盖首个可用账号选择、所选模型的额度桶、个人限额为零、额度无法读取、全部耗尽时的回退、已有 Session 切换到全局第一个可用 profile、优先级变化在已有 Session 下一次请求生效，以及并发 compare-and-replace 所有权。

- [x] **步骤 3：确认测试失败**

运行两个聚焦测试文件。测试必须失败，因为存储仍持有单独的 `activeProfileId`，适配器也没有执行请求前额度分配。

### 任务 2：实现由 Host 持有的唯一分配顺序

**文件：**

- 新建：`packages/bundle/dsh-codex_shared_pool/src/account-allocation.ts`
- 修改：`packages/bundle/dsh-codex_shared_pool/src/store.ts`
- 修改：`packages/bundle/dsh-codex_shared_pool/src/usage.ts`
- 修改：`packages/bundle/dsh-codex_shared_pool/src/adapter.ts`
- 修改：`packages/bundle/dsh-codex_shared_pool/src/responses.ts`
- 修改：`packages/bundle/dsh-codex_shared_pool/tests/response-runtime.spec.ts`
- 修改：`packages/bundle/dsh-codex_shared_pool/tests/codex-compaction.spec.ts`

- [x] **步骤 1：用有序优先级替换 active profile 存储**

提升预发布文档格式版本，移除 `activeProfileId`，提供 `prioritizeProfile(profileId)`，并让存储持有进程内 Session 绑定和 compare-and-replace。凭据 facade 只能解析分配器确定的绑定；添加第一个 profile 时会建立初始优先级，不再创建第二个选择来源。

- [x] **步骤 2：每次提供方请求前分配账号**

按存储顺序为请求模型扫描 profile。只有现有绑定已经是第一个可用 profile，或所有 profile 都被确定耗尽时，才保留现有绑定。原子地提交其他胜出 profile，并且只让成功提交替换的一方通知响应运行时。

- [x] **步骤 3：替换时重置提供方续传状态**

解析新凭据前关闭 Session WebSocket 并清除其续传状态。保留压缩所有权，并证明旧的 `previous_response_id` 不会到达替换账号。

- [x] **步骤 4：运行聚焦 Host 测试**

修改浏览器前，运行分配器、存储、响应运行时、压缩和适配器聚焦测试。

### 任务 3：添加明确的全局优先级修改操作

**文件：**

- 修改：`packages/bundle/dsh-codex_shared_pool/src/auth-routes.ts`
- 修改：`packages/bundle/dsh-codex_shared_pool/tests/auth-routes.spec.ts`
- 新建：`packages/bundle/dsh-codex_shared_pool/tests/settings-profile-priority.client.spec.tsx`
- 修改：`packages/bundle/dsh-codex_shared_pool/src/client/OpenAICodexSettings.tsx`
- 修改：`packages/bundle/dsh-codex_shared_pool/src/client/locales.ts`

- [x] **步骤 1：添加失败的路由和组件测试**

连续两次重新确认当前优先账号，并证明两次修改都不会产生额外变化。选择一个非优先账号，并断言只查看详情不会发送修改。确认**优先使用**，断言优先级接口收到不透明 profile id，并且只有刷新得到 ready 响应后才移动标记和列表顺序。覆盖修改失败后成功重试，并在失败期间继续显示原优先标记。

- [x] **步骤 2：实现接口和确认操作**

暴露以优先级命名的 Host 修改接口，不再使用 activation 语义。每个所选 profile 都显示同一个紧凑的描边**优先使用**操作，包括当前优先账号；列表中只有首个 profile 标记为**优先**。详细分配规则留在 README，不在操作旁重复说明。

- [x] **步骤 3：运行聚焦浏览器和接口测试**

运行优先级组件测试、认证接口测试和已有登录取消测试。

### 任务 4：固定组装界面并记录决策

**文件：**

- 修改：`apps/web/tests/codex-account-auth.e2e.ts`
- 生成：`apps/web/tests/snapshots/codex-account-auth/global-priority.expected.md`
- 修改：`packages/bundle/dsh-codex_shared_pool/README.md`
- 修改：`packages/bundle/dsh-codex_shared_pool/README.zh.md`
- 新建：`.agents/notes/implemented/feature/2026-08-18-codex-global-account-priority.md`
- 新建：`.agents/notes/implemented/feature/2026-08-18-codex-global-account-priority.zh.md`
- 生成：所有已修改文档对的翻译配对记录

- [x] **步骤 1：记录组装后的设置流程**

通过真实 Web 组合记录重复确认当前优先账号、只查看另一个账号而不修改、明确确认另一个账号和优先标记移动。快照作为该场景的派生产物维护。

- [x] **步骤 2：更新当前产品文档**

记录有序全局优先级、已有对话在下一次请求应用变化、按模型明确零额度回退、额度不可读行为、提供方续传重置，以及独立的 Codex-home 侧边栏凭据存储。用一个已实现决策记录替换只描述 activation 的 Agent Note，并审计相关 active note 是否重叠。

- [x] **步骤 3：运行限定范围的文档和产品检查**

重新记录已确认一致的中英文配对，运行翻译配对、Agent Note 格式、文档同步、lint、`git diff --check`、组合包聚焦 Vitest、组合包 TypeScript 构建和组装 Web 场景。只报告实际运行的命令，并单独说明无关的仓库错误。
