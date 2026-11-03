# Todo Panel

A project todo pane for Claude Code. Every conversation in a project shares one `docs/todo.md`, the pane sits beside the chat, and it follows the file within about 2 seconds of a change. The CLI and the desktop app run the same mod.

## Features

- **Six groups:** Now, Next, Backlog, Maybe, Issues and Ideas. "Now" uses the accent color, Backlog and Maybe are dimmed, and finished items show `✓` and are struck through.
- **Cards in the terminal:** in the CLI each open item is a rounded card, in the style of Microsoft To Do, with any detail after the first colon (`：` or `: `) or ` — ` shown as a dimmer caption beneath the title. Only Now's cards have a colored (brand orange) border; Issues headers and marks are red, Ideas purple. Finished items follow as compact lines below the cards with a green `✓`.
- **Shared across conversations:** every conversation in a project reads and writes the same file; in a git worktree they use the main worktree's copy.
- **Kept up to date by the conversations:** each conversation gets the upkeep rules and the current list, adds new items as they come up, and checks them off when they are done.
- **Format check:** an entry missing its `[ ]`, written with Write or Edit, is refused with a note on how to fix it.

## Install

Needs a Claude Code version that supports mods; tested on 2.1.316. At the prompt of a terminal session, type:

```
/plugin install todo-panel --marketplace fghjkl007/claude-todo-list-panel
```

Then answer the prompts: type `y` to add the marketplace, and press Enter to install for your user.

Or install from the shell:

```bash
claude plugin install todo-panel --marketplace fghjkl007/claude-todo-list-panel
```

The desktop app cannot run `/plugin`: click **+** next to the prompt box, choose **Plugins**, enter `fghjkl007/claude-todo-list-panel` under **Add marketplace**, then click **Add plugin**. Once installed for your user from a terminal, the desktop app's local sessions load it too.

## Usage

| To | Do |
|---|---|
| Open or close the pane | `/todo` |
| Create a list when there is none | `/todo`, which writes the six-group template to `docs/todo.md` |
| Have the conversation add an item | Just say "note that we need to do X" |
| Close it with a shortcut (CLI) | `ctrl+x x` |

When a project already has a list, new sessions open the pane on their own. A terminal narrower than 144 columns does not show it automatically; type `/todo` to open it.

## List format

```markdown
## Now
- [ ] What is being worked on
- [x] What is done

## Next
- [ ] Confirmed work that has not started yet

## Backlog
- [ ] Worth doing, but left for later

## Maybe
- [ ] Not yet decided whether to do it

## Issues
- [ ] A bug found or a problem not yet solved

## Ideas
- [ ] An unverified idea, recorded as stated
```

A hand-written `- item` also shows as an open item.

Lists made by earlier versions use the Chinese headings 现在, 接下来, Backlog, 待定, 问题 and 新想法. They still display, with 现在 accented and 待定 dimmed, and conversations keep those headings instead of adding English ones.

## How it works

There is no background process and no change to `settings.json`. All the logic is in [`mods/todo-panel/hooks/register.tsx`](mods/todo-panel/hooks/register.tsx), built on the mod's hooks:

| Event | What it does |
|---|---|
| `session.start` | Registers `/todo`, reads the list, and checks the file for changes every 2 seconds |
| `command.run` | Handles `/todo`: opens or closes the pane, creating the list if needed |
| `prompt.compose` | Adds the upkeep rules to the system prompt |
| `prompt.context` | Gives the conversation the current list |
| `tool.call` | Checks the format of what is written to `docs/todo.md` |
| `ui.render` | Draws the pane for each surface (terminal, desktop, VS Code, mobile) |

## Known limits

- **Upkeep is not enforced:** it relies on rules given to the conversation, which may miss an item or forget to check one off.
- **The format check is narrow:** it only checks entries starting with `-` or `*` written by Write and Edit; writes from Bash, hand edits and plain text lines are not checked.
- **The pane is read-only:** to change the list, edit the file or tell the conversation.
- **The API may change:** the mod API is still early, and a Claude Code update may need changes here.

## Development

```bash
claude plugin test mods/todo-panel
```

```bash
claude plugin validate mods/todo-panel
```

Run the mod straight from its folder with `claude --plugin-dir mods/todo-panel`.
