# Todo Panel — rebuild guide

Everything needed to rebuild the Todo Panel mod for Claude Code from scratch: what it is, the design decisions and why they were made, the file layout, the full source of every file, how to test and install it, and what is still open.

Published copy: https://github.com/fghjkl007/claude-todo-list-panel (source as of commit `119f451`). Built and tested on Claude Code 2.1.316.

**For the Claude doing the rebuild:** load the `plugin-authoring` skill first. It holds the mod API reference and supplies the `claude-code` module types, which this repo does not commit (`.claude-plugin/types/` is ignored). Then create the files in "Source files" below, run the checks in "Test and validate", and go through "Acceptance checklist".

---

## 1. What it is

A pane beside the chat that shows the project's `docs/todo.md`. Every conversation in the project shares that one file and keeps it up to date, so the user can see at a glance what is in progress, across all their parallel conversations. The terminal CLI and the desktop app run the same mod.

A new list starts with seven groups (a list that already exists keeps its own groups and the project's own rules for them):

| Group | Holds | Look |
|---|---|---|
| **Now** | What is being worked on | Accent color, `●` marks, medium weight |
| **Next** | Confirmed work that has not started | Normal |
| **Backlog** | Worth doing, deliberately left for later | Dimmed |
| **Maybe** | Understood, but not yet decided whether to do it | Dimmed |
| **Issues** | Bugs found or problems not yet solved | Normal |
| **Ideas** | Unverified ideas, recorded as stated, not treated as confirmed; moved to Next once checked and wanted, deleted if not | Normal |
| **Done** | Finished items, checked off and moved to the end of the group, so the newest is last | Dimmed |

File format:

```markdown
## Now
- [ ] What is being worked on

## Next
- [ ] Confirmed work that has not started yet

## Done
- [x] What is done, moved here when finished
```

---

## 2. Design decisions (and why)

### Architecture

- **A Claude Code mod, not a separate program or a skill.** A mod can draw a pane beside the chat, inject rules into every conversation, and intercept tool calls, all in one hooks module (plus a pure helper file that reads the list) with no background process and no `settings.json` change. Standalone todo programs were looked at and rejected: they cannot see the conversations. A skill was rejected for the upkeep rules because it has to be triggered; rules injected by the mod apply to every project as soon as the mod is installed.
- **A general tool for every project,** not tied to any other project or agent.
- **One mod for the CLI and the desktop app.** The mod API renders per surface (`terminal`, `desktop`, `vscode`, `mobile`), so there is no second implementation.
- **The shared state is a plain file, `docs/todo.md`.** Humans can read and edit it, git can track it if the project wants, and conversations already know how to edit files.
- **In a git worktree, use the main worktree's copy.** `git worktree list --porcelain` lists the main worktree first; the mod uses that path, falling back to the session's cwd outside git. Every worktree session therefore shows the same list.
- **Read-only pane in the first version.** To change the list, edit the file or tell the conversation. Editing in the pane is in the backlog.
- **Poll the file every 2 seconds** with `$.clock.every`, compare the text with the last read, and only push it into state when it changed. A read error is logged once per distinct message, not every tick.
- **Keep the file text in a plugin state atom** (`atom({ plugin: 'todo-panel', key: 'text' }, null, { shape: 'text-1' })`). The poller writes it; `ui.render` reads it. `null` means there is no list.

### Hooks, one job each

| Event | What it does |
|---|---|
| `session.start` | Registers `/todo`; resolves the path; reads the list into state; opens the pane if a list exists; starts the 2 s poller, which also opens the pane the first time a list appears |
| `command.run` (`todo`) | Toggle: if the pane is drawn, close it. Otherwise create the file from the template if missing, load it, and open the pane |
| `prompt.compose` | Appends the upkeep rules as a session-scoped system prompt section `todo-panel:rule` |
| `prompt.context` | Appends the current file text as a context block named `todoList` (skipped when there is no file) |
| `tool.call` | For `Write`/`Edit` to a path ending in `/docs/todo.md`: deny if any bullet line lacks `[ ]` or `[x]`, listing the bad lines |
| `ui.render` (`Pane`, id `todo-panel`) | Draws the pane for the surface |

### /todo behaviour

- **It is a toggle.** Drawn → close (`Todo pane closed`). Closed → open (`Todo pane opened`). No file → write the seven-group template (Done last) and open (`Created <path>`).
- **A pane waiting undrawn counts as closed.** In a terminal narrower than 144 columns the pane is not shown automatically; it is registered but not placed (`isPlaced: false`). The person sees nothing to close, so `/todo` opens it instead of closing it.

### Upkeep rules given to every conversation

The rules are the whole "automatic upkeep" mechanism, so their wording matters:

- Each entry is `- [ ] item`, written **clearly enough for someone who has not read the conversation**: what it is and why it matters. The list is read across conversations, so shorthand from one chat is useless in another.
- **An existing list keeps its own groups** and follows the project's own rules for it (CLAUDE.md, AGENTS.md and the like): conversations put each item in the group that fits, never add groups it lacks, and never re-sort items into the seven groups. Projects with their own convention (for example four tiers) would otherwise be rewritten.
- **The seven groups are only the template for a new file:** if the file does not exist, create it with them the first time an item comes up. Each template group has an explicit definition (table above); move an item to Now when starting it.
- Read the list at the start of a conversation; write new items or decisions into the group that fits. When done, change it to `- [x]`; if the list has a Done group (under the English or the older Chinese heading), move it to the end of that group, so it reads oldest to newest; otherwise leave it where it is, unless the project's rules say otherwise. Delete the line if dropped.
- **Change only the relevant lines and re-read the file before each change**, because another conversation may have just edited it.
- Lists made by older versions use Chinese headings; they are existing lists, so their headings are kept as they are.

### Strict on write, lenient on read

- Conversations must write `- [ ] item`; the `tool.call` hook enforces it for Write and Edit.
- The parser still shows a hand-written `- item` (no checkbox) as an open item, so a person editing the file by hand never loses lines.
- Any other non-heading line is kept as plain text in its group.

### Look (Google Tasks style, flat)

- **Theme keys only, never hex colors**, so every color follows light and dark themes. On graphical surfaces only **Now** uses the accent, the theme key `suggestion`.
- Each group header shows its **open item count** on the right as a bare number (tabular digits, dimmed), with no "open" or "done" words in any language (asked for as "on the right of each group show only the number of items left, not open and done"). On the terminal every titled header shows it, folded or not, `0` when everything in the group is done or it is empty; graphical surfaces hide it when zero.
- Marks on graphical surfaces: `●` for open items in Now, `○` for other open items, `✓` for done. Done items are dimmed and struck through.
- **Terminal cards (Microsoft To Do style):** in the CLI each open item is a rounded-border card. **Reading an item:** a source in brackets at the very end, `(source: …)`, is read off first (the last such bracket if there are two). Lists written in Chinese carry the older form, the Chinese word for "source" and a full-width colon inside full-width brackets, `（来源：…）`; it is read the same way, so a reader writing such a list must type it exactly. Then an item written as fields, `item｜status｜next step` (the full-width bar `｜`, or ` | ` with spaces), is read **by position**: item, status, next step, and any further fields joined as a note; an empty field stays empty, so a next step is never shown as the status. Otherwise the first full-width colon `：`, `: ` or ` — ` after some text splits a title from a note. A missing field is left out and never guessed (`splitItem` returns `{ title, status?, next?, note?, source? }`). **Shut by default:** the card shows `▸`, the title (which wraps under its own indent, the mark in a column of its own), and one dim row cut with `…` (`wrap="truncate-end"`): `status · Next: next step`, or the note when there is neither. **Open** (`▾`): every field it has on its own labeled line (`Status: `, `Next: `, `Note: `, `Source: `), the label dim and the value wrapping in full under its own indent. A card with nothing beyond its title keeps `○` and is not pressable. **Every label is English whatever language the list is in:** the field labels, the done line (`N done`) and the key hint come from one `LABELS` constant. An earlier version switched to Chinese labels when the list held any Chinese; that was dropped when the user asked for English labels and titles throughout. **Keys:** a card's title is a `plain` `Button` keyed `card:<n>:<item text>`, `n` counting earlier items of the same text, so two identical items open on their own; its Box is keyed `box:` + that key so it can be scrolled into view. The open keys live in session state (`expanded`, shape `keys-2`), so they survive redraws and file reloads. **Done items** fold into one line per group, `▸ N done`, a Button keyed `done:<n>:<group title>` that opens to the `✓` lines (`success`, dimmed and struck through). The header count is the bare number of open items, the same folded or unfolded. **Quiet cards (style B, chosen from three mockups):** every card border is gray (`borderDimColor`) except Now's, which use `claude`. Group headers are bold and, like the marks, take the group's color: Now `claude`, Issues `error`, Ideas `merged`, the others the default text color; Backlog, Maybe and Done dim the header, mark and title. The older Chinese headings of these groups get the same looks. No `+` on the right as in To Do: the pane has no action behind it. Graphical surfaces keep the flat list in file order, with bare counts and no Buttons.
- **Folding a whole group (terminal only, verified in the classic renderer on 2.1.318):** asked for as "fold Now so I only see its header, with the Next pile right below it". A group with a title and any items (open or done) gets a fold mark in a column of its own before its title, `▾` unfolded and `▸` folded, in the header's color; the title becomes a `plain` `Button` keyed `group:<n>:<title>` (`n` counting earlier groups of the same title), and the header row's Box is keyed `box:` + that key so an arrow can bring it into view. Folded, the group draws its header row alone, its title and the same bare open count as unfolded, `0` included (an earlier version showed worded open and done counts here, in Chinese; they were dropped when every header was made to show only what is left): no cards, no text lines, no done line, and the next group follows after the usual one-row group gap. An empty group, a group of text lines only, and the untitled lines before the first heading keep a plain, non-pressable title. The folded keys live in session state (`collapsed`, shape `keys-1`), separate from `expanded`, so a group survives redraws and file reloads folded and unfolds with the same cards open; a new session starts with everything unfolded. Header colors stay as they are (Now `claude`, Issues `error`, Ideas `merged`, Backlog, Maybe and Done dimmed); the header under the focus ring takes the accent (`suggestion`, bold, never dimmed) for mark and title, and the terminal also inverts a focused `plain` Button's label, so the selection shows whether the group is folded or not. Graphical surfaces ignore `collapsed` and draw no fold marks.
- **Terminal keyboard (verified in the classic and the fullscreen renderer):** `ctrl+x tab` gives the pane the keyboard; the first Button has `autoFocus`, so the first Button (normally the first group's header) is selected at once. The selected card (the key a `ui.focus` hook stores in session state `focused`, shown only while the pane's `isFocused`) gets a **bold border in the accent** (`suggestion`), separate from whether it is open; a selected header is drawn in the accent instead. A focused pane's arrows normally scroll it, so a `ui.scroll` hook turns a person's arrow (`by` ±1, no `pointer`) into `$.ui.focus` on the previous or next Button and scrolls its card or header into view. The Buttons are walked in drawn order: a header, its cards, its done line, the next header, and a folded group's header alone (`pressableKeysOf(text, collapsed)`). The wheel, page keys, an arrow past the first or last Button, or one with nothing of the list selected are passed on to the engine; it scrolls the pane, and when the whole list fits it may move the ring back to the first Button instead (seen in the classic renderer). Tab walks the same Buttons, then the pane's close mark. Enter folds or unfolds the selected group, or opens or shuts the selected card or done line, and leaves the window where it is: a card opened near the bottom grows below the window, and the next arrow brings the following card into view. Esc returns to the prompt; nothing typed there is touched. No Button has a `hotkey`, so digits and letters stay free. A dim hint at the bottom, shown while anything is pressable, lists exactly these, in English for every list: `ctrl+x tab select · ↑↓ move · Enter open/shut · Esc back to prompt`.
- Backlog, Maybe and Done are dimmed as a whole (title and items). Done holds checked-off items, so on the terminal they sit behind its `▸ N done` line like any group's finished items, and its header counts `0`.
- An empty group shows `Nothing yet`.
- **The mark never touches the text:** mark and text sit in a row with a gap (1 column in the terminal, `xs` on graphical surfaces). An early version had them touching in the CLI.
- **Backticks are stripped for display only**; the file is unchanged. They showed literally in the terminal.
- Spacing per surface: terminal uses numbers (group 1, item 0, mark 1); graphical surfaces use tokens (group `lg`, item `xs`, mark `xs`).
- With no list, the pane says `No list yet. Type /todo to create one.`

### Compatibility with older lists

The first versions used Chinese headings for Now, Next, Maybe, Issues and Ideas (Backlog stayed in English), and lists under them use a Chinese Done heading. Existing lists keep working: section matching is case-insensitive and trimmed, and the code matches these exact headings, which a test list must use verbatim: `现在` (Now) counts as the current group; `待定` (Maybe) and `已完成` (Done) as muted ones; `问题` (Issues) and `新想法` (Ideas) take their groups' colors. The Chinese Next heading, `接下来`, gets the default look like the English one. The rules tell conversations to keep the existing headings. Only the headings are matched: everything the pane adds (labels, done lines, the key hint) stays English for these lists.

### Code style

- Pure functions for parsing, grouping and arrow steps (`parseTodo`, `groupTodo`, `splitItem` in `parse.ts`; `findUncheckedLines`, `pressableKeysOf`, `arrowTarget` in `register.tsx`), exported for tests. Reading the list lives in `parse.ts` so `register.tsx` stays under 800 lines.
- No mutation: `reduce` with spreads. The only mutable state is the poller's `last`/`lastError` closure.
- Named constants for the pane id, title, path, poll interval, section names, template, labels, accent and spacing.

---

## 3. File layout

```
.claude-plugin/marketplace.json        marketplace entry, so users can install from GitHub
.gitignore
README.md
mods/todo-panel/
  .claude-plugin/plugin.json           mod manifest
  hooks/hooks.json                     lists the hooks module
  hooks/register.tsx                   hooks, drawing, keyboard
  hooks/parse.ts                       reads the list: lines, groups, an item's fields (pure)
  hooks/register.test.tsx              tests
  types/index.d.ts                     declares the plugin's state shape
docs/                                  the project's own working notes (ignored)
```

---

## 4. Test and validate

```bash
claude plugin test mods/todo-panel
```

```bash
claude plugin validate mods/todo-panel
```

```bash
claude plugin validate .
```

Expected: 43 tests pass. Validation passes with two existing warnings (no `author` in `plugin.json`, no marketplace `description`).

Lessons from writing the tests:

- In `claude-code/testing`, every `on('…')` fake must be registered **before the test first calls `$`**. To vary a fake inside a loop, register it once and have it read a `let` variable.
- Some surfaces pass `gap` on as `columnGap`; check both.
- Found nodes expose `props`, so color and dim state can be asserted (`props.color === 'suggestion'`, `props.dimColor === true`).
- A fake's handler takes `($, e)`, like a hook. A fake under an event the test raised (`$.ui.focus(input)`, `$.ui.scroll(input)`) returns that event's own result (`{}`); a fake answering a plugin's call returns `{ value }`.
- The engine reads which state a module touches from its source: `update($, <source>, fn)` and `read($, <source>)` must name an atom (or a literal reference) written right there or in a const of the file. A helper that takes the atom as a parameter makes the module fail to load ("the state library's update takes a source the scan can read"), so each toggle names its own atom.
- The kit has no implementation of a plugin's own `$.ui.focus` or `$.ui.scroll` calls ("no implementation for ui.focus"), so the arrow logic is tested through the pure `pressableKeysOf` and `arrowTarget`, the mod wraps those calls in `.catch`, and the moves themselves are checked in a real CLI.

Run the mod from its folder without installing:

```bash
claude --plugin-dir mods/todo-panel
```

After changing an installed mod, open sessions need `/reload-plugins`.

---

## 5. Install

From the published repo, in a terminal session:

```
/plugin install todo-panel --marketplace fghjkl007/claude-todo-list-panel
```

Or from the shell:

```bash
claude plugin install todo-panel --marketplace fghjkl007/claude-todo-list-panel
```

Desktop app: **+** next to the prompt box → **Plugins** → **Add marketplace** `fghjkl007/claude-todo-list-panel` → **Add plugin**. A user-level install made from a terminal is also loaded by the desktop app's local sessions.

For a rebuilt copy, point the marketplace at your own repo or local folder instead.

---

## 6. Open issues and unverified items

**Issues**

- **Prompt hooks skipped by another plugin.** In one desktop session the app reported that todo-panel's `prompt.compose` and `prompt.context` hooks were skipped because `cc-plugin-sec-default` ran first and passed the event on past it. `cc-plugin-sec-default` is not in the user's settings or installed plugins, so it is probably built into or managed by the app. When this happens, conversations get neither the rules nor the list, and upkeep stops. Cause not investigated.
- **Multi-line items (graphical surfaces):** the mark is vertically centered against a wrapped item; it should align to the top line. The terminal cards already put their mark on the first line.
- **Terminal open and folded state is per session** and keyed by item (or heading) text plus order: adding or deleting one of two identical items or headings can shift which of them is open or folded. Keys of deleted items and groups are not pruned during the session.
- **Mouse clicks on cards** were not tested after the keyboard work (the classic renderer passes no clicks to the pane in any case).

**Not yet verified in a real session**

- Pane display in a fresh desktop session and in the interactive CLI.
- `/todo` closing the pane.
- The format check firing in a real conversation.
- The pane after installing from GitHub.
- A worktree session showing the main worktree's list.
- Automatic upkeep: saying "note that we need to do X" and seeing it appear.

**Maybe**

- Side-by-side layout with other panes (the list as a full-height column on the right). The mod cannot control pane placement; it depends on the desktop app.
- A check at the end of each turn for items that were discussed but not written down.

**Backlog**

- Editing directly in the pane.

**Housekeeping**

- No LICENSE yet, so others may view and install it but have no grant to reuse the code.
- `plugin.json` has no `author`.

---

## 7. Acceptance checklist

- [ ] `claude plugin test mods/todo-panel` passes (43 tests).
- [ ] `claude plugin validate` passes for the mod and the marketplace.
- [ ] In a project with no list, `/todo` creates `docs/todo.md` with the seven groups, Done last, and opens the pane.
- [ ] Editing `docs/todo.md` by hand updates the pane within about 2 seconds.
- [ ] `/todo` closes the pane when shown and opens it when closed.
- [ ] A new session in a project with a list opens the pane on its own (terminal at least 144 columns wide).
- [ ] Asking a conversation to note something adds it to the right group.
- [ ] When a conversation finishes an item, it checks it off and moves it to the end of the Done group (English or older Chinese heading) if the list has one, and otherwise leaves it in place.
- [ ] In a list with its own groups (no Done, different names), a conversation adds no groups and moves no items into the seven.
- [ ] A conversation writing `- item` without `[ ]` is refused with the bad lines listed.
- [ ] In a git worktree, the pane shows the main worktree's list.
- [ ] A list with the old Chinese headings (see "Compatibility with older lists") shows the Chinese Now heading accented and the Chinese Maybe and Done headings dimmed, with English labels, done lines and key hint.
- [ ] In the CLI (classic and fullscreen renderer): `ctrl+x tab` selects the first group header (drawn in blue), `↑` `↓` move between headers, cards and done lines and bring each into view, Enter opens or shuts the selected card alone, Esc returns to the prompt, and text typed in the prompt is neither sent nor changed.
- [ ] In the CLI: every group header shows only a bare open count on the right (`4`; `0` when all done or empty), never the words "open" or "done". Enter on a selected header folds the group to that one row with the same count, the next group right below and the pane not scrolled; the arrows skip the folded cards; Enter again unfolds it with the same cards open; an empty group cannot be selected; a change to the file keeps it folded.
- [ ] Two items with the same text open on their own; an open card stays open after the file changes.

---

## 8. Source files

Every file in the repo except `README.md` (whose content is covered above) and the ignored working notes, exactly as in the commit that last updated this guide.

### `mods/todo-panel/.claude-plugin/plugin.json`

````json
{
  "name": "todo-panel",
  "version": "0.1.0",
  "description": "A pane beside the chat showing the project's docs/todo.md, kept up to date by every conversation",
  "types": "./types/index.d.ts"
}
````

### `mods/todo-panel/hooks/hooks.json`

````json
{ "modules": ["./register.tsx"] }
````

### `mods/todo-panel/types/index.d.ts`

````ts
export type TodoText = string | null
// The keys of the terminal cards and done lines pressed open: each stays open through redraws and reloads.
export type ExpandedCards = readonly string[]
// The key of the Button the pane's focus ring is on, or null.
export type FocusedKey = string | null
// The header keys of the terminal groups folded to their header: each stays folded through redraws and reloads.
export type CollapsedGroups = readonly string[]

declare module 'claude-code' {
  interface PluginState {
    'todo-panel': {
      text: Shaped<TodoText>
      expanded: Shaped<ExpandedCards>
      focused: Shaped<FocusedKey>
      collapsed: Shaped<CollapsedGroups>
    }
  }
}
````

### `mods/todo-panel/hooks/parse.ts`

````ts
// Reading docs/todo.md: lines into groups, and an item's text into its fields. Pure, no drawing.

// An item written as fields (item｜status｜next step) is read by position.
const FIELD_SEPARATOR = /｜| \| /
// Otherwise the first of these splits an item into a title and a note.
const CAPTION_SEPARATORS = ['：', ': ', ' — '] as const
// A source in brackets at the very end of an item: (source: …), or the older Chinese form in
// full-width brackets that lists still carry. The greedy head makes it the last such bracket
// when an item holds two.
const SOURCE = /^(.*)[（(]\s*(?:来源|source)\s*[：:]\s*(.+?)\s*[）)]\s*$/is

export type TodoLine =
  | { kind: 'heading'; text: string }
  | { kind: 'item'; text: string; isDone: boolean; section: string }
  | { kind: 'text'; text: string; section: string }

export const parseTodo = (source: string): TodoLine[] =>
  source
    .split('\n')
    .filter(line => line.trim() !== '')
    .reduce<{ section: string; lines: TodoLine[] }>(
      ({ section, lines }, line) => {
        const heading = line.match(/^#+\s+(.*)$/)
        if (heading) {
          const text = (heading[1] ?? '').trim()
          return { section: text, lines: [...lines, { kind: 'heading', text }] }
        }
        const item = line.match(/^\s*[-*]\s+(?:\[( |x|X)\]\s+)?(.*)$/)
        const parsed: TodoLine = item
          ? { kind: 'item', text: item[2] ?? '', isDone: /x/i.test(item[1] ?? ''), section }
          : { kind: 'text', text: line, section }
        return { section, lines: [...lines, parsed] }
      },
      { section: '', lines: [] },
    ).lines

export type BodyLine = Exclude<TodoLine, { kind: 'heading' }>

export type TodoGroup = { title: string; openCount: number; lines: BodyLine[] }

const isOpen = (line: BodyLine) => line.kind === 'item' && !line.isDone

export const groupTodo = (lines: TodoLine[]): TodoGroup[] =>
  lines
    .reduce<{ title: string; lines: BodyLine[] }[]>((groups, line) => {
      if (line.kind === 'heading') {
        return [...groups, { title: line.text, lines: [] }]
      }
      const last = groups.at(-1) ?? { title: '', lines: [] }
      return [...groups.slice(0, -1), { ...last, lines: [...last.lines, line] }]
    }, [])
    .map(group => ({ ...group, openCount: group.lines.filter(isOpen).length }))

// What an item says: a missing field is absent, never guessed from another.
export type ItemFields = {
  title: string
  status?: string
  next?: string
  note?: string
  source?: string
}

// The fields beneath a title, in the order an open card shows them.
export const DETAIL_NAMES = ['status', 'next', 'note', 'source'] as const
type Details = Omit<ItemFields, 'title'>

const withDetails = (title: string, details: Details): ItemFields =>
  DETAIL_NAMES.reduce<ItemFields>((fields, name) => {
    const value = details[name]
    return value === undefined || value === '' ? fields : { ...fields, [name]: value }
  }, { title })

export const hasDetails = (fields: ItemFields) => DETAIL_NAMES.some(name => fields[name] !== undefined)

const splitSource = (text: string): { rest: string; source?: string } => {
  const match = SOURCE.exec(text)
  const rest = match?.[1]?.trim() ?? ''

  return match === null || rest === '' ? { rest: text } : { rest, source: match[2] }
}

// By position: the item, its status, its next step, then any further fields as a note. An empty
// field stays empty, so a next step is never shown as the status.
const splitFields = (text: string): ItemFields | undefined => {
  const [title = '', status, next, ...notes] = text.split(FIELD_SEPARATOR).map(field => field.trim())
  const fields = withDetails(title, { status, next, note: notes.filter(note => note !== '').join('｜') })

  return title !== '' && hasDetails(fields) ? fields : undefined
}

const splitCaption = (text: string): ItemFields => {
  // Every place a separator occurs, so an empty side at one still lets a later one split.
  const cuts = CAPTION_SEPARATORS.flatMap(separator =>
    text.split(separator).slice(1).map((_, index) => {
      const at = text.split(separator, index + 1).join(separator).length
      return { at, title: text.slice(0, at).trim(), caption: text.slice(at + separator.length).trim() }
    }),
  ).filter(cut => cut.title !== '' && cut.caption !== '')
  const first = cuts.reduce<(typeof cuts)[number] | undefined>(
    (best, cut) => (best === undefined || cut.at < best.at ? cut : best),
    undefined,
  )

  return first === undefined ? { title: text } : { title: first.title, note: first.caption }
}

// A source at the end is read off first; then fields win over a note, so a colon inside a field
// (issue：…) stays in its field.
export const splitItem = (text: string): ItemFields => {
  const { rest, source } = splitSource(text)
  const fields = splitFields(rest) ?? splitCaption(rest)

  return source === undefined ? fields : { ...fields, source }
}
````

### `mods/todo-panel/hooks/register.tsx`

````tsx
import { atom, read, update } from 'claude-code'
import type { Color, Elements, Register, Space, StateDollar, UiScrollInput } from 'claude-code'

import { DETAIL_NAMES, groupTodo, hasDetails, parseTodo, splitItem } from './parse'
import type { BodyLine, ItemFields, TodoGroup } from './parse'

const PANE = 'todo-panel'
const TITLE = 'Todo'
const TODO_PATH = 'docs/todo.md'
const POLL_MS = 2000
// Lists made before the headings were English use the Chinese names, so both count.
const CURRENT_SECTIONS = ['now', '现在']
// A Done group, where a list has one, holds finished items and is dimmed like the parked groups.
const MUTED_SECTIONS = ['backlog', 'maybe', '待定', 'done', '已完成']
const TEMPLATE = '## Now\n\n## Next\n\n## Backlog\n\n## Maybe\n\n## Issues\n\n## Ideas\n\n## Done\n'
// A theme key, not a fixed hex, so the one accent follows light and dark.
const ACCENT = 'suggestion'
const SPACING = {
  terminal: { group: 1, item: 0, mark: 1 },
  graphical: { group: 'lg', item: 'xs', mark: 'xs' },
} as const
// A card's border plus its padding: a group's done line starts here so its mark sits under each card's.
const CARD_PADDING = 1
const CARD_INSET = CARD_PADDING + 1
// Done items sit under their done line's words, past its mark and the gap after it.
const DONE_INSET = CARD_INSET + 2
const SUMMARY_JOIN = ' · '

const todoText = atom({ plugin: 'todo-panel', key: 'text' } as const, null, {
  shape: 'text-1',
})
// The terminal cards and done lines pressed open, by their Button keys.
const expandedCards = atom({ plugin: 'todo-panel', key: 'expanded' } as const, [], {
  shape: 'keys-2',
})
// The Button the pane's focus ring is on: its card is drawn selected, and the arrows step from it.
const focusedKey = atom({ plugin: 'todo-panel', key: 'focused' } as const, null, {
  shape: 'key-1',
})
// The terminal groups folded to their header, by their header Buttons' keys.
const collapsedGroups = atom({ plugin: 'todo-panel', key: 'collapsed' } as const, [], {
  shape: 'keys-1',
})
const CARD_KEY_PREFIX = 'card:'
const DONE_KEY_PREFIX = 'done:'
const GROUP_KEY_PREFIX = 'group:'
// A card's or header's Box is keyed after its Button, so an arrow can bring the whole card into
// view; a Button key always starts card:, done: or group:, so no Box key can equal one.
const BOX_KEY_PREFIX = 'box:'

// The words the terminal adds around items, in English whatever language the list is in.
const LABELS = {
  status: 'Status: ',
  next: 'Next: ',
  note: 'Note: ',
  source: 'Source: ',
  done: (count: number) => `${count} done`,
  hint: 'ctrl+x tab select · ↑↓ move · Enter open/shut · Esc back to prompt',
} as const

type Host = {
  process: {
    run: (argv: readonly string[]) => Promise<{ exitCode: number; stdout: string }>
  }
  session: { cwd: () => Promise<string> }
  fs: {
    exists: (path: string) => Promise<boolean>
    read: (path: string) => Promise<string>
  }
}

const isNamed = (names: readonly string[], section: string) =>
  names.includes(section.trim().toLowerCase())

type Ui = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button'>
type ItemLine = Extract<BodyLine, { kind: 'item' }>
type TextLine = Extract<BodyLine, { kind: 'text' }>

const withoutBackticks = (text: string) => text.replaceAll('`', '')
const isItem = (line: BodyLine): line is ItemLine => line.kind === 'item'
const isDoneItem = (line: BodyLine): line is ItemLine => line.kind === 'item' && line.isDone

// The terminal's colors, theme keys only so they follow light and dark: a group named
// here colors its header and marks, the others keep the default text color.
const TERMINAL_GROUP_COLORS: readonly { names: readonly string[]; color: Color }[] = [
  { names: CURRENT_SECTIONS, color: 'claude' },
  { names: ['issues', '问题'], color: 'error' },
  { names: ['ideas', '新想法'], color: 'merged' },
]
const DONE_COLOR: Color = 'success'

const terminalColorOf = (title: string) =>
  TERMINAL_GROUP_COLORS.find(group => isNamed(group.names, title))?.color

const drawLine = ({ Box, Text }: Ui, line: BodyLine, title: string, markGap: Space) => {
  const isCurrent = isNamed(CURRENT_SECTIONS, title)
  const isDone = line.kind === 'item' && line.isDone
  const isDim = isDone || isNamed(MUTED_SECTIONS, title)
  const text = withoutBackticks(line.text)
  if (line.kind === 'text') return <Text dimColor={isDim}>{text}</Text>

  return (
    <Box flexDirection="row" gap={markGap}>
      <Text color={isCurrent && !isDone ? ACCENT : undefined} dimColor={isDim}>
        {isDone ? '✓' : isCurrent ? '●' : '○'}
      </Text>
      <Box flexShrink={1}>
        <Text
          dimColor={isDim}
          strikethrough={isDone}
          weight={isCurrent && !isDone ? 'medium' : undefined}
        >
          {text}
        </Text>
      </Box>
    </Box>
  )
}

type Drawn = ReturnType<typeof drawLine>

// A terminal card: the open item, what it says, and the key its title is pressed and focused by.
type Card = { kind: 'card'; key: string; line: ItemLine; fields: ItemFields }
// A terminal group: its header's key, folds when it has a title and any items, open or done.
type TerminalGroup = {
  group: TodoGroup
  key: string
  isFoldable: boolean
  body: (Card | TextLine)[]
  doneKey: string
  done: ItemLine[]
}

const isCard = (part: Card | TextLine): part is Card => part.kind === 'card'

// Keys that tell lines of the same text apart by how many came before, so each opens on its own
// and keeps its key while lines around it are added, moved or checked off.
const occurrenceKeys = (prefix: string, names: readonly string[]) =>
  names.map((name, index) => `${prefix}${names.slice(0, index).filter(other => other === name).length}:${name}`)

export const terminalGroups = (text: string): TerminalGroup[] => {
  const groups = groupTodo(parseTodo(text))
  const items = groups.flatMap(group => group.lines.filter(isItem))
  const itemKeys = occurrenceKeys(CARD_KEY_PREFIX, items.map(item => item.text))
  const keyOf = new Map(items.map((item, index) => [item, itemKeys[index] ?? ''] as const))
  const titles = groups.map(group => group.title)
  const doneKeys = occurrenceKeys(DONE_KEY_PREFIX, titles)
  const groupKeys = occurrenceKeys(GROUP_KEY_PREFIX, titles)

  return groups.map((group, index) => ({
    group,
    key: groupKeys[index] ?? '',
    isFoldable: group.title !== '' && group.lines.some(isItem),
    body: group.lines
      // A plain boolean: an inferred predicate would wrongly drop open items from the type.
      .filter((line): boolean => !isDoneItem(line))
      .map(line =>
        isItem(line)
          ? { kind: 'card', key: keyOf.get(line) ?? '', line, fields: splitItem(withoutBackticks(line.text)) }
          : line,
      ),
    doneKey: doneKeys[index] ?? '',
    done: group.lines.filter(isDoneItem),
  }))
}

const isFolded = (group: TerminalGroup, collapsed: readonly string[]) =>
  group.isFoldable && collapsed.includes(group.key)

// Every Button the terminal draws, in the order drawn: the arrows step along it. A folded group
// draws its header alone.
const pressableKeys = (groups: readonly TerminalGroup[], collapsed: readonly string[]) =>
  groups.flatMap(group => {
    const header = group.isFoldable ? [group.key] : []
    if (isFolded(group, collapsed)) return header

    return [
      ...header,
      ...group.body.filter(isCard).filter(card => hasDetails(card.fields)).map(card => card.key),
      ...(group.done.length > 0 ? [group.doneKey] : []),
    ]
  })

type MoveResult = { deny?: string }
type RevealHost = {
  ui: { scroll: (args: { in: string; to: { key: string } }) => Promise<MoveResult> }
}
type FocusHost = RevealHost & { ui: { focus: (args: { requestId: string; key: string }) => Promise<MoveResult> } }

const refusal = (error: unknown): MoveResult => ({ deny: String(error) })

// Brings the whole card or done list a Button heads into view (the Button alone when it heads
// none), as far as the pane's rows allow: its top first, moving the window no more than it must.
const reveal = async ($: RevealHost, key: string) => {
  const shown = await $.ui.scroll({ in: PANE, to: { key: `${BOX_KEY_PREFIX}${key}` } }).catch(refusal)
  if (shown.deny !== undefined) await $.ui.scroll({ in: PANE, to: { key } }).catch(refusal)
}

// What the terminal's drawing reads beyond the list: the focused key, what is open or folded.
type TerminalView = {
  selected: string | null
  firstKey: string | undefined
  isOpen: (key: string) => boolean
  isFolded: (group: TerminalGroup) => boolean
  toggle: (key: string) => void
  fold: (key: string) => void
}
type ToggleHost = StateDollar & { ui: { log: (text: string) => void } }

const toggled = (keys: readonly string[], key: string) =>
  keys.includes(key) ? keys.filter(one => one !== key) : [...keys, key]

const terminalViewFor = async (
  $: ToggleHost,
  groups: readonly TerminalGroup[],
  isFocused: boolean,
): Promise<TerminalView> => {
  const expanded = await read($, expandedCards)
  const focused = await read($, focusedKey)
  const collapsed = await read($, collapsedGroups)
  const logError = (error: unknown) => $.ui.log(`todo-panel: ${String(error)}`)

  // Opening or shutting a card, or folding a group, leaves the window where it is.
  return {
    selected: isFocused ? focused : null,
    firstKey: pressableKeys(groups, collapsed)[0],
    isOpen: key => expanded.includes(key),
    isFolded: group => isFolded(group, collapsed),
    toggle: key => void update($, expandedCards, opened => toggled(opened, key)).catch(logError),
    fold: key => void update($, collapsedGroups, folded => toggled(folded, key)).catch(logError),
  }
}

// A mark in a column of its own, so a title that wraps never pushes it out.
const drawMark = ({ Box, Text }: Ui, mark: string, color: Color | undefined, isDim: boolean) => (
  <Box flexShrink={0}>
    <Text color={color} dimColor={isDim}>
      {mark}
    </Text>
  </Box>
)

const markOf = (isOpenable: boolean, isOpen: boolean) => (!isOpenable ? '○' : isOpen ? '▾' : '▸')

// The first Button takes the focus ring when the pane takes the keyboard, so Enter acts at once.
const autoFocusOf = (key: string, view: TerminalView) => (key === view.firstKey ? true : undefined)

// Shut, a card shows its status and next step on one row, or its note when it has neither.
const summaryOf = (fields: ItemFields) => {
  const nextStep = fields.next === undefined ? undefined : `${LABELS.next}${fields.next}`
  const line = [fields.status, nextStep].filter(part => part !== undefined).join(SUMMARY_JOIN)

  return line === '' ? fields.note : line
}

// Open, each field it has on a labeled line wrapped in full, its wrapped rows indented past the label.
const drawDetails = ({ Box, Text }: Ui, fields: ItemFields, isMuted: boolean) =>
  DETAIL_NAMES.flatMap(name => {
    const value = fields[name]
    if (value === undefined) return []

    return [
      <Box flexDirection="row">
        <Box flexShrink={0}>
          <Text dimColor>{LABELS[name]}</Text>
        </Box>
        <Box flexShrink={1}>
          <Text dimColor={isMuted} wrap="wrap">
            {value}
          </Text>
        </Box>
      </Box>,
    ]
  })

// A card's title, a Button only when the card has more to show, so every press does something.
const drawCardTitle = ({ Button, Text }: Ui, card: Card, title: string, view: TerminalView) => {
  const isCurrent = isNamed(CURRENT_SECTIONS, title)
  const label = (
    <Text dimColor={isNamed(MUTED_SECTIONS, title)} weight={isCurrent ? 'medium' : undefined}>
      {card.fields.title}
    </Text>
  )
  if (!hasDetails(card.fields)) return label

  return (
    <Button key={card.key} plain autoFocus={autoFocusOf(card.key, view)} onPress={() => view.toggle(card.key)}>
      {label}
    </Button>
  )
}

// Every border is gray but Now's; the card under the focus ring is bold in the accent color, which
// shows where Enter acts whether the card is open or shut.
const cardBorder = (title: string, isSelected: boolean) => {
  if (isSelected) return { borderStyle: 'bold', borderColor: ACCENT, borderDimColor: false } as const
  const isCurrent = isNamed(CURRENT_SECTIONS, title)

  return {
    borderStyle: 'round',
    borderColor: isCurrent ? terminalColorOf(title) : undefined,
    borderDimColor: !isCurrent,
  } as const
}

// The terminal's card: its mark (▸ shut, ▾ open, ○ nothing more to show), its title, and beneath
// either one cut row or every field in full.
const drawCard = (ui: Ui, card: Card, title: string, view: TerminalView) => {
  const { Box, Text } = ui
  const isMuted = isNamed(MUTED_SECTIONS, title)
  const isOpenable = hasDetails(card.fields)
  const isOpen = isOpenable && view.isOpen(card.key)
  const summary = summaryOf(card.fields)

  return (
    <Box
      key={`${BOX_KEY_PREFIX}${card.key}`}
      flexDirection="row"
      gap={SPACING.terminal.mark}
      paddingX={CARD_PADDING}
      {...cardBorder(title, view.selected === card.key)}
    >
      {drawMark(ui, markOf(isOpenable, isOpen), terminalColorOf(title), isMuted)}
      <Box flexDirection="column" flexShrink={1}>
        {drawCardTitle(ui, card, title, view)}
        {isOpen
          ? drawDetails(ui, card.fields, isMuted)
          : summary !== undefined && (
              <Text dimColor wrap="truncate-end">
                {summary}
              </Text>
            )}
      </Box>
    </Box>
  )
}

// A done item: a green ✓, the text dimmed and struck through.
const drawDoneLine = ({ Box, Text }: Ui, line: ItemLine) => (
  <Box flexDirection="row" gap={SPACING.terminal.mark} paddingLeft={DONE_INSET}>
    <Text color={DONE_COLOR}>✓</Text>
    <Box flexShrink={1}>
      <Text dimColor strikethrough>
        {withoutBackticks(line.text)}
      </Text>
    </Box>
  </Box>
)

// A group's done items fold into one line saying how many, pressed open and shut like a card.
const drawDoneList = (ui: Ui, group: TerminalGroup, view: TerminalView): Drawn[] => {
  const { Box, Button, Text } = ui
  if (group.done.length === 0) return []
  const isOpen = view.isOpen(group.doneKey)
  const header = (
    <Box flexDirection="row" gap={SPACING.terminal.mark} paddingLeft={CARD_INSET}>
      {drawMark(ui, isOpen ? '▾' : '▸', undefined, true)}
      <Button
        key={group.doneKey}
        plain
        autoFocus={autoFocusOf(group.doneKey, view)}
        onPress={() => view.toggle(group.doneKey)}
      >
        <Text dimColor>{LABELS.done(group.done.length)}</Text>
      </Button>
    </Box>
  )

  return [
    <Box key={`${BOX_KEY_PREFIX}${group.doneKey}`} flexDirection="column">
      {header}
      {isOpen && group.done.map(line => drawDoneLine(ui, line))}
    </Box>,
  ]
}

// How a group's title is drawn: its group's color, dimmed when parked; selected, in the accent.
type TitleLook = { color: Color | undefined; weight: 'semibold' | 'bold'; dimColor: boolean }

const restingLook = (title: string, color: Color | undefined): TitleLook => ({
  color,
  weight: 'semibold',
  dimColor: isNamed(MUTED_SECTIONS, title),
})
const SELECTED_LOOK: TitleLook = { color: ACCENT, weight: 'bold', dimColor: false }

const drawTitle = ({ Text }: Ui, title: string, look: TitleLook) => (
  <Text size="footnote" {...look}>
    {title}
  </Text>
)

// A header's left side (its title, and on the terminal a fold mark), and its count on the right, if any.
type GroupHeader = { head: Drawn; count: string | undefined }


const drawGroup = (ui: Ui, group: TodoGroup, itemGap: Space, header: GroupHeader, body: Drawn[]) => {
  const { Box, Text } = ui

  return (
    <Box flexDirection="column" gap={itemGap}>
      {group.title !== '' && (
        <Box flexDirection="row" justifyContent="space-between">
          {header.head}
          {header.count !== undefined && (
            <Text size="footnote" tabular dimColor>
              {header.count}
            </Text>
          )}
        </Box>
      )}
      {group.lines.length === 0 ? (
        <Text size="footnote" dimColor>
          Nothing yet
        </Text>
      ) : (
        body
      )}
    </Box>
  )
}

// The terminal's header: a group with items gets a fold mark (▾ unfolded, ▸ folded) and its title
// as a Button; an empty one its title alone. Selected, mark and title take the accent.
const drawTerminalHead = (ui: Ui, group: TerminalGroup, view: TerminalView) => {
  const { Box, Button } = ui
  const { title } = group.group
  const look = view.selected === group.key ? SELECTED_LOOK : restingLook(title, terminalColorOf(title))
  if (!group.isFoldable) return drawTitle(ui, title, look)

  return (
    <Box key={`${BOX_KEY_PREFIX}${group.key}`} flexDirection="row" gap={SPACING.terminal.mark} flexShrink={1}>
      {drawMark(ui, view.isFolded(group) ? '▸' : '▾', look.color, look.dimColor)}
      <Button key={group.key} plain autoFocus={autoFocusOf(group.key, view)} onPress={() => view.fold(group.key)}>
        {drawTitle(ui, title, look)}
      </Button>
    </Box>
  )
}

// The terminal: open items as cards with text lines in between, then each group's done line (a
// folded group its header alone), and a key hint at the bottom while there is anything to press.
const drawTerminal = (ui: Ui, groups: readonly TerminalGroup[], view: TerminalView) => {
  const { Box, Text } = ui
  // Every header counts what is left to do, a bare number folded or not: 0 once all is done or it is empty.
  const headerOf = (group: TerminalGroup) => ({
    head: drawTerminalHead(ui, group, view),
    count: String(group.group.openCount),
  })
  const bodyOf = (group: TerminalGroup) =>
    view.isFolded(group)
      ? []
      : [
          ...group.body.map(part =>
            isCard(part)
              ? drawCard(ui, part, group.group.title, view)
              : drawLine(ui, part, group.group.title, SPACING.terminal.mark),
          ),
          ...drawDoneList(ui, group, view),
        ]

  return (
    <Box flexDirection="column" gap={SPACING.terminal.group}>
      {groups.map(group => drawGroup(ui, group.group, SPACING.terminal.item, headerOf(group), bodyOf(group)))}
      {view.firstKey !== undefined && (
        <Text size="footnote" dimColor>
          {LABELS.hint}
        </Text>
      )}
    </Box>
  )
}

// Graphical surfaces keep the flat list, in file order, with nothing to fold; a header counts its
// open items, and says nothing when it has none open.
const drawGraphical = (ui: Ui, text: string) => {
  const { Box } = ui
  const headerOf = (group: TodoGroup) => {
    const color = isNamed(CURRENT_SECTIONS, group.title) ? ACCENT : undefined
    const count = group.openCount > 0 ? String(group.openCount) : undefined
    return { head: drawTitle(ui, group.title, restingLook(group.title, color)), count }
  }

  return (
    <Box flexDirection="column" gap={SPACING.graphical.group}>
      {groupTodo(parseTodo(text)).map(group =>
        drawGroup(
          ui,
          group,
          SPACING.graphical.item,
          headerOf(group),
          group.lines.map(line => drawLine(ui, line, group.title, SPACING.graphical.mark)),
        ),
      )}
    </Box>
  )
}

// The terminal's Buttons for a list with the given groups folded, in the order drawn.
export const pressableKeysOf = (text: string, collapsed: readonly string[] = []) =>
  pressableKeys(terminalGroups(text), collapsed)

// An arrow key a person pressed: a one-row move with no pointer, which a wheel tick would carry.
const isArrow = (e: Pick<UiScrollInput, 'origin' | 'pointer' | 'by'>) =>
  e.origin.kind === 'person' && e.pointer === undefined && Math.abs(e.by) === 1

// Where an arrow moves the focus ring: the Button one step from the focused one. None for the wheel
// or a page key, past either end, or with no Button of the list under the ring: those scroll.
export const arrowTarget = (
  keys: readonly string[],
  focused: string | null,
  e: Pick<UiScrollInput, 'origin' | 'pointer' | 'by'>,
) => {
  const at = focused === null ? -1 : keys.indexOf(focused)
  return isArrow(e) && at !== -1 ? keys[at + Math.sign(e.by)] : undefined
}

// Moves the ring onto the Button and brings what it heads into view; the ui.focus hook reveals it
// too, a second `nearest` that moves nothing. The scroll this raises is the plugin's, not an arrow,
// so the ui.scroll hook passes it on. A move the surface refuses says why, and the arrow then
// scrolls instead.
const moveFocus = async ($: FocusHost, key: string): Promise<MoveResult> => {
  const moved = await $.ui.focus({ requestId: PANE, key }).catch(refusal)
  if (moved.deny === undefined) await reveal($, key)
  return moved
}

const ruleFor = (path: string) =>
  [
    `# Project todo list`,
    `This project's todo list is ${path}. Every conversation shares it, and the user watches it live in a pane.`,
    `Write each entry as "- [ ] item", saying what it is and why it matters, clearly enough for someone who has not read the conversation.`,
    `If the file exists, keep its own groups and follow the project's own rules for the list (CLAUDE.md, AGENTS.md and the like): put each item in the group that fits, never add groups it lacks, and never re-sort items into the groups below.`,
    `If the file does not exist, create it the first time an item comes up, with this default template of seven groups:`,
    `- ## Now: what is being worked on; move an item here when starting it.`,
    `- ## Next: confirmed work that has not started yet.`,
    `- ## Backlog: confirmed as worth doing, but deliberately left for later.`,
    `- ## Maybe: understood, but not yet decided whether to do it.`,
    `- ## Issues: bugs found or problems not yet solved.`,
    `- ## Ideas: unverified ideas, recorded as stated and not treated as confirmed; once checked, move to "Next" if it will be done, or delete it if not.`,
    `- ## Done: finished items, newest last.`,
    `How to keep it up to date:`,
    `- At the start of a conversation, read the list to see what is in progress.`,
    `- When a new item or decision comes up, write it into the group that fits.`,
    `- When an item is done, change it to "- [x]"; if the list has a Done or 已完成 group, move it to the end of that group, otherwise leave it where it is, unless the project's rules say otherwise. Delete the line if it is dropped.`,
    `- Change only the relevant lines, and re-read the file before each change: another conversation may have just edited it.`,
  ].join('\n')

// Main worktree, so every worktree's session shows the same list.
const resolvePath = async ($: Host) => {
  const listed = await $.process
    .run(['git', 'worktree', 'list', '--porcelain'])
    .catch(() => undefined)
  const main =
    listed?.exitCode === 0
      ? listed.stdout.match(/^worktree (.+)$/m)?.[1]
      : undefined
  return `${main ?? (await $.session.cwd())}/${TODO_PATH}`
}

const readTodo = async ($: Host, path: string) =>
  (await $.fs.exists(path)) ? $.fs.read(path) : null

export const findUncheckedLines = (content: string) =>
  content.split('\n').filter(line => /^\s*[-*]\s+(?!\[( |x|X)\]\s)/.test(line))

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Write' && e.tool !== 'Edit') return next(e)
    if (!e.file_path.endsWith(`/${TODO_PATH}`)) return next(e)
    const bad = findUncheckedLines(e.tool === 'Write' ? e.content : e.new_string)
    if (bad.length === 0) return next(e)

    return { deny: `Todo entries must be written as "- [ ] item". These lines are not:\n${bad.join('\n')}` }
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'todo',
      description: 'Open or close the todo pane, creating docs/todo.md first if there is none',
    })
    const path = await resolvePath($)
    let last = await readTodo($, path)
    let lastError: string | undefined
    await update($, todoText, () => last)
    if (last !== null) void $.ui.open({ id: PANE, title: TITLE })

    $.clock.every(POLL_MS, async () => {
      try {
        const text = await readTodo($, path)
        lastError = undefined
        if (text === last) return
        const isNew = last === null
        last = text
        await update($, todoText, () => text)
        if (isNew) void $.ui.open({ id: PANE, title: TITLE })
      } catch (error) {
        const message = String(error)
        if (message !== lastError) $.ui.log(`todo-panel: ${message}`)
        lastError = message
      }
    })

    return next(e)
  })

  on('command.run', { command: 'todo' }, async $ => {
    // A pane waiting undrawn counts as closed: the person sees nothing to close.
    const isDrawn = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)
    if (isDrawn) {
      await $.ui.close({ id: PANE })
      return { text: 'Todo pane closed' }
    }

    const path = await resolvePath($)
    const existing = await readTodo($, path)
    if (existing === null) await $.fs.write(path, TEMPLATE)
    await update($, todoText, () => existing ?? TEMPLATE)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: existing === null ? `Created ${path}` : 'Todo pane opened' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const section = {
      id: 'todo-panel:rule',
      text: ruleFor(await resolvePath($)),
      scope: 'session',
    } as const

    return { ...composed, sections: [...composed.sections, section] }
  })

  on('prompt.context', async ($, e, next) => {
    const context = await next(e)
    const text = await readTodo($, await resolvePath($)).catch(() => null)
    if (text === null) return context

    return { ...context, blocks: [...context.blocks, { name: 'todoList', text }] }
  })

  // Where the pane's focus ring lands (Tab, an arrow, a click, the first Button taking it), kept so
  // the card or header under it is drawn selected and the arrows know where to step from.
  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    if (moved.deny !== undefined) return moved
    await update($, focusedKey, () => e.element ?? null).catch(error =>
      $.ui.log(`todo-panel: ${String(error)}`),
    )
    if (e.element !== undefined) await reveal($, e.element)
    return moved
  })

  // The up and down arrows step the focus ring from Button to Button (header, card, done line) and
  // bring it into view; the wheel, the page keys, and an arrow past the first or last Button or
  // with none under the ring scroll as before.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (!isArrow(e)) return next(e)
    const focused = await read($, focusedKey)
    if (focused === null) return next(e)
    const text = await read($, todoText)
    const keys = text === null ? [] : pressableKeysOf(text, await read($, collapsedGroups))
    const target = arrowTarget(keys, focused, e)
    if (target === undefined) return next(e)

    const moved = await moveFocus($, target)
    if (moved.deny !== undefined) return next(e)
    await update($, focusedKey, () => target).catch(error => $.ui.log(`todo-panel: ${String(error)}`))
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const ui = { Box, Text, Button }
    const text = await read($, todoText)
    if (text === null) {
      return <Text dimColor>No list yet. Type /todo to create one.</Text>
    }
    if (e.surface !== 'terminal') return drawGraphical(ui, text)

    const groups = terminalGroups(text)
    const view = await terminalViewFor($, groups, e.props.isFocused)
    return drawTerminal(ui, groups, view)
  })
}
````

### `mods/todo-panel/hooks/register.test.tsx`

````tsx
import type { UiPane, UiScrollInput } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { ElementQuery, FoundElement, TestBody } from 'claude-code/testing'

import { groupTodo, parseTodo, splitItem } from './parse'
import { arrowTarget, findUncheckedLines, pressableKeysOf } from './register'

const PANE = {
  plugin: 'todo-panel',
  component: 'Pane',
  requestId: 'todo-panel',
  props: {
    title: 'Todo',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const
const FOCUSED_PANE = { ...PANE, props: { ...PANE.props, isFocused: true } } as const

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const GRAPHICAL = ['desktop', 'vscode', 'mobile'] as const

test('parseTodo keeps groups, items and unknown lines', async () => {
  const lines = parseTodo('## Now\n- [ ] A\n- [x] B\n\na stray line\n## Backlog\n- [ ] C')

  expect(lines).toEqual([
    { kind: 'heading', text: 'Now' },
    { kind: 'item', text: 'A', isDone: false, section: 'Now' },
    { kind: 'item', text: 'B', isDone: true, section: 'Now' },
    { kind: 'text', text: 'a stray line', section: 'Now' },
    { kind: 'heading', text: 'Backlog' },
    { kind: 'item', text: 'C', isDone: false, section: 'Backlog' },
  ])
})

test('a plain bullet is an open item, and is flagged for writes', async () => {
  expect(parseTodo('- A')).toEqual([{ kind: 'item', text: 'A', isDone: false, section: '' }])
  expect(findUncheckedLines('## Now\n- A\n- [ ] B\n- [x] C\n[x]')).toEqual(['- A'])
})

test('groupTodo counts open items and keeps empty groups', async () => {
  const groups = groupTodo(parseTodo('a first line\n## Now\n- [ ] A\n- [x] B\n## Maybe'))

  expect(groups.map(({ title, openCount, lines }) => [title, openCount, lines.length])).toEqual([
    ['', 0, 1],
    ['Now', 1, 2],
    ['Maybe', 0, 0],
  ])
})

// The source uses the older Chinese form, in full-width brackets, which lists still carry.
const NEW_ITEM = 'loop time limit｜reviewed, waiting to merge｜ask to merge after the F9 test（来源：user 2026-11-03）'

test('splitItem reads item｜status｜next step by position, and a source in full-width brackets', async () => {
  expect(splitItem(NEW_ITEM)).toEqual({
    title: 'loop time limit',
    status: 'reviewed, waiting to merge',
    next: 'ask to merge after the F9 test',
    source: 'user 2026-11-03',
  })
  expect(splitItem('issue：read range｜cause unknown')).toEqual({ title: 'issue：read range', status: 'cause unknown' })
  expect(splitItem('limit | merged | verify | asked twice (source: review)')).toEqual({
    title: 'limit',
    status: 'merged',
    next: 'verify',
    note: 'asked twice',
    source: 'review',
  })
})

test('splitItem leaves a missing field out and never moves a later field into its place', async () => {
  expect(splitItem('limit｜｜merge after the test')).toEqual({ title: 'limit', next: 'merge after the test' })
  expect(splitItem('loop limit | merged |  | verify on device')).toEqual({
    title: 'loop limit',
    status: 'merged',
    note: 'verify on device',
  })
  expect(splitItem('limit｜merged')).toEqual({ title: 'limit', status: 'merged' })
})

test('splitItem reads an older title：note item, and a source on any item', async () => {
  expect(splitItem('worktree check：shows the main copy')).toEqual({ title: 'worktree check', note: 'shows the main copy' })
  expect(splitItem('release ticket: DARE-1 DARE-2')).toEqual({ title: 'release ticket', note: 'DARE-1 DARE-2' })
  expect(splitItem('ship it — before Friday: no later')).toEqual({ title: 'ship it', note: 'before Friday: no later' })
  expect(splitItem(' ：x — y')).toEqual({ title: '：x', note: 'y' })
  expect(splitItem('ship：before Friday（来源：review report）')).toEqual({
    title: 'ship',
    note: 'before Friday',
    source: 'review report',
  })
  expect(splitItem('ship (source: review)')).toEqual({ title: 'ship', source: 'review' })
  expect(splitItem('ship｜done (来源: a)｜check (来源: b)')).toEqual({
    title: 'ship',
    status: 'done (来源: a)',
    next: 'check',
    source: 'b',
  })
})

test('splitItem leaves a title whole when nothing follows a separator', async () => {
  const wholes = ['see https://x.io at 10:30', '：only detail', 'ends with a colon:', 'plain item', '｜only detail', 'a (sourced later)']
  for (const text of wholes) {
    expect(splitItem(text)).toEqual({ title: text })
  }
})

const textOf = (text: string) => () => ({
  value: { value: { shape: 'text-1', value: text }, version: 1 },
})

type Drawing = {
  find: (query: ElementQuery) => Promise<FoundElement | undefined>
  findAll: (query: ElementQuery) => Promise<FoundElement[]>
  press: (target: { key: string }) => Promise<unknown>
}

const cardsOf = async (ui: Drawing) =>
  (await ui.findAll({ type: 'Box' })).filter(box => box.props.borderStyle !== undefined)

const cardTexts = async (ui: Drawing) => (await cardsOf(ui)).map(card => card.text)

const wrapsOf = async (ui: Drawing, text: RegExp) =>
  (await ui.findAll({ type: 'Text', text })).map(found => found.props.wrap)

const buttonKeys = async (ui: Drawing) => (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '')

const cardKeys = async (ui: Drawing) => (await buttonKeys(ui)).filter(key => key.startsWith('card:'))

// Each group's header row: its fold mark when it has one, its title and its count.
const headersOf = async (ui: Drawing) =>
  (await ui.findAll({ type: 'Box' }))
    .filter(box => box.props.justifyContent === 'space-between')
    .map(box => box.text)

const textsOf = async (ui: Drawing) => (await ui.findAll({ type: 'Text' })).map(found => found.text)

const pressTitle = async (ui: Drawing, title: RegExp) => {
  const button = await ui.find({ type: 'Button', text: title })
  expect(button?.key).toBeDefined()
  await ui.press({ key: button?.key ?? '' })
}

const CARD_LIST = '## Next\n- [ ] limit｜built, not merged｜merge after the test\n- [ ] ship：before Friday\n- [ ] plain item\n'
const LIMIT_SHUT = '▸limitbuilt, not merged · Next: merge after the test'
const SHIP_SHUT = '▸shipbefore Friday'
const DONE_LINE = /^\d+ done$/
const HINT = 'ctrl+x tab select · ↑↓ move · Enter open/shut · Esc back to prompt'

const LIMIT_SUMMARY = 'reviewed, waiting to merge · Next: ask to merge after the F9 test'

test('on the terminal a shut card shows ▸, the title and status · next step on one cut row, in English under a Chinese heading too', async ($, on) => {
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf(`## 现在\n- [ ] ${NEW_ITEM}\n- [ ] watch｜too few samples\n- [ ] title only\n`))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await cardTexts(ui)).toEqual([`▸loop time limit${LIMIT_SUMMARY}`, '▸watchtoo few samples', '○title only'])
  expect(await wrapsOf(ui, /^reviewed, waiting/)).toEqual(['truncate-end'])
  expect((await ui.findAll({ type: 'Button' })).map(button => button.text)).toEqual(['现在', 'loop time limit', 'watch'])
  expect(await ui.find({ type: 'Text', text: /2026-11-03/ })).toBeUndefined()
  await ui.unmount()
})

test('on the terminal a shut card with no status or next step shows its note', async ($, on) => {
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf(`${CARD_LIST}- [ ] gap｜｜fill it\n`))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await cardTexts(ui)).toEqual([LIMIT_SHUT, SHIP_SHUT, '○plain item', '▸gapNext: fill it'])
  expect(await wrapsOf(ui, /^before Friday$/)).toEqual(['truncate-end'])
  await ui.unmount()
})

test('on the terminal pressing a title opens that card alone into labeled lines, and pressing again shuts it', async ($, on) => {
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf(`## Now\n- [ ] ${NEW_ITEM}\n- [ ] ship：before Friday\n`))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await pressTitle(ui, /^loop time limit$/)
  expect(await cardTexts(ui)).toEqual([
    '▾loop time limitStatus: reviewed, waiting to mergeNext: ask to merge after the F9 testSource: user 2026-11-03',
    '▸shipbefore Friday',
  ])
  expect(await wrapsOf(ui, /^(reviewed, waiting to merge|ask to merge after the F9 test|user 2026-11-03)$/)).toEqual([
    'wrap',
    'wrap',
    'wrap',
  ])

  await pressTitle(ui, /^ship$/)
  expect((await cardTexts(ui))[1]).toBe('▾shipNote: before Friday')

  await pressTitle(ui, /^loop time limit$/)
  expect((await cardTexts(ui))[0]).toBe(`▸loop time limit${LIMIT_SUMMARY}`)
  await ui.unmount()
})

test('on the terminal an open card shows only the fields it has, under English labels', async ($, on) => {
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf('## Next\n- [ ] gap｜｜fill it (source: review)\n'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await pressTitle(ui, /^gap$/)
  expect(await cardTexts(ui)).toEqual(['▾gapNext: fill itSource: review'])
  await ui.unmount()
})

test('on the terminal two items with the same text open and shut on their own', async ($, on) => {
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf('## Next\n- [ ] same：x\n- [ ] same：x\n'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const keys = await cardKeys(ui)

  expect(new Set(keys).size).toBe(2)
  await ui.press({ key: keys[1] ?? '' })
  expect(await cardTexts(ui)).toEqual(['▸samex', '▾sameNote: x'])
  await ui.unmount()
})

test('on the terminal no Box shares a key with a Button, and no two share one, whatever the item or heading text', async ($, on) => {
  const list = '## card:0:a：x\n- [ ] a：x\n- [ ] a：x#box\n## box:card:0:a：x\n- [x] a：x\n## card:0:a：x\n- [ ] group:0:card:0:a：x：y\n'
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf(list))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const keys = await buttonKeys(ui)
  const buttons = new Set(keys)
  const boxKeys = (await ui.findAll({ type: 'Box' })).flatMap(box => (box.key === undefined ? [] : [box.key]))

  expect(keys.filter(key => key.startsWith('group:'))).toHaveLength(3)
  expect(buttons.size).toBe(keys.length)
  expect(new Set(boxKeys).size).toBe(boxKeys.length)
  expect(boxKeys.filter(key => buttons.has(key))).toEqual([])
  await ui.unmount()
})

test('on the terminal an open card stays open through a redraw and a change to the file', async ($, on) => {
  let text = `## Next\n- [ ] same：x\n- [ ] same：x\n${CARD_LIST.replace('## Next\n', '')}`
  on('state.get', { plugin: 'todo-panel', key: 'text' }, () => textOf(text)())

  const first = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pressTitle(first, /^ship$/)
  await first.press({ key: (await cardKeys(first))[1] ?? '' })
  await first.unmount()

  text = `## Now\n- [ ] new：item\n${text}`
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await cardTexts(again)).toEqual([
    '▸newitem',
    '▸samex',
    '▾sameNote: x',
    LIMIT_SHUT,
    '▾shipNote: before Friday',
    '○plain item',
  ])
  await again.unmount()
})

test('on the terminal done items fold into one line per group that opens on press', async ($, on) => {
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf('## Now\n- [x] done B\n- [ ] do A：why\n- [x] done C\n## Next\n- [x] done D\n'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const summaries = await ui.findAll({ type: 'Button', text: DONE_LINE })
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(found => found.text)

  expect(summaries.map(button => button.text)).toEqual(['2 done', '1 done'])
  expect(await ui.find({ type: 'Text', text: /^done/ })).toBeUndefined()
  expect((await texts()).indexOf('do A')).toBeLessThan((await texts()).indexOf('2 done'))

  await ui.press({ key: summaries[0]?.key ?? '' })
  const shown = await ui.findAll({ type: 'Text', text: /^done/ })
  expect(shown.map(found => [found.text, found.props.strikethrough])).toEqual([
    ['done B', true],
    ['done C', true],
  ])
  expect((await ui.find({ type: 'Text', text: /^✓$/ }))?.props.color).toBe('success')
  expect((await texts()).indexOf('done C')).toBeLessThan((await texts()).indexOf('1 done'))
  await ui.unmount()
})

test('on the terminal a group header counts its open items as a bare number, and its done line is English, under either heading language', async ($, on) => {
  let text = ''
  on('state.get', { plugin: 'todo-panel', key: 'text' }, () => textOf(text)())

  for (const [list, header] of [
    ['## 现在\n- [ ] A\n- [ ] B\n- [x] C\n', '▾现在2'],
    ['## Now\n- [ ] A\n- [ ] B\n- [x] C\n', '▾Now2'],
  ] as const) {
    text = list
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

    expect(await headersOf(ui)).toEqual([header])
    expect((await ui.find({ type: 'Text', text: /^2$/ }))?.props.tabular).toBe(true)
    expect(await ui.find({ type: 'Text', text: /\d open|open \d/ })).toBeUndefined()
    expect((await ui.find({ type: 'Button', text: DONE_LINE }))?.text).toBe('1 done')
    await ui.unmount()
  }
})

const focusBy = (element: string, kind: 'person' = 'person') => ({
  component: 'Pane',
  requestId: 'todo-panel',
  plugin: 'todo-panel',
  element,
  origin: { kind },
}) as const

test('on the terminal the card under the focus gets a bold accent border, and focus alone opens nothing', async ($, on) => {
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf(`## Now\n${CARD_LIST.replace('## Next\n', '')}`))
  on('ui.focus', () => ({}))

  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  await $.ui.focus(focusBy((await cardKeys(ui))[1] ?? ''))
  const cards = await cardsOf(ui)

  expect(cards.map(card => card.props.borderStyle)).toEqual(['round', 'bold', 'round'])
  expect(cards[1]?.props.borderColor).toBe('suggestion')
  expect(cards[1]?.props.borderDimColor).toBe(false)
  expect(cards[0]?.props.borderColor).toBe('claude')
  expect(cards[1]?.text).toBe(SHIP_SHUT)
  await ui.unmount()

  const away = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await cardsOf(away)).map(card => card.props.borderStyle)).toEqual(['round', 'round', 'round'])
  await away.unmount()
})

const arrowBy = (by: number, extra: Partial<UiScrollInput> = {}): UiScrollInput => ({
  component: 'Pane',
  requestId: 'todo-panel',
  offset: 0,
  by,
  bodyRows: 5,
  contentRows: 30,
  origin: { kind: 'person' },
  ...extra,
})

test('the up and down arrows step along the terminal Buttons in drawn order, and stop at either end', async () => {
  const keys = pressableKeysOf(`## Now\n- [ ] plain\n- [x] done\n${CARD_LIST}- [ ] same：x\n- [ ] same：x\n`)
  const [nowHeader, nowDone, nextHeader, limit, ship, first, second] = keys

  expect(keys).toEqual([
    'group:0:Now',
    'done:0:Now',
    'group:0:Next',
    'card:0:limit｜built, not merged｜merge after the test',
    'card:0:ship：before Friday',
    'card:0:same：x',
    'card:1:same：x',
  ])
  expect(arrowTarget(keys, limit ?? '', arrowBy(1))).toBe(ship)
  expect(arrowTarget(keys, ship ?? '', arrowBy(-1))).toBe(limit)
  expect(arrowTarget(keys, first ?? '', arrowBy(1))).toBe(second)
  expect(arrowTarget(keys, nowDone ?? '', arrowBy(1))).toBe(nextHeader)
  expect(arrowTarget(keys, nextHeader ?? '', arrowBy(1))).toBe(limit)
  expect(arrowTarget(keys, nowDone ?? '', arrowBy(-1))).toBe(nowHeader)
  expect(arrowTarget(keys, nowHeader ?? '', arrowBy(-1))).toBeUndefined()
  expect(arrowTarget(keys, second ?? '', arrowBy(1))).toBeUndefined()
})

test('only a titled group with items has a header Button: an empty, a text-only or an untitled group has none', async () => {
  expect(pressableKeysOf('a stray line\n- [ ] loose：x\n## Maybe\n## Notes\nsome text\n## Now\n- [ ] plain\n')).toEqual([
    'card:0:loose：x',
    'group:0:Now',
  ])
})

const FOLD_LIST = '## Now\n- [ ] do A：why\n- [ ] do B\n- [x] done C\n## Next\n- [ ] do D｜in progress\n## Maybe\n'
const FOLD_KEYS = ['group:0:Now', 'card:0:do A：why', 'done:0:Now', 'group:0:Next', 'card:0:do D｜in progress']
const NOW_FOLDED_KEYS = ['group:0:Now', 'group:0:Next', 'card:0:do D｜in progress']
const FOLD_HEADERS = ['▾Now2', '▾Next1', 'Maybe0']
const FOLD_CARDS = ['▸do Awhy', '○do B', '▸do Din progress']

test('on the terminal pressing a header folds its group to the header and count, the next group right below, and pressing again unfolds it', async ($, on) => {
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf(FOLD_LIST))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await headersOf(ui)).toEqual(FOLD_HEADERS)
  expect(await cardTexts(ui)).toEqual(FOLD_CARDS)

  await pressTitle(ui, /^Now$/)
  const texts = await textsOf(ui)
  expect(await headersOf(ui)).toEqual(['▸Now2', '▾Next1', 'Maybe0'])
  expect(texts.slice(texts.indexOf('Now'), texts.indexOf('Next') + 1)).toEqual(['Now', '2', '▾', 'Next'])
  expect(await cardTexts(ui)).toEqual(['▸do Din progress'])
  expect(await ui.find({ type: 'Button', text: DONE_LINE })).toBeUndefined()

  await pressTitle(ui, /^Now$/)
  expect(await headersOf(ui)).toEqual(FOLD_HEADERS)
  expect(await cardTexts(ui)).toEqual(FOLD_CARDS)
  expect((await ui.find({ type: 'Button', text: DONE_LINE }))?.text).toBe('1 done')
  await ui.unmount()
})

test('on the terminal an empty group keeps a plain header with no mark that cannot be pressed', async ($, on) => {
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf(FOLD_LIST))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /^Maybe$/ }))?.props.dimColor).toBe(true)
  expect(await ui.find({ type: 'Button', text: /^Maybe$/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Nothing yet$/ }))?.text).toBe('Nothing yet')
  await ui.unmount()
})

test('on the terminal a folded group stays folded through a redraw and a change to the file, and keeps its open cards', async ($, on) => {
  let text = FOLD_LIST
  on('state.get', { plugin: 'todo-panel', key: 'text' }, () => textOf(text)())

  const first = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pressTitle(first, /^do A$/)
  await pressTitle(first, /^Now$/)
  await first.unmount()

  text = `## Issues\n- [ ] new：item\n${FOLD_LIST}`
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await headersOf(again)).toEqual(['▾Issues1', '▸Now2', '▾Next1', 'Maybe0'])
  expect(await cardTexts(again)).toEqual(['▸newitem', '▸do Din progress'])

  await pressTitle(again, /^Now$/)
  expect(await cardTexts(again)).toEqual(['▸newitem', '▾do ANote: why', '○do B', '▸do Din progress'])
  await again.unmount()
})

test('on the terminal a header shows the same bare open count folded or not, 0 when all are done or it is empty', async ($, on) => {
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf('## Now\n- [x] A\n- [x] B\n## Next\n- [ ] C\n## Maybe\n'))
  const unfolded = ['▾Now0', '▾Next1', 'Maybe0']
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const headerKeys = (await buttonKeys(ui)).filter(key => key.startsWith('group:'))
  expect(await headersOf(ui)).toEqual(unfolded)

  for (const key of headerKeys) await ui.press({ key })
  expect(await headersOf(ui)).toEqual(['▸Now0', '▸Next1', 'Maybe0'])

  for (const key of headerKeys) await ui.press({ key })
  expect(await headersOf(ui)).toEqual(unfolded)
  await ui.unmount()
})

test('the arrows and Tab walk headers, cards and done lines as drawn, skipping a folded group', async ($, on) => {
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf(FOLD_LIST))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(pressableKeysOf(FOLD_LIST)).toEqual(FOLD_KEYS)
  expect(await buttonKeys(ui)).toEqual(FOLD_KEYS)

  await pressTitle(ui, /^Now$/)
  expect(pressableKeysOf(FOLD_LIST, ['group:0:Now'])).toEqual(NOW_FOLDED_KEYS)
  expect(await buttonKeys(ui)).toEqual(NOW_FOLDED_KEYS)
  expect(arrowTarget(NOW_FOLDED_KEYS, 'group:0:Now', arrowBy(1))).toBe('group:0:Next')
  expect(arrowTarget(NOW_FOLDED_KEYS, 'group:0:Next', arrowBy(-1))).toBe('group:0:Now')
  await ui.unmount()
})

test('on the terminal the header under the focus is drawn in the accent, folded or not', async ($, on) => {
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf(FOLD_LIST))
  on('ui.focus', () => ({}))
  const headerLook = async (ui: Drawing, name: RegExp) => {
    const title = await ui.find({ type: 'Text', text: name })
    return [title?.props.color, title?.props.weight, title?.props.dimColor]
  }
  const markColors = async (ui: Drawing) =>
    (await ui.findAll({ type: 'Text', text: /^[▾▸]$/ })).map(mark => mark.props.color)

  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  await $.ui.focus(focusBy('group:0:Now'))
  expect(await headerLook(ui, /^Now$/)).toEqual(['suggestion', 'bold', false])
  expect(await headerLook(ui, /^Next$/)).toEqual([undefined, 'semibold', false])
  expect((await cardsOf(ui)).map(card => card.props.borderStyle)).toEqual(['round', 'round', 'round'])

  await ui.press({ key: 'group:0:Now' })
  expect((await headersOf(ui))[0]).toBe('▸Now2')
  expect(await headerLook(ui, /^Now$/)).toEqual(['suggestion', 'bold', false])
  expect((await markColors(ui))[0]).toBe('suggestion')
  await ui.unmount()

  const away = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await headerLook(away, /^Now$/)).toEqual(['claude', 'semibold', false])
  expect((await markColors(away))[0]).toBe('claude')
  await away.unmount()
})

test('graphical surfaces ignore folding: every group stays whole, with no fold marks', async ($, on) => {
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf(FOLD_LIST))
  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pressTitle(terminal, /^Now$/)
  await terminal.unmount()

  for (const surface of GRAPHICAL) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = await textsOf(ui)

    expect(await headersOf(ui)).toEqual(['Now2', 'Next1', 'Maybe'])
    expect(['do A：why', 'do B', 'done C'].every(item => texts.includes(item))).toBe(true)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    await ui.unmount()
  }
})

test('the wheel, the page keys, and an arrow with no Button of the list focused are left to scroll', async () => {
  const keys = pressableKeysOf(CARD_LIST)

  expect(arrowTarget(keys, keys[0] ?? '', arrowBy(5))).toBeUndefined()
  expect(arrowTarget(keys, keys[0] ?? '', arrowBy(1, { pointer: { column: 3, row: 2 } }))).toBeUndefined()
  expect(arrowTarget(keys, keys[0] ?? '', arrowBy(1, { origin: { kind: 'plugin', name: 'other' } }))).toBeUndefined()
  expect(arrowTarget(keys, null, arrowBy(1))).toBeUndefined()
  expect(arrowTarget(keys, 'card:0:gone', arrowBy(1))).toBeUndefined()
})

test('on the terminal the wheel, page keys, and arrows past the end or with no card focused scroll as before', async ($, on) => {
  let scrolled: UiScrollInput[] = []
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf(CARD_LIST))
  on('ui.focus', () => ({}))
  on('ui.scroll', (_$, e) => {
    scrolled = [...scrolled, e]
    return {}
  })

  const ui = await $.ui.mount({ ...FOCUSED_PANE, surface: 'terminal' })
  await $.ui.scroll(arrowBy(1))
  const [header, , ship] = await buttonKeys(ui)
  await $.ui.focus(focusBy(ship ?? ''))
  await $.ui.scroll(arrowBy(1))
  await $.ui.scroll(arrowBy(5))
  await $.ui.scroll(arrowBy(-1, { pointer: { column: 3, row: 2 } }))
  await $.ui.focus(focusBy(header ?? ''))
  await $.ui.scroll(arrowBy(-1))

  expect(scrolled.map(e => e.by)).toEqual([1, 1, 5, -1, -1])
  await ui.unmount()
})

test('on the terminal an English key hint sits at the bottom when anything can be pressed, and nowhere else', async ($, on) => {
  let text = CARD_LIST
  on('state.get', { plugin: 'todo-panel', key: 'text' }, () => textOf(text)())

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.at(-1)?.text).toBe(HINT)
  expect(texts.at(-1)?.props.dimColor).toBe(true)
  await ui.unmount()

  text = '## 现在\n- [ ] title only\n'
  const headerOnly = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await textsOf(headerOnly)).at(-1)).toBe(HINT)
  await headerOnly.unmount()

  text = '## Now\n## Next\n'
  const plain = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await plain.find({ type: 'Text', text: /ctrl\+x/ })).toBeUndefined()
  await plain.unmount()

  text = CARD_LIST
  for (const surface of GRAPHICAL) {
    const graphical = await $.ui.mount({ ...PANE, surface })
    expect(await graphical.find({ type: 'Text', text: /ctrl\+x/ })).toBeUndefined()
    await graphical.unmount()
  }
})

test('on the terminal no Button takes a digit or letter key, and the first one takes the focus when the pane does', async ($, on) => {
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf(`${CARD_LIST}- [x] done\n`))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const buttons = await ui.findAll({ type: 'Button' })

  expect(buttons.map(button => button.props.hotkey)).toEqual([undefined, undefined, undefined, undefined])
  expect(buttons.map(button => button.props.autoFocus)).toEqual([true, undefined, undefined, undefined])
  expect(buttons[0]?.key).toBe('group:0:Next')
  await ui.unmount()
})

test('on the terminal a pressable title keeps its weight in Now and its dimness in a parked group', async ($, on) => {
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf('## Now\n- [ ] do A：why\n## Maybe\n- [ ] park C：later\n'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Button', text: /^do A$/ }))?.type).toBe('Button')
  expect((await ui.find({ type: 'Text', text: /^do A$/ }))?.props.weight).toBe('medium')
  expect((await ui.find({ type: 'Text', text: /^park C$/ }))?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('graphical surfaces have no pressable titles and cut no text', async ($, on) => {
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf(CARD_LIST))

  for (const surface of GRAPHICAL) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = await ui.findAll({ type: 'Text' })

    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    expect(texts.some(found => found.props.wrap !== undefined)).toBe(false)
    await ui.unmount()
  }
})

test('graphical surfaces keep the plain list, in file order and with no cards', async ($, on) => {
  on('state.get', textOf('## Now\n- [x] done B\n- [ ] do A：why it matters\n'))

  for (const surface of GRAPHICAL) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const boxes = await ui.findAll({ type: 'Box' })
    const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)

    expect(boxes.some(box => box.props.borderStyle !== undefined)).toBe(false)
    expect(texts.indexOf('done B')).toBeLessThan(texts.indexOf('do A：why it matters'))
    await ui.unmount()
  }
})

test('/todo closes a drawn pane and opens one that is closed or waiting undrawn', async ($, on) => {
  const pane = { id: 'todo-panel', title: 'Todo', isShown: true, isFocused: false }
  let panes: UiPane[] = [{ ...pane, isPlaced: true }]
  let calls: string[] = []
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('session.cwd', () => ({ value: '/project' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: '## Now\n' }))
  on('state.get', () => ({ value: { value: { shape: 'text-1', value: null }, version: 1 } }))
  on('state.set', () => ({ value: { isSet: true, version: 2 } }))
  on('ui.panes', () => ({ value: panes }))
  on('ui.open', () => {
    calls = [...calls, 'open']
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    calls = [...calls, 'close']
    return { value: undefined }
  })

  const runTodo = () => $.command.run({ command: 'todo' } as never)

  const closed = await runTodo()
  expect(calls).toEqual(['close'])
  expect(closed.text).toBe('Todo pane closed')

  for (const waiting of [[], [{ ...pane, isPlaced: false }]]) {
    panes = waiting
    calls = []
    const opened = await runTodo()
    expect(calls).toEqual(['open'])
    expect(opened.text).toBe('Todo pane opened')
  }
})

test('/todo with no list writes the seven-group template, Done last', async ($, on) => {
  let written: string[] = []
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('session.cwd', () => ({ value: '/project' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.write', (_$, e) => {
    written = [...written, e.text]
    return { value: undefined }
  })
  on('state.get', () => ({ value: { value: { shape: 'text-1', value: null }, version: 1 } }))
  on('state.set', () => ({ value: { isSet: true, version: 2 } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const created = await $.command.run({ command: 'todo' } as never)
  const headings = parseTodo(written[0] ?? '').map(line => line.text)

  expect(created.text).toBe('Created /project/docs/todo.md')
  expect(headings).toEqual(['Now', 'Next', 'Backlog', 'Maybe', 'Issues', 'Ideas', 'Done'])
})

const composeRule = async (...[$, on]: Parameters<TestBody>) => {
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('session.cwd', () => ({ value: '/project' }))
  on('prompt.compose', () => ({ sections: [] }))

  const { sections } = await $.prompt.compose({
    model: 'test-model',
    promptModel: 'test-model',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  })
  const rule = sections.find(section => section.id === 'todo-panel:rule')?.text ?? ''
  const lines = rule.split('\n')
  return { rule, lines, lineOf: (start: string) => lines.find(line => line.startsWith(start)) ?? '' }
}

test('the upkeep rules keep an existing list\'s own groups and give the seven groups only as the template for a new file', async ($, on) => {
  const { rule, lines, lineOf } = await composeRule($, on)
  const existing = lineOf('If the file exists')
  const created = lineOf('If the file does not exist')
  const template = lines.filter(line => line.startsWith('- ## '))

  expect(existing).toContain('keep its own groups')
  expect(existing).toContain('the project\'s own rules')
  expect(existing).toContain('CLAUDE.md')
  expect(existing).toContain('never add groups it lacks')
  expect(existing).toContain('never re-sort items')
  expect(rule).not.toContain('add the group')
  expect(rule).not.toContain('Use seven groups')
  expect(created).toContain('default template of seven groups')
  expect(template.map(line => line.slice(5, line.indexOf(':')))).toEqual(['Now', 'Next', 'Backlog', 'Maybe', 'Issues', 'Ideas', 'Done'])
  expect(lines.indexOf(template[0] ?? '')).toBe(lines.indexOf(created) + 1)
})

test('the upkeep rules check a finished item off and move it to the end of Done or 已完成 only when the list has that group', async ($, on) => {
  const { lines, lineOf } = await composeRule($, on)
  const finished = lineOf('- When an item is done')

  expect(finished).toContain('change it to "- [x]"')
  expect(finished).toContain('if the list has a Done or 已完成 group, move it to the end of that group')
  expect(finished).toContain('otherwise leave it where it is')
  expect(finished).toContain('unless the project\'s rules say otherwise')
  expect(lines.filter(line => line !== finished && /move .*end of/.test(line))).toEqual([])
})

test('the pane says how to start when there is no list, on every surface', async $ => {
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /todo/ }))?.text).toContain('/todo')
    await ui.unmount()
  }
})

test('the mark never touches the text, and backticks are not shown, on every surface', async ($, on) => {
  on('state.get', () => ({
    value: { value: { shape: 'text-1', value: '## Now\n- [ ] check the `a` endpoint\n' }, version: 1 },
  }))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const boxes = await ui.findAll({ type: 'Box' })
    const rows = boxes.filter(box => box.props.flexDirection === 'row' && !box.props.justifyContent)

    // Some surfaces hand gap on as columnGap. The terminal's header has a fold mark too.
    expect(rows.map(row => Boolean(row.props.gap ?? row.props.columnGap))).toEqual(
      surface === 'terminal' ? [true, true] : [true],
    )
    expect((await ui.find({ type: 'Text', text: /endpoint/ }))?.text).toBe('check the a endpoint')
    await ui.unmount()
  }
})

test('graphical surfaces draw groups, bare counts and every item', async ($, on) => {
  const text = '## Now\n- [ ] do A\n- [x] done B\n## Next\n- [ ] do C\n- [ ] do D\n## Maybe\n'
  on('state.get', () => ({
    value: { value: { shape: 'text-1', value: text }, version: 1 },
  }))

  for (const surface of GRAPHICAL) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /^Now$/ }))?.text).toBe('Now')
    expect((await ui.find({ type: 'Text', text: /do A/ }))?.text).toBe('do A')
    expect((await ui.find({ type: 'Text', text: /done B/ }))?.text).toBe('done B')
    expect((await ui.find({ type: 'Text', text: /^2$/ }))?.text).toBe('2')
    expect((await ui.find({ type: 'Text', text: /Nothing yet/ }))?.text).toBe('Nothing yet')
    await ui.unmount()
  }
})

test('the current group is accented and parked ones dimmed, under English or older Chinese headings', async ($, on) => {
  let text = ''
  on('state.get', () => ({
    value: { value: { shape: 'text-1', value: text }, version: 1 },
  }))

  for (const [current, parked] of [['Now', 'Maybe'], ['现在', '待定']]) {
    text = `## ${current}\n- [ ] A\n## ${parked}\n- [ ] B\n`
    for (const [surface, accent] of [['terminal', 'claude'], ['desktop', 'suggestion']] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })

      expect((await ui.find({ type: 'Text', text: new RegExp(`^${current}$`) }))?.props.color).toBe(accent)
      expect((await ui.find({ type: 'Text', text: new RegExp(`^${parked}$`) }))?.props.dimColor).toBe(true)
      await ui.unmount()
    }
  }
})

test('a Done group, under the English or the older Chinese heading, is dimmed like Backlog and Maybe, and its done line is English', async ($, on) => {
  let text = ''
  on('state.get', { plugin: 'todo-panel', key: 'text' }, () => textOf(text)())

  for (const done of ['Done', '已完成']) {
    text = `## Now\n- [ ] A\n## ${done}\n- [x] shipped B\n`
    const heading = new RegExp(`^${done}$`)

    const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await terminal.find({ type: 'Text', text: heading }))?.props.dimColor).toBe(true)
    await pressTitle(terminal, /^1 done$/)
    expect((await terminal.find({ type: 'Text', text: /^shipped B$/ }))?.props.strikethrough).toBe(true)
    await terminal.unmount()

    for (const surface of GRAPHICAL) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect((await ui.find({ type: 'Text', text: heading }))?.props.dimColor).toBe(true)
      expect((await ui.find({ type: 'Text', text: /^shipped B$/ }))?.props.strikethrough).toBe(true)
      await ui.unmount()
    }
  }
})

test('on the terminal headers and marks take their group color', async ($, on) => {
  let text = ''
  on('state.get', () => ({ value: { value: { shape: 'text-1', value: text }, version: 1 } }))

  for (const names of [['Now', 'Issues', 'Ideas', 'Next'], ['现在', '问题', '新想法', '接下来']]) {
    const [now, issues, ideas, next] = names
    text = `## ${now}\n- [ ] A\n## ${issues}\n- [ ] C：why\n## ${ideas}\n- [ ] D\n## ${next}\n- [ ] E：why\n`
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const headerColors = await Promise.all(
      names.map(async name => (await ui.find({ type: 'Text', text: new RegExp(`^${name}$`) }))?.props.color),
    )
    const markColors = (await ui.findAll({ type: 'Text', text: /^[○▸]$/ })).map(mark => mark.props.color)

    expect(headerColors).toEqual(['claude', 'error', 'merged', undefined])
    expect(markColors).toEqual(['claude', 'error', 'merged', undefined])
    await ui.unmount()
  }
})
````

### `.claude-plugin/marketplace.json`

````json
{
  "name": "claude-todo-list-panel",
  "owner": { "name": "fghjkl007" },
  "plugins": [
    {
      "name": "todo-panel",
      "source": "./mods/todo-panel",
      "description": "A project todo pane: every conversation shares docs/todo.md, shown live beside the chat"
    }
  ]
}
````

### `.gitignore`

````gitignore
.DS_Store
*.log
.mcpb-cache/
.claude-plugin/types/
mods/todo-panel/.claude-plugin/types/
# This project's own working notes, not part of the mod.
docs/
DELIVERY_REPORT.md
````
