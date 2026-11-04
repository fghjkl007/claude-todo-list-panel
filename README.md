# Todo Panel

A project todo pane for Claude Code. Every conversation in a project shares one `docs/todo.md`, the pane sits beside the chat, and it follows the file within about 2 seconds of a change. The CLI and the desktop app run the same mod.

## Features

- **Seven groups for a new list:** a list is created with Now, Next, Backlog, Maybe, Issues, Ideas and Done. A list that already exists keeps its own groups and the project's own rules for them (CLAUDE.md, AGENTS.md): conversations never add the groups it lacks or re-sort its items into these seven. "Now" uses the accent color, Backlog, Maybe and Done are dimmed, and finished items show `✓` and are struck through.
- **Cards in the terminal:** in the CLI each open item is a rounded card, in the style of Microsoft To Do. An item written as fields, `item｜status｜next step (source: …)`, is read by position (the bar is full-width, or ` | ` with spaces; the source bracket is optional, and the older Chinese form of it in full-width brackets is read too); an older `title：note` (or `: `, ` — `) item gives a title and a note. A shut card shows `▸ title` and one dim row, `status · Next: next step` cut with `…` (the note when there is neither); open (`▾`), it shows each field it has on its own labeled line (`Status:`, `Next:`, `Note:`, `Source:`), wrapped in full. A missing field is left out, never guessed. A card with nothing more to show keeps `○` and cannot be opened. Labels follow the list's language: a list with any Chinese in it gets Chinese field labels (`状态：`, `下一步：`, `说明：`, `来源：`), done lines (`已完成 N 项`) and key hint (`ctrl+x tab 选中 · ↑↓ 移动 · Enter 展开/收起 · Esc 回到输入框`); any other list gets the English ones. Only Now's cards have a colored (brand orange) border; Issues headers and marks are red, Ideas purple. Each group header shows only how many items are left to do, as a bare number on the right (`4`), folded or not; a group with everything done, or nothing in it, shows `0`. Its finished items fold into one `▸ N done` (or `▸ 已完成 N 项`) line that opens to green `✓` lines.
- **Fold a whole group (CLI):** a group with any items has `▾` before its title; pressing the title folds it to that one row (`▸ Now … 2`), and the next group follows right below. A folded header shows the same bare count as an unfolded one, `0` included. Pressing it again unfolds it, with the same cards open as before. Folded groups stay folded through redraws and changes to the file, and a new session starts with every group unfolded. An empty group keeps a plain title and cannot be folded. The desktop app, VS Code and mobile keep the flat list.
- **Shared across conversations:** every conversation in a project reads and writes the same file; in a git worktree they use the main worktree's copy.
- **Kept up to date by the conversations:** each conversation gets the upkeep rules and the current list, adds new items to the group that fits, and when one is done checks it off; if the list has a Done group (under the English or the older Chinese heading) the item moves to its end, otherwise it stays where it is, unless the project's rules say otherwise.
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
| Create a list when there is none | `/todo`, which writes the seven-group template to `docs/todo.md` |
| Have the conversation add an item | Just say "note that we need to do X" |
| Close it with a shortcut (CLI) | `ctrl+x x` |
| Open or shut a card, fold a group (CLI) | `ctrl+x tab` gives the pane the keyboard (Control, on macOS and Linux alike) and selects the first group title, drawn in blue; `↑` `↓` (or Tab) move between group titles, cards and done lines, skipping the cards of a folded group. A selected card gets a bold blue border. Enter folds or unfolds the selected group, or opens or shuts the selected card or done line; the pane does not scroll when it does. Esc returns to the prompt. A short hint at the bottom of the pane says the same, in the list's language. |

When a project already has a list, new sessions open the pane on their own. A terminal narrower than 144 columns does not show it automatically; type `/todo` to open it.

## List format

```markdown
## Now
- [ ] What is being worked on

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

## Done
- [x] A finished item, checked off and moved to the end of this group
```

This is the template for a new list only; an existing list keeps the groups it has.

A hand-written `- item` also shows as an open item.

Lists made by earlier versions use Chinese headings: `现在` (Now), `接下来` (Next), `待定` (Maybe), `问题` (Issues), `新想法` (Ideas) and `已完成` (Done), with Backlog in English. They still display, with the Chinese Now heading accented, Issues and Ideas in their colors, and Maybe and Done dimmed; since such a list has Chinese in it, the pane's labels, done lines and key hint are Chinese too. Conversations keep those headings instead of adding English ones or any missing groups.

## How it works

There is no background process and no change to `settings.json`. The hooks and the drawing are in [`mods/todo-panel/hooks/register.tsx`](mods/todo-panel/hooks/register.tsx), and reading the list (groups, items and their fields) is in [`mods/todo-panel/hooks/parse.ts`](mods/todo-panel/hooks/parse.ts). The mod is built on these hooks:

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
- **Mouse clicks need the fullscreen renderer:** the classic terminal renderer does not pass clicks to the pane, so open cards with the keyboard. Clicks were not tested in this version.
- **Open cards and folded groups last for the session:** they stay as they are through redraws and changes to the file, and a new session starts with cards shut and groups unfolded. Two items (or two groups) with the same text are told apart by their order, so adding or deleting one of them can shift which of them is open or folded.
- **The arrows move between group titles, cards and done lines only while one is selected:** with the selection on the pane's close mark, or past the first or last of them, the arrow is left to Claude Code, which scrolls the pane; when the whole list fits and there is nothing to scroll, it can move the selection back to the first group title instead.
- **The pane does not edit the list:** pressing a card only opens or shuts it; to change the list, edit the file or tell the conversation.
- **The API may change:** the mod API is still early, and a Claude Code update may need changes here.

## Development

```bash
claude plugin test mods/todo-panel
```

```bash
claude plugin validate mods/todo-panel
```

Run the mod straight from its folder with `claude --plugin-dir mods/todo-panel`.
