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
