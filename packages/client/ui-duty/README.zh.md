# @deepseek-ai/dsh-client-ui-duty

[English](README.md) | 中文

Duty 界面:当前 Session 属于某次主触发 run 时,在输入框上方停靠的实时 run 看板;以及侧栏底部的 Duty 列表、run 记录与人工决策收件箱面板。

run 看板只从 `duty` session projection 渲染(由 `@deepseek-ai/dsh-duty-runner` 声明,折叠自该 run 的 `duty/*` session 事件);面板的读取与修改走生成的 `duties` Host Remote。本插件除组件本地状态外不持有任何 store 与刷新链。

## 模型体验

### Duty 界面

#### 模型看到什么

什么都看不到。本插件不注册任何工具、提示词段落或 session 事件;它渲染的每个事实(`duty` projection 的 run 机器状态、`ctx.remote.duties` 列表、人工答复)要么是 Host 已算好的 session projection,要么是对持久化 Duty 域的 Remote 读取。

#### Token 影响

零。任何 UI 状态都不会进入模型请求。

#### KV Cache 影响

独立。Remote 读取不触及模型请求前缀;此界面唯一的 Host 修改是 `duties.start`,它在独立 Session 中唤醒 run。

## 已知限制与待办

- **非当前 Session 无实时 run 看板** — 看板只投影正在查看的 Session;后台 run 的进度通过其 run 记录与历史可见,没有实时帧。
- **答复表单只接受自由文本** — 选项词表渲染为普通输入框;选项按钮待做。
- **面板逐行修改** — 无批量生命周期操作。
