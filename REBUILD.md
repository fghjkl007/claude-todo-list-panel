# Todo Panel — rebuild guide

Everything needed to rebuild the Todo Panel mod for Claude Code from scratch: what it is, the design decisions and why they were made, the file layout, the full source of every file, how to test and install it, and what is still open.

Published copy: https://github.com/fghjkl007/claude-todo-list-panel (commit `ec64633`). Built and tested on Claude Code 2.1.316.

**For the Claude doing the rebuild:** load the `plugin-authoring` skill first. It holds the mod API reference and supplies the `claude-code` module types, which this repo does not commit (`.claude-plugin/types/` is ignored). Then create the files in "Source files" below, run the checks in "Test and validate", and go through "Acceptance checklist".

---

## 1. What it is

A pane beside the chat that shows the project's `docs/todo.md`. Every conversation in the project shares that one file and keeps it up to date, so the user can see at a glance what is in progress, across all their parallel conversations. The terminal CLI and the desktop app run the same mod.

The list has six groups:

| Group | Holds | Look |
|---|---|---|
| **Now** | What is being worked on | Accent color, `●` marks, medium weight |
| **Next** | Confirmed work that has not started | Normal |
| **Backlog** | Worth doing, deliberately left for later | Dimmed |
| **Maybe** | Understood, but not yet decided whether to do it | Dimmed |
| **Issues** | Bugs found or problems not yet solved; checked off once solved | Normal |
| **Ideas** | Unverified ideas, recorded as stated, not treated as confirmed; moved to Next once checked and wanted, deleted if not | Normal |

File format:

```markdown
## Now
- [ ] What is being worked on
- [x] What is done

## Next
- [ ] Confirmed work that has not started yet
```

---

## 2. Design decisions (and why)

### Architecture

- **A Claude Code mod, not a separate program or a skill.** A mod can draw a pane beside the chat, inject rules into every conversation, and intercept tool calls, all in one file with no background process and no `settings.json` change. Standalone todo programs were looked at and rejected: they cannot see the conversations. A skill was rejected for the upkeep rules because it has to be triggered; rules injected by the mod apply to every project as soon as the mod is installed.
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

- **It is a toggle.** Drawn → close (`Todo pane closed`). Closed → open (`Todo pane opened`). No file → write the six-group template and open (`Created <path>`).
- **A pane waiting undrawn counts as closed.** In a terminal narrower than 144 columns the pane is not shown automatically; it is registered but not placed (`isPlaced: false`). The person sees nothing to close, so `/todo` opens it instead of closing it.

### Upkeep rules given to every conversation

The rules are the whole "automatic upkeep" mechanism, so their wording matters:

- Each entry is `- [ ] item`, written **clearly enough for someone who has not read the conversation**: what it is and why it matters. The list is read across conversations, so shorthand from one chat is useless in another.
- Each group has an explicit definition (table above), so conversations put things in the same place.
- Read the list at the start of a conversation; write new items or decisions into the matching group; move an item to Now when starting it; `- [x]` when done; delete the line if dropped.
- If the file does not exist, create it with all six groups the first time an item comes up; if a group is missing, add it when there is something to put in it.
- **Change only the relevant lines and re-read the file before each change**, because another conversation may have just edited it.
- Lists made by older versions use Chinese headings; keep a file's existing headings instead of adding English duplicates.

### Strict on write, lenient on read

- Conversations must write `- [ ] item`; the `tool.call` hook enforces it for Write and Edit.
- The parser still shows a hand-written `- item` (no checkbox) as an open item, so a person editing the file by hand never loses lines.
- Any other non-heading line is kept as plain text in its group.

### Look (Google Tasks style, flat)

- **Theme keys only, never hex colors**, so every color follows light and dark themes. On graphical surfaces only **Now** uses the accent, the theme key `suggestion`.
- Each group header shows its **open item count** on the right (tabular digits, dimmed), hidden when zero.
- Marks on graphical surfaces: `●` for open items in Now, `○` for other open items, `✓` for done. Done items are dimmed and struck through.
- **Terminal cards (Microsoft To Do style):** in the CLI each open item is a rounded-border card: a `○`, the title, and, when the item has a `：`, `: ` or ` — ` after some text, everything after the first one as a dimmer caption beneath. **Quiet cards (style B, chosen from three mockups):** every card border is gray (`borderDimColor`) except Now's, which use `claude`. Group headers are bold and, like the `○` marks, take the group's color: Now/现在 `claude`, Issues/问题 `error`, Ideas/新想法 `merged`, the others the default text color; Backlog and Maybe (待定) dim the header, `○` and title. Done items are not cards: they follow the group's open cards as a `✓` in `success` with the text dimmed and struck through, indented 2 columns so `✓` sits under each card's `○`. No `+` on the right as in To Do: the pane has no action behind it. Graphical surfaces keep the flat list in file order.
- Backlog and Maybe are dimmed as a whole (title and items).
- An empty group shows `Nothing yet`.
- **The mark never touches the text:** mark and text sit in a row with a gap (1 column in the terminal, `xs` on graphical surfaces). An early version had them touching in the CLI.
- **Backticks are stripped for display only**; the file is unchanged. They showed literally in the terminal.
- Spacing per surface: terminal uses numbers (group 1, item 0, mark 1); graphical surfaces use tokens (group `lg`, item `xs`, mark `xs`).
- With no list, the pane says `No list yet. Type /todo to create one.`

### Compatibility with older lists

The first versions used Chinese headings (现在, 接下来, Backlog, 待定, 问题, 新想法 = Now, Next, Backlog, Maybe, Issues, Ideas). Existing lists keep working: section matching is case-insensitive and trimmed, `现在` counts as the current group, `待定` as a muted one, and the rules tell conversations to keep the existing headings.

### Code style

- Pure functions for parsing and grouping (`parseTodo`, `groupTodo`, `findUncheckedLines`), exported for tests.
- No mutation: `reduce` with spreads. The only mutable state is the poller's `last`/`lastError` closure.
- Named constants for the pane id, title, path, poll interval, section names, template, accent and spacing.

---

## 3. File layout

```
.claude-plugin/marketplace.json        marketplace entry, so users can install from GitHub
.gitignore
README.md
mods/todo-panel/
  .claude-plugin/plugin.json           mod manifest
  hooks/hooks.json                     lists the hooks module
  hooks/register.tsx                   all the logic
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

Expected: 13 tests pass. Validation passes with two existing warnings (no `author` in `plugin.json`, no marketplace `description`).

Lessons from writing the tests:

- In `claude-code/testing`, every `on('…')` fake must be registered **before the test first calls `$`**. To vary a fake inside a loop, register it once and have it read a `let` variable.
- Some surfaces pass `gap` on as `columnGap`; check both.
- Found nodes expose `props`, so color and dim state can be asserted (`props.color === 'suggestion'`, `props.dimColor === true`).

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
- **Multi-line items (graphical surfaces):** the mark is vertically centered against a wrapped item; it should align to the top line. The terminal cards already put `○` on the first line.

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

- [ ] `claude plugin test mods/todo-panel` passes (8 tests).
- [ ] `claude plugin validate` passes for the mod and the marketplace.
- [ ] In a project with no list, `/todo` creates `docs/todo.md` with the six groups and opens the pane.
- [ ] Editing `docs/todo.md` by hand updates the pane within about 2 seconds.
- [ ] `/todo` closes the pane when shown and opens it when closed.
- [ ] A new session in a project with a list opens the pane on its own (terminal at least 144 columns wide).
- [ ] Asking a conversation to note something adds it to the right group.
- [ ] A conversation writing `- item` without `[ ]` is refused with the bad lines listed.
- [ ] In a git worktree, the pane shows the main worktree's list.
- [ ] A list with the old Chinese headings shows 现在 accented and 待定 dimmed.

---

## 8. Source files

Every file in the repo except `README.md` (whose content is covered above) and the ignored working notes, exactly as committed in `ec64633`.

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

declare module 'claude-code' {
  interface PluginState {
    'todo-panel': { text: Shaped<TodoText> }
  }
}
````

### `mods/todo-panel/hooks/register.tsx`

````tsx
import { atom, read, update } from 'claude-code'
import type { Color, Elements, Register, Space } from 'claude-code'

const PANE = 'todo-panel'
const TITLE = 'Todo'
const TODO_PATH = 'docs/todo.md'
const POLL_MS = 2000
// Lists made before the headings were English use the Chinese names, so both count.
const CURRENT_SECTIONS = ['now', '现在']
const MUTED_SECTIONS = ['backlog', 'maybe', '待定']
const TEMPLATE = '## Now\n\n## Next\n\n## Backlog\n\n## Maybe\n\n## Issues\n\n## Ideas\n'
// A theme key, not a fixed hex, so the one accent follows light and dark.
const ACCENT = 'suggestion'
const SPACING = {
  terminal: { group: 1, item: 0, mark: 1 },
  graphical: { group: 'lg', item: 'xs', mark: 'xs' },
} as const
// A card's border plus its padding: done lines start here so their ✓ sits under each card's ○.
const CARD_PADDING = 1
const CARD_INSET = CARD_PADDING + 1
// The first of these splits an item into a title and a dimmer caption beneath it.
const CAPTION_SEPARATORS = ['：', ': ', ' — '] as const

const todoText = atom({ plugin: 'todo-panel', key: 'text' } as const, null, {
  shape: 'text-1',
})

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

type BodyLine = Exclude<TodoLine, { kind: 'heading' }>

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

const isNamed = (names: readonly string[], section: string) =>
  names.includes(section.trim().toLowerCase())

export type ItemParts = { title: string; caption?: string }

export const splitItem = (text: string): ItemParts => {
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

  return first === undefined ? { title: text } : { title: first.title, caption: first.caption }
}

type Ui = Pick<Elements['desktop'], 'Box' | 'Text'>
type ItemLine = Extract<BodyLine, { kind: 'item' }>

const withoutBackticks = (text: string) => text.replaceAll('`', '')
const isDoneItem = (line: BodyLine) => line.kind === 'item' && line.isDone

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

// The terminal's card: a rounded box with the open mark, the title, and any caption beneath.
// Every border is gray but Now's, so the one bright border marks the work in progress.
const drawCard = ({ Box, Text }: Ui, line: ItemLine, title: string) => {
  const isCurrent = isNamed(CURRENT_SECTIONS, title)
  const isMuted = isNamed(MUTED_SECTIONS, title)
  const parts = splitItem(withoutBackticks(line.text))

  return (
    <Box
      flexDirection="row"
      gap={SPACING.terminal.mark}
      borderStyle="round"
      borderColor={isCurrent ? terminalColorOf(title) : undefined}
      borderDimColor={!isCurrent}
      paddingX={CARD_PADDING}
    >
      <Text color={terminalColorOf(title)} dimColor={isMuted}>
        ○
      </Text>
      <Box flexDirection="column" flexShrink={1}>
        <Text dimColor={isMuted} weight={isCurrent ? 'medium' : undefined}>
          {parts.title}
        </Text>
        {parts.caption !== undefined && <Text dimColor>{parts.caption}</Text>}
      </Box>
    </Box>
  )
}

// A done item on the terminal: a green ✓ under the cards' ○, the text dimmed and struck through.
const drawDoneLine = ({ Box, Text }: Ui, line: ItemLine) => (
  <Box flexDirection="row" gap={SPACING.terminal.mark} paddingLeft={CARD_INSET}>
    <Text color={DONE_COLOR}>✓</Text>
    <Box flexShrink={1}>
      <Text dimColor strikethrough>
        {withoutBackticks(line.text)}
      </Text>
    </Box>
  </Box>
)

type DrawLines = (ui: Ui, lines: BodyLine[], title: string) => ReturnType<typeof drawLine>[]
type SurfaceStyle = { drawLines: DrawLines; headerColor: (title: string) => Color | undefined }

// Open items as cards, then the done ones as plain lines, as a completed list sits below.
const TERMINAL_STYLE: SurfaceStyle = {
  drawLines: (ui, lines, title) =>
    [...lines.filter(line => !isDoneItem(line)), ...lines.filter(isDoneItem)].map(line => {
      if (line.kind === 'text') return drawLine(ui, line, title, SPACING.terminal.mark)
      return line.isDone ? drawDoneLine(ui, line) : drawCard(ui, line, title)
    }),
  headerColor: terminalColorOf,
}

const GRAPHICAL_STYLE: SurfaceStyle = {
  drawLines: (ui, lines, title) => lines.map(line => drawLine(ui, line, title, SPACING.graphical.mark)),
  headerColor: title => (isNamed(CURRENT_SECTIONS, title) ? ACCENT : undefined),
}

const drawGroup = (ui: Ui, group: TodoGroup, itemGap: Space, style: SurfaceStyle) => {
  const { Box, Text } = ui
  const isDim = isNamed(MUTED_SECTIONS, group.title)

  return (
    <Box flexDirection="column" gap={itemGap}>
      {group.title !== '' && (
        <Box flexDirection="row" justifyContent="space-between">
          <Text
            size="footnote"
            weight="semibold"
            color={style.headerColor(group.title)}
            dimColor={isDim}
          >
            {group.title}
          </Text>
          {group.openCount > 0 && (
            <Text size="footnote" tabular dimColor>
              {String(group.openCount)}
            </Text>
          )}
        </Box>
      )}
      {group.lines.length === 0 ? (
        <Text size="footnote" dimColor>
          Nothing yet
        </Text>
      ) : (
        style.drawLines(ui, group.lines, group.title)
      )}
    </Box>
  )
}

const ruleFor = (path: string) =>
  [
    `# Project todo list`,
    `This project's todo list is ${path}. Every conversation shares it, and the user watches it live in a pane.`,
    `Write each entry as "- [ ] item", saying what it is and why it matters, clearly enough for someone who has not read the conversation. Use six groups:`,
    `- ## Now: what is being worked on.`,
    `- ## Next: confirmed work that has not started yet.`,
    `- ## Backlog: confirmed as worth doing, but deliberately left for later.`,
    `- ## Maybe: understood, but not yet decided whether to do it.`,
    `- ## Issues: bugs found or problems not yet solved; change to "- [x]" once solved.`,
    `- ## Ideas: unverified ideas, recorded as stated and not treated as confirmed; once checked, move to "Next" if it will be done, or delete it if not.`,
    `How to keep it up to date:`,
    `- At the start of a conversation, read the list to see what is in progress.`,
    `- When a new item or decision comes up, write it into the group that fits the definitions above.`,
    `- Move an item to "Now" when starting it, change it to "- [x]" when done, and delete the line if it is dropped.`,
    `- If the file does not exist, create it with these six groups the first time an item comes up; if an existing file lacks a group, add the group when there is something to write in it.`,
    `- Lists made by older versions use Chinese headings (现在, 接下来, Backlog, 待定, 问题, 新想法 for Now, Next, Backlog, Maybe, Issues, Ideas); keep a file's existing headings rather than adding English duplicates.`,
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const text = await read($, todoText)
    if (text === null) {
      return <Text dimColor>No list yet. Type /todo to create one.</Text>
    }

    const isTerminal = e.surface === 'terminal'
    const space = isTerminal ? SPACING.terminal : SPACING.graphical
    const style = isTerminal ? TERMINAL_STYLE : GRAPHICAL_STYLE

    return (
      <Box flexDirection="column" gap={space.group}>
        {groupTodo(parseTodo(text)).map(group =>
          drawGroup({ Box, Text }, group, space.item, style),
        )}
      </Box>
    )
  })
}
````

### `mods/todo-panel/hooks/register.test.tsx`

````tsx
import type { UiPane } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { findUncheckedLines, groupTodo, parseTodo, splitItem } from './register'

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

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

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

test('splitItem takes the detail after the first colon or dash as a caption', async () => {
  expect(splitItem('worktree 验收：显示主工作区那份')).toEqual({ title: 'worktree 验收', caption: '显示主工作区那份' })
  expect(splitItem('release ticket: DARE-1 DARE-2')).toEqual({ title: 'release ticket', caption: 'DARE-1 DARE-2' })
  expect(splitItem('ship it — before Friday: no later')).toEqual({ title: 'ship it', caption: 'before Friday: no later' })
  expect(splitItem(' ：x — y')).toEqual({ title: '：x', caption: 'y' })
})

test('splitItem leaves a title whole when no detail follows a separator', async () => {
  for (const text of ['see https://x.io at 10:30', '：only detail', 'ends with a colon:', 'plain item']) {
    expect(splitItem(text)).toEqual({ title: text })
  }
})

const textOf = (text: string) => () => ({
  value: { value: { shape: 'text-1', value: text }, version: 1 },
})

test('on the terminal each open item is a card with its detail beneath, done items after as plain lines', async ($, on) => {
  on('state.get', textOf('## Now\n- [x] done B\n- [ ] do A：why it matters\n## Maybe\n- [ ] park C\n'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const cards = (await ui.findAll({ type: 'Box' })).filter(box => box.props.borderStyle === 'round')
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)

  expect(cards.map(card => card.text)).toEqual(['○do Awhy it matters', '○park C'])
  expect((await ui.find({ type: 'Text', text: /^do A$/ }))?.text).toBe('do A')
  expect((await ui.find({ type: 'Text', text: /^why it matters$/ }))?.props.dimColor).toBe(true)
  expect(texts.indexOf('do A')).toBeLessThan(texts.indexOf('done B'))
  expect((await ui.find({ type: 'Text', text: /^done B$/ }))?.props.strikethrough).toBe(true)
  expect(cards[0]?.props.borderColor).toBe('claude')
  expect(cards[0]?.props.borderDimColor).toBe(false)
  expect(cards[1]?.props.borderDimColor).toBe(true)
  await ui.unmount()
})

test('graphical surfaces keep the plain list, in file order and with no cards', async ($, on) => {
  on('state.get', textOf('## Now\n- [x] done B\n- [ ] do A：why it matters\n'))

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
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

    // Some surfaces hand gap on as columnGap.
    expect(rows.map(row => Boolean(row.props.gap ?? row.props.columnGap))).toEqual([true])
    expect((await ui.find({ type: 'Text', text: /endpoint/ }))?.text).toBe('check the a endpoint')
    await ui.unmount()
  }
})

test('the pane draws groups, counts and items, on every surface', async ($, on) => {
  const text = '## Now\n- [ ] do A\n- [x] done B\n## Next\n- [ ] do C\n- [ ] do D\n## Maybe\n'
  on('state.get', () => ({
    value: { value: { shape: 'text-1', value: text }, version: 1 },
  }))

  for (const surface of SURFACES) {
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

test('on the terminal headers and marks take their group color, and done marks are green', async ($, on) => {
  let text = ''
  on('state.get', () => ({ value: { value: { shape: 'text-1', value: text }, version: 1 } }))

  for (const names of [['Now', 'Issues', 'Ideas', 'Next'], ['现在', '问题', '新想法', '接下来']]) {
    const [now, issues, ideas, next] = names
    text = `## ${now}\n- [ ] A\n- [x] B\n## ${issues}\n- [ ] C\n## ${ideas}\n- [ ] D\n## ${next}\n- [ ] E\n`
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const headerColors = await Promise.all(
      names.map(async name => (await ui.find({ type: 'Text', text: new RegExp(`^${name}$`) }))?.props.color),
    )
    const markColors = (await ui.findAll({ type: 'Text', text: /^○$/ })).map(mark => mark.props.color)

    expect(headerColors).toEqual(['claude', 'error', 'merged', undefined])
    expect(markColors).toEqual(['claude', 'error', 'merged', undefined])
    expect((await ui.find({ type: 'Text', text: /^✓$/ }))?.props.color).toBe('success')
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
