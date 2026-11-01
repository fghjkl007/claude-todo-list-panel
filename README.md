# Todo Panel

Claude Code 的项目待办面板。同一个项目的所有对话共用一份 `docs/todo.md`，面板放在聊天旁边，文件一变，面板约 2 秒内跟着更新。CLI 和桌面版用的是同一个 mod。

## 功能

- **五个分组：** 现在、接下来、Backlog、待定、问题。「现在」用强调色，Backlog 和待定变暗，已完成项显示 `✓` 并划线。
- **多对话共用：** 同一项目的对话读写同一个文件；在 git worktree 里也读写主工作区那一份。
- **对话自动维护：** 每个对话都会收到维护规则和当前清单，出现新事项就记，做完就打勾。
- **格式检查：** 对话用 Write 或 Edit 写入缺 `[ ]` 的条目时会被拒绝并提示改正。

## 安装

需要支持 mod 的 Claude Code，已在 2.1.316 上测试。在终端会话的提示符处输入：

```
/plugin install todo-panel --marketplace fghjkl007/claude-todo-list-panel
```

依次回答：输入 `y` 添加 marketplace，再按 Enter 选择用户级安装。

也可以在 shell 里安装：

```bash
claude plugin install todo-panel --marketplace fghjkl007/claude-todo-list-panel
```

桌面版不能运行 `/plugin`：点提示框旁的 **+**，选 **Plugins**，**Add marketplace** 填 `fghjkl007/claude-todo-list-panel`，再点 **Add plugin**。用终端按用户级安装后，桌面版的本地会话也会加载。

## 使用

| 操作 | 方式 |
|---|---|
| 打开或关闭面板 | `/todo` |
| 没有清单时创建 | `/todo`，会在 `docs/todo.md` 建好五组模板 |
| 让对话记一条 | 直接说「记一下，X 要做」 |
| 用快捷键关闭（CLI） | `ctrl+x x` |

项目里已有清单时，新会话会自动打开面板。终端宽度不足 144 列时不会自动显示，输入 `/todo` 即可打开。

## 清单格式

```markdown
## 现在
- [ ] 正在做的事
- [x] 做完的事

## 接下来
- [ ] 明确要做的事

## Backlog
- [ ] 决定以后再说的事

## 待定
- [ ] 拿不准要不要做的事

## 问题
- [ ] 发现的 bug 或还没解决的问题
```

手写的 `- 事项` 也会显示成未完成项。

## 工作原理

没有后台程序，也不用改 `settings.json`。全部逻辑在 [`mods/todo-panel/hooks/register.tsx`](mods/todo-panel/hooks/register.tsx) 里，用 mod 的 hook 实现：

| 事件 | 作用 |
|---|---|
| `session.start` | 注册 `/todo`，读取清单，每 2 秒检查文件变化 |
| `command.run` | 响应 `/todo`：打开或关闭面板，必要时创建清单 |
| `prompt.compose` | 把维护规则加进系统提示 |
| `prompt.context` | 把当前清单带给对话 |
| `tool.call` | 检查写入 `docs/todo.md` 的内容格式 |
| `ui.render` | 按界面（终端、桌面、VS Code、手机）绘制面板 |

## 已知限制

- **自动维护不是强制的：** 它靠给对话的规则，对话可能漏记或忘记打勾。
- **格式检查有范围：** 只检查 Write 和 Edit 写入的 `-` 或 `*` 开头的条目；Bash 写入、手动编辑和普通文字行都不拦。
- **面板只读：** 改内容要改文件，或者告诉对话。
- **API 可能变化：** mod API 还处于早期阶段，Claude Code 升级后可能需要调整。

## 开发

```bash
claude plugin test mods/todo-panel
```

```bash
claude plugin validate mods/todo-panel
```

用 `claude --plugin-dir mods/todo-panel` 可以直接从文件夹运行这个 mod。
