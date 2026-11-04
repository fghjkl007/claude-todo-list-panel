import type { UiPane } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { ElementQuery, FoundElement } from 'claude-code/testing'

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
  expect(splitItem('worktree 验收：显示主工作区那份')).toEqual({ title: 'worktree 验收', details: ['显示主工作区那份'] })
  expect(splitItem('release ticket: DARE-1 DARE-2')).toEqual({ title: 'release ticket', details: ['DARE-1 DARE-2'] })
  expect(splitItem('ship it — before Friday: no later')).toEqual({ title: 'ship it', details: ['before Friday: no later'] })
  expect(splitItem(' ：x — y')).toEqual({ title: '：x', details: ['y'] })
})

test('splitItem leaves a title whole when no detail follows a separator', async () => {
  for (const text of ['see https://x.io at 10:30', '：only detail', 'ends with a colon:', 'plain item', '｜only detail']) {
    expect(splitItem(text)).toEqual({ title: text, details: [] })
  }
})

test('splitItem reads ｜ fields first: the item, then each field on its own line', async () => {
  expect(splitItem('循环时间上限｜已提交，未合入｜实测后合入（来源：用户 2026-11-03）')).toEqual({
    title: '循环时间上限',
    details: ['已提交，未合入', '实测后合入（来源：用户 2026-11-03）'],
  })
  expect(splitItem('问题：读取范围｜原因未查')).toEqual({ title: '问题：读取范围', details: ['原因未查'] })
  expect(splitItem('loop limit | merged |  | verify on device')).toEqual({
    title: 'loop limit',
    details: ['merged', 'verify on device'],
  })
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

test('on the terminal a card shows each ｜ field as its own dim line', async ($, on) => {
  on('state.get', textOf('## Next\n- [ ] limit｜built, not merged｜merge after the test\n'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const card = (await ui.findAll({ type: 'Box' })).find(box => box.props.borderStyle === 'round')
  const details = await ui.findAll({ type: 'Text', text: /^(built, not merged|merge after the test)$/ })

  expect(card?.text).toBe('○limitbuilt, not mergedmerge after the test')
  expect(details.map(found => [found.text, found.props.dimColor])).toEqual([
    ['built, not merged', true],
    ['merge after the test', true],
  ])
  await ui.unmount()
})

const CARD_LIST = '## Next\n- [ ] limit｜built, not merged｜merge after the test\n- [ ] ship：before Friday\n- [ ] plain item\n'
const LIMIT_DETAILS = /^(built, not merged|merge after the test)$/
const SHIP_DETAIL = /^before Friday$/

type Drawing = {
  find: (query: ElementQuery) => Promise<FoundElement | undefined>
  findAll: (query: ElementQuery) => Promise<FoundElement[]>
  press: (target: { key: string }) => Promise<unknown>
}

const wrapsOf = async (ui: Drawing, text: RegExp) =>
  (await ui.findAll({ type: 'Text', text })).map(found => found.props.wrap)

const pressTitle = async (ui: Drawing, title: RegExp) => {
  const button = await ui.find({ type: 'Button', text: title })
  expect(button?.key).toBeDefined()
  await ui.press({ key: button?.key ?? '' })
}

test('on the terminal each detail is cut to one row, and only a title with details is pressable', async ($, on) => {
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf(CARD_LIST))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const buttons = await ui.findAll({ type: 'Button' })

  expect(await wrapsOf(ui, LIMIT_DETAILS)).toEqual(['truncate-end', 'truncate-end'])
  expect(await wrapsOf(ui, SHIP_DETAIL)).toEqual(['truncate-end'])
  expect(buttons.map(button => [button.text, button.props.plain])).toEqual([
    ['limit', true],
    ['ship', true],
  ])
  expect(buttons[0]?.key).not.toBe(buttons[1]?.key)
  expect(await ui.find({ type: 'Text', text: /^plain item$/ })).toBeDefined()
  await ui.unmount()
})

test('on the terminal pressing a title expands that card alone, and pressing again collapses it', async ($, on) => {
  on('state.get', { plugin: 'todo-panel', key: 'text' }, textOf(CARD_LIST))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await pressTitle(ui, /^limit$/)
  expect(await wrapsOf(ui, LIMIT_DETAILS)).toEqual(['wrap', 'wrap'])
  expect(await wrapsOf(ui, SHIP_DETAIL)).toEqual(['truncate-end'])

  await pressTitle(ui, /^limit$/)
  expect(await wrapsOf(ui, LIMIT_DETAILS)).toEqual(['truncate-end', 'truncate-end'])
  await ui.unmount()
})

test('on the terminal an expanded card stays open through a redraw and a change to the file', async ($, on) => {
  let text = CARD_LIST
  on('state.get', { plugin: 'todo-panel', key: 'text' }, () => textOf(text)())

  const first = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pressTitle(first, /^ship$/)
  await first.unmount()

  text = `## Now\n- [ ] new：item\n${CARD_LIST}`
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await wrapsOf(again, SHIP_DETAIL)).toEqual(['wrap'])
  expect(await wrapsOf(again, LIMIT_DETAILS)).toEqual(['truncate-end', 'truncate-end'])
  expect(await wrapsOf(again, /^item$/)).toEqual(['truncate-end'])
  await again.unmount()
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

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = await ui.findAll({ type: 'Text' })

    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    expect(texts.some(found => found.props.wrap !== undefined)).toBe(false)
    await ui.unmount()
  }
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
