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
