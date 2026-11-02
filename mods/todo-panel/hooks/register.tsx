import { atom, read, update } from 'claude-code'
import type { Elements, Register, Space } from 'claude-code'

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

type Ui = Pick<Elements['desktop'], 'Box' | 'Text'>

const withoutBackticks = (text: string) => text.replaceAll('`', '')

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

const drawGroup = (ui: Ui, group: TodoGroup, itemGap: Space, markGap: Space) => {
  const { Box, Text } = ui
  const isCurrent = isNamed(CURRENT_SECTIONS, group.title)
  const isDim = isNamed(MUTED_SECTIONS, group.title)

  return (
    <Box flexDirection="column" gap={itemGap}>
      {group.title !== '' && (
        <Box flexDirection="row" justifyContent="space-between">
          <Text
            size="footnote"
            weight="semibold"
            color={isCurrent ? ACCENT : undefined}
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
        group.lines.map(line => drawLine(ui, line, group.title, markGap))
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

    const space = e.surface === 'terminal' ? SPACING.terminal : SPACING.graphical

    return (
      <Box flexDirection="column" gap={space.group}>
        {groupTodo(parseTodo(text)).map(group =>
          drawGroup({ Box, Text }, group, space.item, space.mark),
        )}
      </Box>
    )
  })
}
