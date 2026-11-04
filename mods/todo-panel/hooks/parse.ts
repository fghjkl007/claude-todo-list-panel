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
